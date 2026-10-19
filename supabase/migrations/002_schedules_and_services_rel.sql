-- ==============================================================================
-- MIGRAÇÃO 002: EXPEDIENTE, ESPECIALIDADES E EXCEÇÕES DA EQUIPE
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Barbearia)
-- Arquivo: supabase/migrations/002_schedules_and_services_rel.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA ASSOCIATIVA DE ESPECIALIDADES DO BARBEIRO (barber_services)
-- Define quais serviços cada profissional atende e se há preço/duração customizados
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    custom_price NUMERIC(10, 2),
    custom_duration_minutes INT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (barber_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_barber_services_barber ON public.barber_services(barber_id);
CREATE INDEX IF NOT EXISTS idx_barber_services_service ON public.barber_services(service_id);

COMMENT ON TABLE public.barber_services IS 'Associação N:N entre barbeiros e serviços habilitados para atendimento.';

-- ------------------------------------------------------------------------------
-- 2. TABELA DE JORNADA DE TRABALHO REGULAR (barber_schedules)
-- Configura os dias da semana (0=Domingo a 6=Sábado) e horários de cada barbeiro
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL DEFAULT '09:00:00',
    end_time TIME NOT NULL DEFAULT '20:00:00',
    lunch_start TIME DEFAULT '12:00:00',
    lunch_end TIME DEFAULT '13:00:00',
    is_working_day BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (barber_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_barber_schedules_lookup 
    ON public.barber_schedules(barber_id, day_of_week, is_working_day);

DROP TRIGGER IF EXISTS trg_barber_schedules_updated_at ON public.barber_schedules;
CREATE TRIGGER trg_barber_schedules_updated_at
    BEFORE UPDATE ON public.barber_schedules
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.barber_schedules IS 'Expediente e horários de trabalho semanais por barbeiro.';

-- ------------------------------------------------------------------------------
-- 3. TABELA DE EXCEÇÕES E FOLGAS DO EXPEDIENTE (barber_exceptions)
-- Registra folgas, feriados ou horários especiais para uma data específica
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    is_available BOOLEAN NOT NULL DEFAULT FALSE, -- FALSE = Folga / Bloqueado
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (barber_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_barber_exceptions_lookup 
    ON public.barber_exceptions(barber_id, exception_date);

COMMENT ON TABLE public.barber_exceptions IS 'Bloqueios pontuais, folgas ou horários especiais por barbeiro.';
