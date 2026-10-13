-- ==============================================================================
-- MIGRAÇÃO 103: AGENDAMENTOS, CANCELAMENTO IMEDIATO E LISTA DE ESPERA (WAITLIST)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/103_appointments_and_waitlist.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA PRINCIPAL DE AGENDAMENTOS (appointments)
-- Mantém integridade referencial estrita com barbers (ON DELETE RESTRICT):
-- se um barbeiro for desativado ou removido, o histórico financeiro e de
-- atendimentos permanece 100% íntegro e inviolável.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID REFERENCES barbers(id) ON DELETE RESTRICT,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    service VARCHAR(150),
    client_name VARCHAR(150),
    client_phone VARCHAR(30),
    appointment_date DATE,
    appointment_time TIME,
    end_time TIME,
    duration_minutes INT NOT NULL DEFAULT 30,
    buffer_minutes INT NOT NULL DEFAULT 10,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'confirmado',
    cancelled_at TIMESTAMPTZ,
    cancelled_by VARCHAR(50),
    cancellation_reason TEXT,
    payment_method VARCHAR(30),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'pendente',
    barber_commission_amount NUMERIC(10, 2),
    is_walk_in BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência garantida: se a tabela appointments já existia previamente, adiciona colunas faltantes
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service VARCHAR(150);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_name VARCHAR(150);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_phone VARCHAR(30);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_date DATE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_time TIME;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 30;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS buffer_minutes INT NOT NULL DEFAULT 10;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'confirmado';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(50);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'pendente';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS barber_commission_amount NUMERIC(10, 2);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_walk_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Índices de alta performance para a agenda diária e motor de horários livres
CREATE INDEX IF NOT EXISTS idx_appointments_agenda_lookup 
    ON appointments(barber_id, appointment_date, appointment_time);

CREATE INDEX IF NOT EXISTS idx_appointments_active_slots 
    ON appointments(barber_id, appointment_date, appointment_time, end_time) 
    WHERE status != 'cancelado';

CREATE INDEX IF NOT EXISTS idx_appointments_client_history 
    ON appointments(client_phone, appointment_date DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_status_date 
    ON appointments(status, appointment_date);

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE appointments IS 'Registro dos atendimentos com controle de status, cancelamento e integridade financeira.';
COMMENT ON COLUMN appointments.barber_id IS 'Chave estrangeira com ON DELETE RESTRICT para proteger relatórios e comissões.';
COMMENT ON COLUMN appointments.cancelled_at IS 'Data/hora exata do cancelamento para auditoria e acionamento da fila de espera.';

-- ------------------------------------------------------------------------------
-- 2. TABELA DE LISTA DE ESPERA (waitlist)
-- Regista clientes que manifestaram interesse em horários já ocupados.
-- Ao ocorrer cancelamento, a fila é consultada imediatamente para notificação.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID REFERENCES barbers(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    client_name VARCHAR(150) NOT NULL,
    client_phone VARCHAR(30) NOT NULL,
    desired_date DATE NOT NULL,
    desired_time TIME,
    notes TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'aguardando' 
        CHECK (status IN ('aguardando', 'notificado', 'agendado', 'cancelado', 'expirado')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para localização rápida de interessados em vagas canceladas
CREATE INDEX IF NOT EXISTS idx_waitlist_match 
    ON waitlist(desired_date, barber_id, status) 
    WHERE status = 'aguardando';

CREATE INDEX IF NOT EXISTS idx_waitlist_client_phone 
    ON waitlist(client_phone);

DROP TRIGGER IF EXISTS trg_waitlist_updated_at ON waitlist;
CREATE TRIGGER trg_waitlist_updated_at
    BEFORE UPDATE ON waitlist
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE waitlist IS 'Lista de espera de horários concorridos para preenchimento de vagas canceladas.';
