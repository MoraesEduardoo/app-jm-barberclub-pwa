-- ==============================================================================
-- MIGRAÇÃO 004: FINANCEIRO, FECHAMENTO DE COMISSÕES E CONFIGURAÇÕES
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Barbearia)
-- Arquivo: supabase/migrations/004_finance_and_commissions.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA DE FECHAMENTO E ACERTO DE COMISSÕES (commission_payouts)
-- Permite ao Chefe fechar o caixa da equipe, gerar recibos e vincular aos cortes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commission_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_code VARCHAR(50) UNIQUE NOT NULL,
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_label VARCHAR(100),
    total_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    commission_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 50.00,
    appointments_count INTEGER NOT NULL DEFAULT 0,
    payment_method VARCHAR(30) NOT NULL DEFAULT 'pix', -- 'pix', 'dinheiro', 'transferencia'
    status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'pending', 'cancelled')),
    notes TEXT,
    appointment_ids JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_payouts_barber 
    ON public.commission_payouts(barber_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_commission_payouts_period 
    ON public.commission_payouts(period_start, period_end);

DROP TRIGGER IF EXISTS trg_commission_payouts_updated_at ON public.commission_payouts;
CREATE TRIGGER trg_commission_payouts_updated_at
    BEFORE UPDATE ON public.commission_payouts
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- Vincula a foreign key em appointments de forma segura com ON DELETE SET NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'appointments_commission_payout_id_fkey'
    ) THEN
        ALTER TABLE public.appointments
            ADD CONSTRAINT appointments_commission_payout_id_fkey
            FOREIGN KEY (commission_payout_id)
            REFERENCES public.commission_payouts(id)
            ON DELETE SET NULL;
            
        CREATE INDEX IF NOT EXISTS idx_appointments_commission_payout 
            ON public.appointments(commission_payout_id);
    END IF;
END $$;

COMMENT ON TABLE public.commission_payouts IS 'Lotes de pagamentos de comissões e fechamento de caixa por barbeiro.';

-- ------------------------------------------------------------------------------
-- 2. TABELA DE LIVRO CAIXA E DESPESAS OPERACIONAIS (cash_flow)
-- Registra despesas fixas/variáveis e receitas avulsas da barbearia
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_flow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL, -- Responsável pelo lançamento
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    category VARCHAR(60) NOT NULL DEFAULT 'outros',
    description TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_method VARCHAR(30) DEFAULT 'pix',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_flow_period 
    ON public.cash_flow(type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_flow_barber 
    ON public.cash_flow(barber_id);

DROP TRIGGER IF EXISTS trg_cash_flow_updated_at ON public.cash_flow;
CREATE TRIGGER trg_cash_flow_updated_at
    BEFORE UPDATE ON public.cash_flow
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.cash_flow IS 'Livro caixa para registro de despesas operacionais e receitas do estabelecimento.';

-- ------------------------------------------------------------------------------
-- 3. TABELA DE CONFIGURAÇÕES GLOBAIS DO NEGÓCIO (business_settings)
-- Parâmetros do sistema: tolerância de cancelamento, horário geral e intervalos
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_settings_key ON public.business_settings(key);

DROP TRIGGER IF EXISTS trg_business_settings_updated_at ON public.business_settings;
CREATE TRIGGER trg_business_settings_updated_at
    BEFORE UPDATE ON public.business_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- Configurações Iniciais da JM Barberclub
INSERT INTO public.business_settings (key, value, description)
VALUES 
    (
        'operating_hours', 
        '{"weekday_start": "09:00", "weekday_end": "20:00", "saturday_end": "19:00", "sunday_open": false}'::jsonb, 
        'Horário geral de funcionamento da barbearia'
    ),
    (
        'default_buffer_minutes', 
        '10'::jsonb, 
        'Buffer padrão em minutos para higienização entre atendimentos'
    ),
    (
        'cancellation_policy', 
        '{"min_hours_notice": 2, "auto_notify_waitlist": true}'::jsonb, 
        'Política de cancelamento e disparo automático para fila de espera'
    ),
    (
        'return_cycle_targets', 
        '{"warning_days": 21, "critical_days": 35}'::jsonb, 
        'Metas para cálculo de lembrete de re-agendamento de retorno'
    )
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 4. VIEW CONSOLIDADA DE FLUXO DE CAIXA MENSAL (view_monthly_cash_flow)
-- Alimenta relatórios DRE e indicadores de receitas/despesas da barbearia
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_monthly_cash_flow AS
SELECT 
    TO_CHAR(COALESCE(occurred_at, created_at), 'YYYY-MM') AS month_ref,
    COALESCE(SUM(CASE WHEN type IN ('income', 'entrada') THEN amount ELSE 0 END), 0)::NUMERIC(10, 2) AS total_income,
    COALESCE(SUM(CASE WHEN type IN ('expense', 'saida') THEN amount ELSE 0 END), 0)::NUMERIC(10, 2) AS total_expense,
    COALESCE(SUM(CASE WHEN type IN ('income', 'entrada') THEN amount ELSE -amount END), 0)::NUMERIC(10, 2) AS net_balance,
    COUNT(*)::INT AS total_entries
FROM public.cash_flow
GROUP BY TO_CHAR(COALESCE(occurred_at, created_at), 'YYYY-MM');

COMMENT ON VIEW public.view_monthly_cash_flow IS 'Demonstrativo de Resultado do Exercício mensal consolidado a partir do livro caixa.';

