-- ==============================================================================
-- MIGRAÇÃO 102: SERVIÇOS, ORDENAÇÃO, EXPEDIENTE E BUFFERS DE HIGIENIZAÇÃO
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/102_services_and_schedule.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA DE SERVIÇOS (services)
-- Catálogo de serviços com suporte a ordenação manual (display_order),
-- categorias para agrupamento no painel e duração padrão para cálculo de slots.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    description TEXT,
    category VARCHAR(60) NOT NULL DEFAULT 'cabelo',
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    default_duration_minutes INT NOT NULL DEFAULT 30 CHECK (default_duration_minutes > 0),
    display_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_active_order ON services(active, display_order);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);

DROP TRIGGER IF EXISTS trg_services_updated_at ON services;
CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE services IS 'Catálogo de cortes, barbas e tratamentos com ordenação e tempos de atendimento.';
COMMENT ON COLUMN services.display_order IS 'Ordem numérica para ordenação sequencial na interface do cliente e do barbeiro.';
COMMENT ON COLUMN services.default_duration_minutes IS 'Tempo de cadeira base utilizado para o cálculo da grade de horários.';

-- ------------------------------------------------------------------------------
-- 2. VÍNCULO DE SERVIÇOS E ESPECIALIDADES POR BARBEIRO (barber_services)
-- Define quais serviços cada barbeiro executa, permitindo durações personalizadas.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barber_services (
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    custom_duration_minutes INT CHECK (custom_duration_minutes > 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (barber_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_barber_services_service ON barber_services(service_id);

COMMENT ON TABLE barber_services IS 'Associação n:m entre barbeiros e os serviços que cada um executa.';

-- ------------------------------------------------------------------------------
-- 3. EXPEDIENTE SEMANAL E BUFFER DE ATENDIMENTO (barber_schedules)
-- Define os dias de funcionamento (0=Dom, 1=Seg.. 6=Sáb), horários de início e fim,
-- intervalo de almoço e o buffer de higienização de bancada (5 a 10 min).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barber_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_start TIME,
    break_end TIME,
    is_working BOOLEAN NOT NULL DEFAULT TRUE,
    buffer_minutes INT NOT NULL DEFAULT 10 CHECK (buffer_minutes >= 0 AND buffer_minutes <= 60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_barber_schedule_day UNIQUE (barber_id, day_of_week),
    CONSTRAINT chk_schedule_times CHECK (start_time < end_time),
    CONSTRAINT chk_break_times CHECK (
        (break_start IS NULL AND break_end IS NULL) OR 
        (break_start IS NOT NULL AND break_end IS NOT NULL AND break_start < break_end AND break_start >= start_time AND break_end <= end_time)
    )
);

CREATE INDEX IF NOT EXISTS idx_barber_schedules_lookup ON barber_schedules(barber_id, day_of_week, is_working);

DROP TRIGGER IF EXISTS trg_barber_schedules_updated_at ON barber_schedules;
CREATE TRIGGER trg_barber_schedules_updated_at
    BEFORE UPDATE ON barber_schedules
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE barber_schedules IS 'Expediente padrão semanal de cada barbeiro com buffer de higienização embutido.';
COMMENT ON COLUMN barber_schedules.buffer_minutes IS 'Tempo de respiro/limpeza entre atendimentos (ex: 5 a 10 min) antes da próxima vaga.';

-- ------------------------------------------------------------------------------
-- 4. EXCEÇÕES DE HORÁRIO E FOLGAS PONTUAIS (barber_schedule_overrides)
-- Permite bloqueios de agenda, feriados, folgas temporárias ou turnos especiais.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barber_schedule_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    override_date DATE NOT NULL,
    is_day_off BOOLEAN NOT NULL DEFAULT FALSE,
    start_time TIME,
    end_time TIME,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_barber_override_date UNIQUE (barber_id, override_date),
    CONSTRAINT chk_override_times CHECK (
        is_day_off = TRUE OR 
        (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
    )
);

CREATE INDEX IF NOT EXISTS idx_barber_overrides_date ON barber_schedule_overrides(barber_id, override_date);

COMMENT ON TABLE barber_schedule_overrides IS 'Exceções específicas ao expediente regular (folgas, férias e bloqueios pontuais).';
