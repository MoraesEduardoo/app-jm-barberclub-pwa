-- =============================================================================
-- 11_client_feedbacks.sql
-- Avaliações e feedbacks de clientes (client_feedbacks)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
  client_name TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
