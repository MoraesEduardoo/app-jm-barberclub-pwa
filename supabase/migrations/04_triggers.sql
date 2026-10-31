-- ==============================================================================
-- MIGRAÇÃO 04: TRIGGERS DE TIMESTAMP E SINCRONIZAÇÃO DE COLUNAS (CHATBOT <-> PAINEL)
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/04_triggers.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FUNÇÃO GENÉRICA DE ATUALIZAÇÃO DE UPDATED_AT
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_clients_timestamp ON public.clients;
CREATE TRIGGER trg_update_clients_timestamp
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_chat_sessions_timestamp ON public.chat_sessions;
CREATE TRIGGER trg_update_chat_sessions_timestamp
BEFORE UPDATE ON public.chat_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_appointments_timestamp ON public.appointments;
CREATE TRIGGER trg_update_appointments_timestamp
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

DROP TRIGGER IF EXISTS trg_update_products_timestamp ON public.products;
CREATE TRIGGER trg_update_products_timestamp
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

-- ------------------------------------------------------------------------------
-- 2. TRIGGER DE SINCRONIZAÇÃO DA TABELA BARBERS
-- Mantém `is_active` <-> `active`, `clean_phone` e `commission_percent` <-> `commission_rate`
-- sempre alinhados independentemente de a escrita vir do SQL ou do Painel Next.js.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_barbers_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.active IS NOT NULL AND NEW.is_active IS DISTINCT FROM NEW.active THEN
            NEW.is_active := NEW.active;
        ELSIF NEW.is_active IS NOT NULL THEN
            NEW.active := NEW.is_active;
        END IF;
    ELSE
        IF NEW.active IS DISTINCT FROM OLD.active THEN
            NEW.is_active := NEW.active;
        ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            NEW.active := NEW.is_active;
        END IF;
    END IF;

    IF NEW.phone IS NOT NULL THEN
        NEW.clean_phone := regexp_replace(NEW.phone, '\D', '', 'g');
    END IF;

    IF NEW.commission_percent IS NOT NULL THEN
        NEW.commission_rate := NEW.commission_percent;
    ELSIF NEW.commission_rate IS NOT NULL THEN
        NEW.commission_percent := NEW.commission_rate;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_barbers_columns ON public.barbers;
CREATE TRIGGER trg_sync_barbers_columns
BEFORE INSERT OR UPDATE ON public.barbers
FOR EACH ROW EXECUTE FUNCTION public.sync_barbers_columns();

-- ------------------------------------------------------------------------------
-- 3. TRIGGER DE SINCRONIZAÇÃO DA TABELA SERVICES
-- Mantém `duration_minutes` <-> `default_duration_minutes`, `is_active` <-> `active`
-- e `price` <-> `price_in_cents` perfeitamente sincronizados.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_services_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.default_duration_minutes IS NOT NULL AND NEW.default_duration_minutes <> 30 AND NEW.duration_minutes = 30 THEN
            NEW.duration_minutes := NEW.default_duration_minutes;
        ELSE
            NEW.default_duration_minutes := COALESCE(NEW.duration_minutes, NEW.default_duration_minutes, 30);
            NEW.duration_minutes := COALESCE(NEW.duration_minutes, NEW.default_duration_minutes, 30);
        END IF;

        IF NEW.active IS NOT NULL AND NEW.is_active IS DISTINCT FROM NEW.active THEN
            NEW.is_active := NEW.active;
        ELSE
            NEW.active := COALESCE(NEW.is_active, true);
            NEW.is_active := COALESCE(NEW.is_active, true);
        END IF;
    ELSE
        IF NEW.default_duration_minutes IS DISTINCT FROM OLD.default_duration_minutes THEN
            NEW.duration_minutes := NEW.default_duration_minutes;
        ELSIF NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN
            NEW.default_duration_minutes := NEW.duration_minutes;
        END IF;

        IF NEW.active IS DISTINCT FROM OLD.active THEN
            NEW.is_active := NEW.active;
        ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            NEW.active := NEW.is_active;
        END IF;
    END IF;

    IF NEW.price IS NOT NULL THEN
        NEW.price_in_cents := ROUND(NEW.price * 100)::integer;
    ELSIF NEW.price_in_cents IS NOT NULL THEN
        NEW.price := ROUND((NEW.price_in_cents / 100.0)::numeric, 2);
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_services_columns ON public.services;
CREATE TRIGGER trg_sync_services_columns
BEFORE INSERT OR UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION public.sync_services_columns();

-- ------------------------------------------------------------------------------
-- 4. TRIGGER DE SINCRONIZAÇÃO DA TABELA BARBER_SCHEDULES
-- Mantém `is_working` <-> `is_working_day` e `break_start_time` <-> `lunch_start` sincronizados.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_schedules_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_working_day IS NOT NULL AND NEW.is_working IS DISTINCT FROM NEW.is_working_day THEN
            NEW.is_working := NEW.is_working_day;
        ELSE
            NEW.is_working_day := COALESCE(NEW.is_working, true);
            NEW.is_working := COALESCE(NEW.is_working, true);
        END IF;
    ELSE
        IF NEW.is_working_day IS DISTINCT FROM OLD.is_working_day THEN
            NEW.is_working := NEW.is_working_day;
        ELSIF NEW.is_working IS DISTINCT FROM OLD.is_working THEN
            NEW.is_working_day := NEW.is_working;
        END IF;
    END IF;

    IF NEW.break_start_time IS NOT NULL AND NEW.lunch_start IS NULL THEN
        NEW.lunch_start := NEW.break_start_time;
    ELSIF NEW.lunch_start IS NOT NULL AND NEW.break_start_time IS NULL THEN
        NEW.break_start_time := NEW.lunch_start;
    END IF;

    IF NEW.break_end_time IS NOT NULL AND NEW.lunch_end IS NULL THEN
        NEW.lunch_end := NEW.break_end_time;
    ELSIF NEW.lunch_end IS NOT NULL AND NEW.break_end_time IS NULL THEN
        NEW.break_end_time := NEW.lunch_end;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_schedules_columns ON public.barber_schedules;
CREATE TRIGGER trg_sync_schedules_columns
BEFORE INSERT OR UPDATE ON public.barber_schedules
FOR EACH ROW EXECUTE FUNCTION public.sync_schedules_columns();

-- ------------------------------------------------------------------------------
-- 5. TRIGGER DE SINCRONIZAÇÃO DA TABELA APPOINTMENTS
-- Calcula `end_time` e sincroniza `total_price` com `price`
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_appointments_columns()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.appointment_time IS NOT NULL AND NEW.duration_minutes IS NOT NULL THEN
        NEW.end_time := (NEW.appointment_time + (NEW.duration_minutes || ' minutes')::interval)::time;
    END IF;

    IF NEW.price IS NOT NULL AND (NEW.total_price IS NULL OR NEW.total_price = 0) THEN
        NEW.total_price := NEW.price;
    ELSIF NEW.total_price IS NOT NULL AND (NEW.price IS NULL OR NEW.price = 0) THEN
        NEW.price := NEW.total_price;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_appointments_columns ON public.appointments;
CREATE TRIGGER trg_sync_appointments_columns
BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.sync_appointments_columns();

-- ------------------------------------------------------------------------------
-- 6. TRIGGER DE SINCRONIZAÇÃO DA TABELA BARBER_SERVICES
-- Mantém `custom_duration` <-> `custom_duration_minutes` sempre sincronizados
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

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_barber_services_columns ON public.barber_services;
CREATE TRIGGER trg_sync_barber_services_columns
BEFORE INSERT OR UPDATE ON public.barber_services
FOR EACH ROW EXECUTE FUNCTION public.sync_barber_services_columns();

