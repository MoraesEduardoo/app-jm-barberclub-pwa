-- ==============================================================================
-- MIGRAÇÃO 08: TABELA DE PRODUTOS (public.products), RLS E STORAGE BUCKET
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/08_products_catalog.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CRIAÇÃO DA TABELA public.products
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL DEFAULT 0.00,
    stock_quantity integer NOT NULL DEFAULT 0,
    image_url text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    display_order integer NOT NULL DEFAULT 0,
    image_path text
);

-- Garantia idempotente de todas as colunas caso a tabela já exista parcialmente
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price numeric(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_quantity integer NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_path text;

-- Índices de performance para listagem ativa na Homepage e no Painel do Barbeiro
CREATE INDEX IF NOT EXISTS idx_products_active_created
ON public.products (is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_active_order
ON public.products (is_active, display_order ASC, name ASC);

-- Trigger de atualização automática de updated_at (se a função existir)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'set_updated_at_column'
    ) THEN
        DROP TRIGGER IF EXISTS trg_update_products_timestamp ON public.products;
        CREATE TRIGGER trg_update_products_timestamp
        BEFORE UPDATE ON public.products
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_column();
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. POLÍTICAS DE SEGURANÇA (RLS - ROW LEVEL SECURITY) EM public.products
-- ------------------------------------------------------------------------------
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas para recriar de forma limpa e idempotente
DROP POLICY IF EXISTS "Allow public read products" ON public.products;
DROP POLICY IF EXISTS "Allow admin manage products" ON public.products;
DROP POLICY IF EXISTS "products_select_public" ON public.products;
DROP POLICY IF EXISTS "products_insert_authenticated" ON public.products;
DROP POLICY IF EXISTS "products_update_authenticated" ON public.products;
DROP POLICY IF EXISTS "products_delete_authenticated" ON public.products;

-- Leitura pública (SELECT para utilizadores anónimos e autenticados, para a homepage e painel)
CREATE POLICY "products_select_public"
ON public.products
FOR SELECT
TO anon, authenticated
USING (true);

-- Gestão completa (INSERT, UPDATE, DELETE para administradores/barbeiros autenticados)
CREATE POLICY "products_insert_authenticated"
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "products_update_authenticated"
ON public.products
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "products_delete_authenticated"
ON public.products
FOR DELETE
TO authenticated
USING (true);

-- Compatibilidade com chamadas do painel administrativo via role anon/service_role
CREATE POLICY "Allow admin manage products"
ON public.products
FOR ALL
USING (true)
WITH CHECK (true);

-- Grants na tabela public.products
GRANT ALL ON public.products TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3. STORAGE: BUCKET PÚBLICO DE IMAGENS DE PRODUTOS (product-images)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'product-images',
    'product-images',
    true,
    5242880, -- 5MB
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
    public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Políticas de acesso no Storage (storage.objects) para o bucket 'product-images'
DROP POLICY IF EXISTS "product_images_public_select" ON storage.objects;
DROP POLICY IF EXISTS "product_images_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_images_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "product_images_auth_delete" ON storage.objects;

-- Permissão de leitura pública para fotos de produtos
CREATE POLICY "product_images_public_select"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'product-images');

-- Permissão de escrita (upload), atualização e exclusão para utilizadores autenticados
CREATE POLICY "product_images_auth_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_auth_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images')
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_auth_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'product-images');

-- Notifica o PostgREST para recarregar o schema imediatamente
NOTIFY pgrst, 'reload schema';
