-- =============================================================================
-- 04_cash_flow_and_finance.sql
-- Livro caixa (cash_flow) e controle financeiro do JM Barberclub
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cash_flow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('entrada', 'saida')),
  category TEXT NOT NULL DEFAULT 'atendimento',
  amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  payment_method TEXT DEFAULT 'pix',
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_flow_occurred_at ON public.cash_flow (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_flow_barber_id ON public.cash_flow (barber_id);
