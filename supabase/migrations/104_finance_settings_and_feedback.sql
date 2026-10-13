-- ==============================================================================
-- MIGRAÇÃO 104: FLUXO DE CAIXA (CASH_FLOW), CONFIGURAÇÕES GERAIS E FEEDBACKS
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/104_finance_settings_and_feedback.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA DE FLUXO DE CAIXA E DESPESAS (cash_flow)
-- Registra as despesas operacionais da barbearia (aluguel, produtos, contas) e
-- receitas avulsas não vinculadas diretamente à agenda. Exclusivo do Chefe.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_flow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL, -- Responsável pelo lançamento
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    category VARCHAR(60) NOT NULL DEFAULT 'outros',
    description TEXT,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_method VARCHAR(30),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para relatórios e fechamentos de período
CREATE INDEX IF NOT EXISTS idx_cash_flow_period 
    ON cash_flow(type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_flow_barber 
    ON cash_flow(barber_id, occurred_at DESC);

DROP TRIGGER IF EXISTS trg_cash_flow_updated_at ON cash_flow;
CREATE TRIGGER trg_cash_flow_updated_at
    BEFORE UPDATE ON cash_flow
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE cash_flow IS 'Lançamentos de despesas e receitas avulsas do painel financeiro do chefe.';
COMMENT ON COLUMN cash_flow.barber_id IS 'Barbeiro/administrador responsável pelo lançamento financeiro.';

-- ------------------------------------------------------------------------------
-- 2. CONFIGURAÇÕES GLOBAIS DO NEGÓCIO (business_settings)
-- Guarda parâmetros gerais do sistema como horários padrão, tempo de buffer,
-- chaves de integração e mensagens de cancelamento/re-agendamento.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_settings_key ON business_settings(key);

DROP TRIGGER IF EXISTS trg_business_settings_updated_at ON business_settings;
CREATE TRIGGER trg_business_settings_updated_at
    BEFORE UPDATE ON business_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE business_settings IS 'Parâmetros de configuração globais do estabelecimento e do motor de agendamento.';

-- Sementes de configurações padrão (idempotentes via ON CONFLICT)
INSERT INTO business_settings (key, value, description)
VALUES 
    (
        'default_buffer_minutes', 
        '10'::jsonb, 
        'Buffer padrão em minutos para higienização da bancada entre atendimentos'
    ),
    (
        'operating_hours', 
        '{"weekday_start": "09:00", "weekday_end": "20:00", "saturday_end": "19:00", "sunday_open": false}'::jsonb, 
        'Horário geral de funcionamento da barbearia'
    ),
    (
        'cancellation_policy', 
        '{"min_hours_notice": 2, "auto_notify_waitlist": true}'::jsonb, 
        'Política de cancelamento e disparo automático para lista de espera'
    ),
    (
        'return_cycle_targets', 
        '{"warning_days": 21, "critical_days": 35}'::jsonb, 
        'Parâmetros para cálculo de lembrete de re-agendamento inteligente'
    )
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. AVALIAÇÕES E FEEDBACKS DE CLIENTES (client_feedbacks)
-- Guarda a nota (1 a 5) e comentários deixados pelos clientes após o corte.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_feedbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    client_name VARCHAR(150),
    client_phone VARCHAR(30),
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_barber ON client_feedbacks(barber_id, rating);
CREATE INDEX IF NOT EXISTS idx_feedbacks_date ON client_feedbacks(created_at DESC);

COMMENT ON TABLE client_feedbacks IS 'Feedbacks e pontuações de clientes vinculados ao agendamento e barbeiro.';
