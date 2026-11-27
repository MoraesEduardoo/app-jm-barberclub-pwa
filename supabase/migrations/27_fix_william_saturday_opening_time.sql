-- ==============================================================================
-- 27_fix_william_saturday_opening_time.sql
-- Correção e Blindagem da Abertura do Expediente aos Sábados (William / Todos)
-- ==============================================================================

-- 1. Normaliza qualquer start_time '09:15:00' gravado por resíduo de arredondamento legado
UPDATE public.barber_schedules
SET start_time = '09:00:00',
    updated_at = now()
WHERE (start_time = '09:15:00' OR start_time = '09:15')
  AND day_of_week::text IN ('6', 'sabado', '0', 'domingo', '2', 'terca', '3', 'quarta', '4', 'quinta', '5', 'sexta');

-- 2. Limpeza de registros duplicados em barber_schedules (preserva apenas o mais recente)
DELETE FROM public.barber_schedules a
USING public.barber_schedules b
WHERE a.barber_id = b.barber_id
  AND (
    (a.day_of_week::text = '6' AND b.day_of_week::text = 'sabado')
    OR (a.day_of_week::text = 'sabado' AND b.day_of_week::text = '6')
    OR (a.day_of_week::text = '0' AND b.day_of_week::text = 'domingo')
    OR (a.day_of_week::text = 'domingo' AND b.day_of_week::text = '0')
    OR (a.day_of_week::text = '1' AND b.day_of_week::text = 'segunda')
    OR (a.day_of_week::text = 'segunda' AND b.day_of_week::text = '1')
    OR (a.day_of_week::text = '2' AND b.day_of_week::text = 'terca')
    OR (a.day_of_week::text = 'terca' AND b.day_of_week::text = '2')
    OR (a.day_of_week::text = '3' AND b.day_of_week::text = 'quarta')
    OR (a.day_of_week::text = 'quarta' AND b.day_of_week::text = '3')
    OR (a.day_of_week::text = '4' AND b.day_of_week::text = 'quinta')
    OR (a.day_of_week::text = 'quinta' AND b.day_of_week::text = '4')
    OR (a.day_of_week::text = '5' AND b.day_of_week::text = 'sexta')
    OR (a.day_of_week::text = 'sexta' AND b.day_of_week::text = '5')
  )
  AND a.updated_at < b.updated_at;

-- 3. Atualização definitiva da RPC chatbot_get_available_slots
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
    v_has_schedule boolean := false;
    v_service_duration integer := 30;
    v_current_slot time;
    v_slot_end time;
    v_is_conflict boolean;
    v_now_fortaleza timestamptz;
    v_today_fortaleza date;
    v_time_now_fortaleza time;
BEGIN
    v_now_fortaleza := timezone('America/Fortaleza', now());
    v_today_fortaleza := v_now_fortaleza::date;
    v_time_now_fortaleza := v_now_fortaleza::time;

    -- Bloqueia datas passadas
    IF p_date < v_today_fortaleza THEN
        RETURN;
    END IF;

    -- 1. Verifica bloqueios da barbearia ou folgas do profissional (barber_leaves / blocked_dates)
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

    -- 2. Dia da semana (0=Domingo, 1=Segunda, ..., 6=Sábado)
    v_dow := EXTRACT(DOW FROM p_date)::integer;

    SELECT
        start_time,
        end_time,
        COALESCE(break_start_time, lunch_start),
        COALESCE(break_end_time, lunch_end),
        is_working,
        true
    INTO
        v_start_time,
        v_end_time,
        v_lunch_start,
        v_lunch_end,
        v_is_working,
        v_has_schedule
    FROM public.barber_schedules
    WHERE barber_id = p_barber_id
      AND (
        day_of_week::text = v_dow::text
        OR day_of_week::text = CASE v_dow
            WHEN 0 THEN 'domingo'
            WHEN 1 THEN 'segunda'
            WHEN 2 THEN 'terca'
            WHEN 3 THEN 'quarta'
            WHEN 4 THEN 'quinta'
            WHEN 5 THEN 'sexta'
            WHEN 6 THEN 'sabado'
        END
      )
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;

    -- Padrão oficial JM Barberclub caso não haja escala individual cadastrada
    IF NOT FOUND OR v_has_schedule IS NOT TRUE THEN
        IF v_dow = 0 THEN -- Domingo: 09:00 - 12:30
            v_start_time := '09:00'::time;
            v_end_time := '12:30'::time;
            v_is_working := true;
        ELSIF v_dow = 1 THEN -- Segunda-feira: Fechado
            RETURN;
        ELSE -- Terça a Sábado: 09:00 - 20:30
            v_start_time := '09:00'::time;
            v_end_time := '20:30'::time;
            v_is_working := true;
        END IF;
    END IF;

    -- Normaliza horário de abertura: sábado e dias normais iniciam às 09:00 caso tenha vindo 09:15
    IF v_dow <> 1 AND v_start_time = '09:15:00'::time THEN
        v_start_time := '09:00'::time;
    END IF;

    IF v_is_working = false OR v_start_time IS NULL OR v_end_time IS NULL THEN
        RETURN;
    END IF;

    -- 3. Duração do serviço solicitado (padrão 30 min)
    IF p_service_id IS NOT NULL THEN
        SELECT COALESCE(bs.custom_duration_minutes, s.duration_minutes, 30)
        INTO v_service_duration
        FROM public.services s
        LEFT JOIN public.barber_services bs ON bs.service_id = s.id AND bs.barber_id = p_barber_id
        WHERE s.id = p_service_id;
    END IF;

    IF v_service_duration IS NULL OR v_service_duration < 10 THEN
        v_service_duration := 30;
    END IF;

    -- 4. Grade de 10 em 10 minutos
    v_current_slot := v_start_time;

    WHILE v_current_slot < v_end_time
      AND ((EXTRACT(EPOCH FROM v_current_slot) / 60)::integer + v_service_duration) <= (EXTRACT(EPOCH FROM v_end_time) / 60)::integer
    LOOP
        v_slot_end := (v_current_slot + (v_service_duration || ' minutes')::interval)::time;
        v_is_conflict := false;

        -- Bloqueia horários já passados apenas no dia atual
        IF p_date = v_today_fortaleza AND v_current_slot <= v_time_now_fortaleza THEN
            v_is_conflict := true;
        END IF;

        -- Regra de almoço / pausa
        IF NOT v_is_conflict AND v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
            IF (v_current_slot < v_lunch_end AND v_slot_end > v_lunch_start) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Regra de exceções (barber_exceptions)
        IF NOT v_is_conflict THEN
            IF EXISTS (
                SELECT 1 FROM public.barber_exceptions
                WHERE (barber_id = p_barber_id OR barber_id IS NULL)
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

        -- Colisão com agendamentos ativos
        IF NOT v_is_conflict THEN
            IF EXISTS (
                SELECT 1 FROM public.appointments a
                WHERE a.barber_id = p_barber_id
                  AND a.appointment_date = p_date
                  AND lower(COALESCE(a.status, '')) NOT IN ('cancelado', 'canceled', 'cancelled', 'no_show', 'faltou', 'rejeitado', 'rejected')
                  AND (
                      a.appointment_time < v_slot_end
                      AND (a.appointment_time + ((COALESCE(a.duration_minutes, 30) + COALESCE(a.buffer_minutes, 0)) || ' minutes')::interval)::time > v_current_slot
                  )
            ) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        IF NOT v_is_conflict THEN
            slot_time := to_char(v_current_slot, 'HH24:MI');
            RETURN NEXT;
        END IF;

        v_current_slot := (v_current_slot + '10 minutes'::interval)::time;
    END LOOP;

    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chatbot_get_available_slots(uuid, date, uuid) TO anon, authenticated, service_role;