-- =============================================================================
-- 09_commission_payouts.sql
-- Histórico de fechamento e acerto de comissões (commission_payouts)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.commission_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  barber_name TEXT,
  admin_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
  admin_name TEXT,
  receipt_code TEXT NOT NULL UNIQUE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_label TEXT,
  appointments_count INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  commission_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  payment_method TEXT NOT NULL DEFAULT 'pix',
  cash_flow_id UUID REFERENCES public.cash_flow(id) ON DELETE SET NULL,
  notes TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_payouts_barber ON public.commission_payouts (barber_id, paid_at DESC);
