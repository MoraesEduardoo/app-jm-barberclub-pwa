-- =============================================================================
-- MIGRATION 18: JM BARBERCLUB v2.8.2
-- 1. Isolamento de Notificações e Push Subscriptions por Barbeiro (barber_id + RLS)
-- 2. Criação e Estrutura Completa de Produtos & Conveniência (public.products + public.appointment_convenience_items)
-- =============================================================================

BEGIN;

-- =============================================================================
-- PARTE 1: ESTRUTURA DE NOTIFICAÇÕES E PUSH ISOLADOS POR BARBEIRO (barber_id)
-- =============================================================================

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

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_barber_isolation_select" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_barber_isolation_insert" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_barber_isolation_update" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_barber_isolation_delete" ON public.push_subscriptions;

CREATE POLICY "push_subscriptions_barber_isolation_select"
  ON public.push_subscriptions
  FOR SELECT
  USING (barber_id IS NOT NULL);

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
-- PARTE 2: TABELAS E POLÍTICAS DE PRODUTOS E CONVENIÊNCIA
-- =============================================================================

-- 2.1 Garante a existência completa da tabela public.products
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'barbearia',
  is_convenience BOOLEAN NOT NULL DEFAULT false,
  image_url TEXT,
  image_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'barbearia',
  ADD COLUMN IF NOT EXISTS is_convenience BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS image_path TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.products
SET
  is_convenience = CASE
    WHEN is_convenience = true
      OR lower(btrim(coalesce(category, ''))) IN ('conveniencia', 'conveniência', 'convenience')
      OR coalesce(description, '') ILIKE '[CONVENIENCIA]%'
      OR coalesce(description, '') ILIKE '[CONVENIÊNCIA]%'
    THEN true
    ELSE false
  END,
  category = CASE
    WHEN is_convenience = true
      OR lower(btrim(coalesce(category, ''))) IN ('conveniencia', 'conveniência', 'convenience')
      OR coalesce(description, '') ILIKE '[CONVENIENCIA]%'
      OR coalesce(description, '') ILIKE '[CONVENIÊNCIA]%'
    THEN 'conveniencia'
    ELSE 'barbearia'
  END;

CREATE INDEX IF NOT EXISTS idx_products_category_convenience
  ON public.products (category, is_convenience, display_order);

-- 2.2 Cria a tabela de itens de conveniência/produtos vinculados aos atendimentos
CREATE TABLE IF NOT EXISTS public.appointment_convenience_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'conveniencia',
  is_convenience BOOLEAN NOT NULL DEFAULT true,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_convenience_items_appt
  ON public.appointment_convenience_items (appointment_id);

-- 2.3 Permissões e Políticas de Segurança (RLS) para garantir escrita sem falhas
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_convenience_items ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.products TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.appointment_convenience_items TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "products_public_read" ON public.products;
DROP POLICY IF EXISTS "products_authenticated_all" ON public.products;
DROP POLICY IF EXISTS "products_full_access_v282" ON public.products;

CREATE POLICY "products_full_access_v282"
  ON public.products
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "appointment_convenience_items_full_access_v282" ON public.appointment_convenience_items;

CREATE POLICY "appointment_convenience_items_full_access_v282"
  ON public.appointment_convenience_items
  FOR ALL
  TO anon, authenticated, service_role
  USING (true)
  WITH CHECK (true);

-- 2.4 Função RPC SECURITY DEFINER para carregar os itens padrão de Conveniência sem bloqueio de RLS
CREATE OR REPLACE FUNCTION public.seed_default_convenience_products()
RETURNS SETOF public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.products (name, description, price, stock_quantity, is_active, category, is_convenience, display_order)
  SELECT v.name, v.description, v.price, v.stock_quantity, true, 'conveniencia', true, v.display_order
  FROM (
    VALUES
      ('Água Mineral 500ml', '[CONVENIENCIA] Água mineral gelada sem gás', 4.00::numeric, 30, 100),
      ('Refrigerante Lata 350ml', '[CONVENIENCIA] Coca-Cola, Guaraná ou Zero gelado', 6.00::numeric, 24, 101),
      ('Cerveja Long Neck 330ml', '[CONVENIENCIA] Heineken / Budweiser / Corona gelada', 10.00::numeric, 24, 102),
      ('Energético Lata 250ml', '[CONVENIENCIA] Red Bull / Monster gelado', 12.00::numeric, 15, 103),
      ('Snack / Batata Chips', '[CONVENIENCIA] Porção individual salgada', 7.00::numeric, 15, 104)
  ) AS v(name, description, price, stock_quantity, display_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE lower(btrim(p.name)) = lower(btrim(v.name))
  );

  RETURN QUERY
  SELECT * FROM public.products
  WHERE is_convenience = true OR category = 'conveniencia'
  ORDER BY display_order ASC, name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_default_convenience_products() TO anon, authenticated, service_role;

-- 2.5 Executa o seed inicial de Conveniência imediatamente
SELECT public.seed_default_convenience_products();

NOTIFY pgrst, 'reload schema';

COMMIT;
