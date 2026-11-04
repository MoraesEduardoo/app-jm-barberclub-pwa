-- ==============================================================================
-- MIGRAÇÃO 11: REMOÇÃO DEFINITIVA DA TRAVA DE +30 MIN EM chatbot_get_available_slots
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/11_remove_30min_advance_slots_rpc.sql
-- ==============================================================================
-- Objetivo:
-- Garantir que a grade de horários seja calculada de 10 em 10 minutos de forma
-- contínua e sequencial logo após o minuto atual no fuso 'America/Fortaleza'
-- (ex: às 10:07 exibe 10:10, 10:20, 10:30, 10:40...), sem margem artificial de +30 min.
-- ==============================================================================

-- 1. Remove todas as assinaturas/sobrecargas legadas para evitar conflitos no PostgREST
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(uuid, date, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(uuid, uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(uuid, date, uuid, integer) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(text, text, text) CASCADE;

-- 2. Cria a função canônica public.chatbot_get_available_slots
CREATE OR REPLACE FUNCTION public.chatbot_get_available_slots(
    p_barber_id uuid,
    p_date date,
    p_service_id uuid DEFAULT NULL
)
RETURNS TABLE (slot_time text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_dow integer;
    v_start_time time;
    v_end_time time;
    v_lunch_start time;
    v_lunch_end time;
    v_is_working boolean := true;
    v_service_duration integer := 30;
    v_current_slot time;
    v_slot_end time;
    v_is_conflict boolean;
    v_now_fortaleza timestamp;
    v_today_fortaleza date;
    v_time_now_fortaleza time;
BEGIN
    -- Hora e data atuais estritamente no fuso horário America/Fortaleza (UTC-3)
    v_now_fortaleza := (now() AT TIME ZONE 'America/Fortaleza');
    v_today_fortaleza := v_now_fortaleza::date;
    v_time_now_fortaleza := v_now_fortaleza::time;

    -- Não exibe horários para datas passadas
    IF p_date < v_today_fortaleza THEN
        RETURN;
    END IF;

    -- Verificar bloqueios gerais da barbearia ou folgas do profissional
    IF EXISTS (
        SELECT 1 FROM public.blocked_dates
        WHERE (barber_id = p_barber_id OR barber_id IS NULL)
          AND date = p_date
    ) OR EXISTS (
        SELECT 1 FROM public.barber_leaves
        WHERE (barber_id = p_barber_id OR barber_id IS NULL)
          AND (date = p_date OR (start_date <= p_date AND end_date >= p_date))
    ) THEN
        RETURN;
    END IF;

    -- Identificar dia da semana (0=Domingo, 1=Segunda, ..., 6=Sábado)
    v_dow := EXTRACT(DOW FROM p_date)::integer;

    -- Buscar expediente configurado para o profissional
    SELECT
        start_time,
        end_time,
        COALESCE(break_start_time, lunch_start),
        COALESCE(break_end_time, lunch_end),
        COALESCE(is_working, is_working_day, true)
    INTO
        v_start_time,
        v_end_time,
        v_lunch_start,
        v_lunch_end,
        v_is_working
    FROM public.barber_schedules
    WHERE barber_id = p_barber_id AND day_of_week = v_dow;

    -- Escala padrão JM BarberClub caso não haja escala individual cadastrada
    IF v_start_time IS NULL THEN
        IF v_dow = 0 THEN -- Domingo: 09:00 - 12:30
            v_start_time := '09:00'::time;
            v_end_time := '12:30'::time;
            v_is_working := true;
        ELSIF v_dow = 1 THEN -- Segunda-feira: 14:30 - 19:00
            v_start_time := '14:30'::time;
            v_end_time := '19:00'::time;
            v_is_working := true;
        ELSE -- Terça a Sábado: 09:00 - 19:00
            v_start_time := '09:00'::time;
            v_end_time := '19:00'::time;
            v_is_working := true;
        END IF;
    END IF;

    IF v_is_working = false OR v_start_time IS NULL OR v_end_time IS NULL THEN
        RETURN;
    END IF;

    -- Calcular a duração do serviço solicitado (priorizando custom_duration em barber_services)
    IF p_service_id IS NOT NULL THEN
        SELECT COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30)
        INTO v_service_duration
        FROM public.services s
        LEFT JOIN public.barber_services bs
          ON bs.service_id = s.id AND bs.barber_id = p_barber_id
        WHERE s.id = p_service_id;
    END IF;

    IF v_service_duration IS NULL OR v_service_duration < 5 THEN
        v_service_duration := 30;
    END IF;

    -- Geração contínua e sequencial de slots de 10 em 10 minutos
    v_current_slot := v_start_time;

    WHILE v_current_slot + make_interval(mins => v_service_duration) <= v_end_time LOOP
        v_slot_end := (v_current_slot + make_interval(mins => v_service_duration))::time;
        v_is_conflict := false;

        -- Regra 1: No dia de hoje, bloqueia apenas horários <= minuto atual em America/Fortaleza
        -- (ex: às 10:07 libera 10:10, 10:20, 10:30, 10:40... sem salto artificial de +30 min)
        IF p_date = v_today_fortaleza THEN
            IF v_current_slot <= date_trunc('minute', v_time_now_fortaleza) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Regra 2: Pausa de Almoço / Intervalo
        IF NOT v_is_conflict AND v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
            IF (v_current_slot < v_lunch_end AND v_slot_end > v_lunch_start) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Regra 3: Exceções de Horário (barber_exceptions)
        IF NOT v_is_conflict THEN
            IF EXISTS (
                SELECT 1 FROM public.barber_exceptions
                WHERE barber_id = p_barber_id
                  AND exception_date = p_date
                  AND is_available = false
                  AND (
                      (start_time IS NULL AND end_time IS NULL)
                      OR (v_current_slot < end_time AND v_slot_end > start_time)
                  )
            ) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Regra 4: Colisão com Agendamentos Existentes (duração + buffer_minutes)
        IF NOT v_is_conflict THEN
            IF EXISTS (
                SELECT 1 FROM public.appointments a
                WHERE a.barber_id = p_barber_id
                  AND a.appointment_date = p_date
                  AND a.status IN (
                      'confirmed', 'confirmado',
                      'pending', 'pendente',
                      'completed', 'concluido', 'concluído',
                      'bloqueado', 'blocked',
                      'pre_scheduled', 'pre_agendado'
                  )
                  AND (
                      v_current_slot < (
                          a.appointment_time + make_interval(mins => COALESCE(a.duration_minutes, 30) + COALESCE(a.buffer_minutes, 0))
                      )::time
                      AND v_slot_end > a.appointment_time
                  )
            ) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Emite o horário disponível
        IF NOT v_is_conflict THEN
            slot_time := to_char(v_current_slot, 'HH24:MI');
            RETURN NEXT;
        END IF;

        -- Avança estritamente de 10 em 10 minutos
        v_current_slot := (v_current_slot + interval '10 minutes')::time;
    END LOOP;

    RETURN;
END;
$$;

-- 3. Permissões e atualização de cache do PostgREST
GRANT EXECUTE ON FUNCTION public.chatbot_get_available_slots(uuid, date, uuid) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
