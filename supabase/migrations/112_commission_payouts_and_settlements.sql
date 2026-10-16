-- ==============================================================================
-- MIGRAÇÃO 112: FECHAMENTO DE CAIXA E ACERTO DE COMISSÕES (COMMISSION PAYOUTS)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão Financeira)
-- Arquivo: supabase/migrations/112_commission_payouts_and_settlements.sql
-- ==============================================================================

-- 1. CRIAÇÃO DA TABELA DE ACERTOS DE COMISSÕES
CREATE TABLE IF NOT EXISTS public.commission_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_code VARCHAR(50) UNIQUE NOT NULL,
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE RESTRICT,
    admin_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_label VARCHAR(100),
    total_revenue NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    commission_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 50.00,
    appointments_count INTEGER NOT NULL DEFAULT 0,
    payment_method VARCHAR(30) NOT NULL DEFAULT 'pix', -- 'pix', 'dinheiro', 'transferencia'
    status VARCHAR(20) NOT NULL DEFAULT 'paid', -- 'paid', 'pending', 'cancelled'
    notes TEXT,
    appointment_ids JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. ÍNDICES DE ALTA PERFORMANCE PARA CONSULTAS E AUDITORIA
CREATE INDEX IF NOT EXISTS idx_commission_payouts_barber_id ON public.commission_payouts(barber_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_admin_id ON public.commission_payouts(admin_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_period ON public.commission_payouts(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_paid_at ON public.commission_payouts(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_receipt_code ON public.commission_payouts(receipt_code);

-- 3. VINCULAÇÃO COM A TABELA DE AGENDAMENTOS (PARA AUDITORIA ATÔMICA)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'commission_payout_id'
    ) THEN
        ALTER TABLE public.appointments ADD COLUMN commission_payout_id UUID REFERENCES public.commission_payouts(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_appointments_commission_payout_id ON public.appointments(commission_payout_id);
    END IF;
END $$;

-- 4. POLÍTICAS DE SEGURANÇA (ROW LEVEL SECURITY - RLS)
ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas se existirem para evitar conflito
DROP POLICY IF EXISTS "Chefes gerenciam todos os acertos" ON public.commission_payouts;
DROP POLICY IF EXISTS "Barbeiros visualizam seus próprios acertos" ON public.commission_payouts;

-- A) Chefe / Admin tem controle total sobre acertos
CREATE POLICY "Chefes gerenciam todos os acertos"
ON public.commission_payouts
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM public.barbers 
        WHERE barbers.id = auth.uid() AND barbers.role = 'admin'
    ) OR current_user = 'service_role'
);

-- B) Barbeiro colaborador pode consultar apenas os seus próprios recibos de comissão
CREATE POLICY "Barbeiros visualizam seus próprios acertos"
ON public.commission_payouts
FOR SELECT
USING (
    barber_id = auth.uid() OR current_user = 'service_role'
);
