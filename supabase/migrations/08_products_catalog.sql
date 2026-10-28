-- ==============================================================================
-- MIGRAÇÃO 08: TABELA DE PRODUTOS (public.products)
-- Sistema: JM BarberClub (Next.js PWA + Painel do Barbeiro)
-- Arquivo: supabase/migrations/08_products_catalog.sql
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL DEFAULT 0.00,
    stock_quantity integer NOT NULL DEFAULT 0,
    image_url text,
    image_path text,
    is_active boolean NOT NULL DEFAULT true,
    display_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_active_order
ON public.products (is_active, display_order ASC, name ASC);

DROP TRIGGER IF EXISTS trg_update_products_timestamp ON public.products;
CREATE TRIGGER trg_update_products_timestamp
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Allow public read products" ON public.products FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage products" ON public.products FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT ALL ON public.products TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
