-- ==============================================================================
-- MIGRAÇÃO 09: TEMPOS E PREÇOS PERSONALIZADOS POR PROFISSIONAL (public.barber_services)
-- Sistema: JM BarberClub (Next.js PWA + Homepage + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/09_barber_services_custom_duration.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ESTRUTURA DE DADOS (public.barber_services)
-- Garante que a tabela barber_services possui custom_duration (integer, em minutos),
-- custom_duration_minutes (integer, alias sincronizado) e custom_price (numeric).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    custom_duration integer CHECK (custom_duration >= 5),
    custom_duration_minutes integer CHECK (custom_duration_minutes >= 5),
    custom_price numeric(10,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE (barber_id, service_id)
);

ALTER TABLE public.barber_services
    ADD COLUMN IF NOT EXISTS custom_duration integer,
    ADD COLUMN IF NOT EXISTS custom_duration_minutes integer,
    ADD COLUMN IF NOT EXISTS custom_price numeric(10,2),
    ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;

-- Sincroniza valores existentes entre custom_duration e custom_duration_minutes
UPDATE public.barber_services
SET
    custom_duration = COALESCE(custom_duration, custom_duration_minutes),
    custom_duration_minutes = COALESCE(custom_duration_minutes, custom_duration)
WHERE custom_duration IS DISTINCT FROM custom_duration_minutes;

-- ------------------------------------------------------------------------------
-- 2. TRIGGER DE SINCRONIZAÇÃO AUTOMÁTICA (custom_duration <-> custom_duration_minutes)
-- Garante compatibilidade total quer a consulta/escrita use custom_duration
-- ou custom_duration_minutes. Se ficar NULL, herda o tempo padrão de public.services.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_barber_services_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.custom_duration := COALESCE(NEW.custom_duration, NEW.custom_duration_minutes);
        NEW.custom_duration_minutes := COALESCE(NEW.custom_duration_minutes, NEW.custom_duration);
    ELSE
        IF NEW.custom_duration IS DISTINCT FROM OLD.custom_duration THEN
            NEW.custom_duration_minutes := NEW.custom_duration;
        ELSIF NEW.custom_duration_minutes IS DISTINCT FROM OLD.custom_duration_minutes THEN
            NEW.custom_duration := NEW.custom_duration_minutes;
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_barber_services_columns ON public.barber_services;
CREATE TRIGGER trg_sync_barber_services_columns
BEFORE INSERT OR UPDATE ON public.barber_services
FOR EACH ROW EXECUTE FUNCTION public.sync_barber_services_columns();

-- ------------------------------------------------------------------------------
-- 3. ATUALIZAÇÃO DO MOTOR DE HORÁRIOS LIVRES (chatbot_get_available_slots)
-- Consulta barber_services filtrando por barber_id e service_id para buscar
-- custom_duration. Caso seja NULL, utiliza o tempo padrão da tabela services.
-- ------------------------------------------------------------------------------
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
    v_now_fortaleza timestamptz;
    v_today_fortaleza date;
    v_time_now_fortaleza time;
BEGIN
    v_now_fortaleza := timezone('America/Fortaleza', now());
    v_today_fortaleza := v_now_fortaleza::date;
    v_time_now_fortaleza := v_now_fortaleza::time;

    IF p_date < v_today_fortaleza THEN
        RETURN;
    END IF;

    -- 1. Verificar bloqueios da barbearia ou folgas do profissional
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

    -- 2. Identificar dia da semana (0=Domingo, 1=Segunda, ..., 6=Sábado)
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

    IF v_start_time IS NULL THEN
        IF v_dow = 0 THEN
            v_start_time := '09:00'::time;
            v_end_time := '12:30'::time;
            v_is_working := true;
        ELSIF v_dow = 1 THEN
            v_start_time := '14:30'::time;
            v_end_time := '19:00'::time;
            v_is_working := true;
        ELSE
            v_start_time := '09:00'::time;
            v_end_time := '19:00'::time;
            v_is_working := true;
        END IF;
    END IF;

    IF v_is_working = false OR v_start_time IS NULL OR v_end_time IS NULL THEN
        RETURN;
    END IF;

    -- 3. Calcular a duração exata do serviço para o profissional selecionado
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

    -- 4. Iteração em grade pura de 10 em 10 minutos
    v_current_slot := v_start_time;

    WHILE v_current_slot + (v_service_duration || ' minutes')::interval <= v_end_time LOOP
        v_slot_end := (v_current_slot + (v_service_duration || ' minutes')::interval)::time;
        v_is_conflict := false;

        IF p_date = v_today_fortaleza THEN
            IF v_current_slot < (v_time_now_fortaleza + '30 minutes'::interval)::time THEN
                v_is_conflict := true;
            END IF;
        END IF;

        IF NOT v_is_conflict AND v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
            IF (v_current_slot < v_lunch_end AND v_slot_end > v_lunch_start) THEN
                v_is_conflict := true;
            END IF;
        END IF;

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

        IF NOT v_is_conflict THEN
            IF EXISTS (
                SELECT 1 FROM public.appointments a
                WHERE a.barber_id = p_barber_id
                  AND a.appointment_date = p_date
                  AND a.status IN ('confirmed', 'confirmado', 'pending', 'pendente', 'completed', 'concluido', 'concluído', 'bloqueado', 'blocked', 'pre_scheduled')
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

-- ------------------------------------------------------------------------------
-- 4. POLÍTICAS RLS E PERMISSÕES EM public.barber_services
-- ------------------------------------------------------------------------------
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Allow public read barber_services"
        ON public.barber_services
        FOR SELECT
        TO anon, authenticated
        USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage barber_services"
        ON public.barber_services
        FOR ALL
        TO anon, authenticated, service_role
        USING (true)
        WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT ALL ON public.barber_services TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
