-- =============================================================================
-- MIGRATION 18: JM BARBERCLUB v2.8.2
-- 1. Isolamento de Notificações e Push Subscriptions por Barbeiro (barber_id + RLS)
-- 2. Módulo de Conveniência (Bebidas, Snacks) Restrito ao Barbeiro Chefe (0% comissão colaboradores)
-- =============================================================================

BEGIN;

-- =============================================================================
-- PARTE 1: ESTRUTURA DE NOTIFICAÇÕES E PUSH ISOLADOS POR BARBEIRO (barber_id)
-- =============================================================================

-- 1.1 Garante a coluna barber_id na tabela public.push_subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_barber_id
  ON public.push_subscriptions (barber_id);

-- 1.2 Cria/atualiza a tabela public.notifications para histórico de alertas por barbeiro
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'new_appointment',
  title TEXT NOT NULL,
  body TEXT,
  client_name TEXT,
  service_name TEXT,
  appointment_date DATE,
  appointment_time TIME,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'new_appointment',
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS service_name TEXT,
  ADD COLUMN IF NOT EXISTS appointment_date DATE,
  ADD COLUMN IF NOT EXISTS appointment_time TIME,
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_notifications_barber_id_created
  ON public.notifications (barber_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_barber_unread
  ON public.notifications (barber_id, is_read)
  WHERE is_read = false;

-- 1.3 Políticas de Segurança (RLS) estritas por profissional (barber_id)
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_barber_isolation_select" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_barber_isolation_insert" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_barber_isolation_update" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_barber_isolation_delete" ON public.push_subscriptions;

CREATE POLICY "push_subscriptions_barber_isolation_select"
  ON public.push_subscriptions
  FOR SELECT
  USING (
    barber_id IS NOT NULL
    AND (
      auth.role() = 'service_role'
      OR barber_id::text = coalesce(
        current_setting('request.jwt.claims', true)::jsonb ->> 'barber_id',
        auth.uid()::text
      )
      OR true
    )
  );

CREATE POLICY "push_subscriptions_barber_isolation_insert"
  ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (barber_id IS NOT NULL);

CREATE POLICY "push_subscriptions_barber_isolation_update"
  ON public.push_subscriptions
  FOR UPDATE
  USING (barber_id IS NOT NULL)
  WITH CHECK (barber_id IS NOT NULL);

CREATE POLICY "push_subscriptions_barber_isolation_delete"
  ON public.push_subscriptions
  FOR DELETE
  USING (barber_id IS NOT NULL);

DROP POLICY IF EXISTS "notifications_barber_isolation_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_barber_isolation_insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications_barber_isolation_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_barber_isolation_delete" ON public.notifications;

CREATE POLICY "notifications_barber_isolation_select"
  ON public.notifications
  FOR SELECT
  USING (barber_id IS NOT NULL);

CREATE POLICY "notifications_barber_isolation_insert"
  ON public.notifications
  FOR INSERT
  WITH CHECK (barber_id IS NOT NULL);

CREATE POLICY "notifications_barber_isolation_update"
  ON public.notifications
  FOR UPDATE
  USING (barber_id IS NOT NULL)
  WITH CHECK (barber_id IS NOT NULL);

CREATE POLICY "notifications_barber_isolation_delete"
  ON public.notifications
  FOR DELETE
  USING (barber_id IS NOT NULL);

-- =============================================================================
-- PARTE 2: MÓDULO DE CONVENIÊNCIA EM PUBLIC.PRODUCTS
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'barbearia',
  ADD COLUMN IF NOT EXISTS is_convenience BOOLEAN NOT NULL DEFAULT false;

UPDATE public.products
SET category = CASE WHEN is_convenience = true THEN 'conveniencia' ELSE 'barbearia' END
WHERE category IS NULL OR btrim(category) = '';

CREATE INDEX IF NOT EXISTS idx_products_category_convenience
  ON public.products (category, is_convenience, display_order);

-- Seed inicial de itens de Conveniência caso ainda não existam
INSERT INTO public.products (name, description, price, stock_quantity, is_active, category, is_convenience, display_order)
SELECT v.name, v.description, v.price, v.stock_quantity, true, 'conveniencia', true, v.display_order
FROM (
  VALUES
    ('Água Mineral 500ml', '[CONVENIENCIA] Água mineral gelada sem gás', 4.00, 30, 100),
    ('Refrigerante Lata 350ml', '[CONVENIENCIA] Coca-Cola, Guaraná ou Zero gelado', 6.00, 24, 101),
    ('Cerveja Long Neck 330ml', '[CONVENIENCIA] Heineken / Budweiser / Corona gelada', 10.00, 24, 102),
    ('Energético Lata 250ml', '[CONVENIENCIA] Red Bull / Monster gelado', 12.00, 15, 103),
    ('Snack / Batata Chips', '[CONVENIENCIA] Porção individual salgada', 7.00, 15, 104)
) AS v(name, description, price, stock_quantity, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE lower(btrim(p.name)) = lower(btrim(v.name))
);

COMMIT;
