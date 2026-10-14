-- ==============================================================================
-- MIGRAÇÃO 109: SERVIÇOS OFICIAIS, REORDENAÇÃO E TABELA DA GALERIA DE CORTES
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/109_services_official_and_haircut_gallery.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA SERVICES: COLUNAS DE ORDENAÇÃO E PREÇO EM CENTAVOS
-- ------------------------------------------------------------------------------
ALTER TABLE services ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS price_in_cents INT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS category VARCHAR(60) NOT NULL DEFAULT 'cabelo';

CREATE INDEX IF NOT EXISTS idx_services_display_order ON services(display_order ASC);

-- ------------------------------------------------------------------------------
-- 2. CADASTRO/ATUALIZAÇÃO DOS 11 SERVIÇOS OFICIAIS DA JM BARBERCLUB
-- Ordem definida pelo catálogo oficial da barbearia (preços em reais e centavos):
-- 1. Degradê — R$ 25,00 (2500)
-- 2. Corte SÓ Tesoura — R$ 25,00 (2500)
-- 3. Lowfade ou Americano — R$ 25,00 (2500)
-- 4. Barboterapia — R$ 20,00 (2000)
-- 5. Corte e Barboterapia — R$ 40,00 (4000)
-- 6. Corte + Barba Simples — R$ 35,00 (3500)
-- 7. Barba (Cavanhaque ou Design Simples) — R$ 15,00 (1500)
-- 8. Degradê + Sobrancelha — R$ 30,00 (3000)
-- 9. Social + Sobrancelha — R$ 25,00 (2500)
-- 10. Corte Simples ou Social — R$ 20,00 (2000)
-- 11. Limpeza de Pele — R$ 15,00 (1500)
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    -- 1. Degradê
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%degrad%' AND name NOT ILIKE '%sobrancelha%') THEN
        UPDATE services 
        SET name = 'Degradê', price = 25.00, price_in_cents = 2500, category = 'cabelo', display_order = 0, default_duration_minutes = 30, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%degrad%' AND name NOT ILIKE '%sobrancelha%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Degradê', 25.00, 2500, 'cabelo', 0, 30, TRUE);
    END IF;

    -- 2. Corte SÓ Tesoura
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%tesoura%') THEN
        UPDATE services 
        SET name = 'Corte SÓ Tesoura', price = 25.00, price_in_cents = 2500, category = 'cabelo', display_order = 1, default_duration_minutes = 35, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%tesoura%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Corte SÓ Tesoura', 25.00, 2500, 'cabelo', 1, 35, TRUE);
    END IF;

    -- 3. Lowfade ou Americano
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%lowfade%' OR name ILIKE '%americano%') THEN
        UPDATE services 
        SET name = 'Lowfade ou Americano', price = 25.00, price_in_cents = 2500, category = 'cabelo', display_order = 2, default_duration_minutes = 30, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%lowfade%' OR name ILIKE '%americano%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Lowfade ou Americano', 25.00, 2500, 'cabelo', 2, 30, TRUE);
    END IF;

    -- 4. Barboterapia
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE 'barboterapia%') THEN
        UPDATE services 
        SET name = 'Barboterapia', price = 20.00, price_in_cents = 2000, category = 'barba', display_order = 3, default_duration_minutes = 25, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE 'barboterapia%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Barboterapia', 20.00, 2000, 'barba', 3, 25, TRUE);
    END IF;

    -- 5. Corte e Barboterapia
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%corte%' AND name ILIKE '%barboterapia%') THEN
        UPDATE services 
        SET name = 'Corte e Barboterapia', price = 40.00, price_in_cents = 4000, category = 'combo', display_order = 4, default_duration_minutes = 50, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%corte%' AND name ILIKE '%barboterapia%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Corte e Barboterapia', 40.00, 4000, 'combo', 4, 50, TRUE);
    END IF;

    -- 6. Corte + Barba Simples
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%barba simples%') THEN
        UPDATE services 
        SET name = 'Corte + Barba Simples', price = 35.00, price_in_cents = 3500, category = 'combo', display_order = 5, default_duration_minutes = 45, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%barba simples%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Corte + Barba Simples', 35.00, 3500, 'combo', 5, 45, TRUE);
    END IF;

    -- 7. Barba (Cavanhaque ou Design Simples)
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%cavanhaque%' OR name ILIKE '%design simples%') THEN
        UPDATE services 
        SET name = 'Barba (Cavanhaque ou Design Simples)', price = 15.00, price_in_cents = 1500, category = 'barba', display_order = 6, default_duration_minutes = 20, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%cavanhaque%' OR name ILIKE '%design simples%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Barba (Cavanhaque ou Design Simples)', 15.00, 1500, 'barba', 6, 20, TRUE);
    END IF;

    -- 8. Degradê + Sobrancelha
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%degrad%' AND name ILIKE '%sobrancelha%') THEN
        UPDATE services 
        SET name = 'Degradê + Sobrancelha', price = 30.00, price_in_cents = 3000, category = 'combo', display_order = 7, default_duration_minutes = 35, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%degrad%' AND name ILIKE '%sobrancelha%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Degradê + Sobrancelha', 30.00, 3000, 'combo', 7, 35, TRUE);
    END IF;

    -- 9. Social + Sobrancelha
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%social%' AND name ILIKE '%sobrancelha%') THEN
        UPDATE services 
        SET name = 'Social + Sobrancelha', price = 25.00, price_in_cents = 2500, category = 'combo', display_order = 8, default_duration_minutes = 35, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%social%' AND name ILIKE '%sobrancelha%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Social + Sobrancelha', 25.00, 2500, 'combo', 8, 35, TRUE);
    END IF;

    -- 10. Corte Simples ou Social
    IF EXISTS (SELECT 1 FROM services WHERE (name ILIKE '%corte simples%' OR name ILIKE '%social%') AND name NOT ILIKE '%sobrancelha%') THEN
        UPDATE services 
        SET name = 'Corte Simples ou Social', price = 20.00, price_in_cents = 2000, category = 'cabelo', display_order = 9, default_duration_minutes = 25, active = TRUE
        WHERE id = (SELECT id FROM services WHERE (name ILIKE '%corte simples%' OR name ILIKE '%social%') AND name NOT ILIKE '%sobrancelha%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Corte Simples ou Social', 20.00, 2000, 'cabelo', 9, 25, TRUE);
    END IF;

    -- 11. Limpeza de Pele
    IF EXISTS (SELECT 1 FROM services WHERE name ILIKE '%limpeza de pele%') THEN
        UPDATE services 
        SET name = 'Limpeza de Pele', price = 15.00, price_in_cents = 1500, category = 'tratamento', display_order = 10, default_duration_minutes = 20, active = TRUE
        WHERE id = (SELECT id FROM services WHERE name ILIKE '%limpeza de pele%' LIMIT 1);
    ELSE
        INSERT INTO services (name, price, price_in_cents, category, display_order, default_duration_minutes, active)
        VALUES ('Limpeza de Pele', 15.00, 1500, 'tratamento', 10, 20, TRUE);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. TABELA DA GALERIA DE CORTES (haircut_gallery)
-- Catálogo de inspirações e fotos de referência organizadas por categoria
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS haircut_gallery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(60) NOT NULL,
    category VARCHAR(30) NOT NULL CHECK (category IN ('degrade', 'social', 'barba', 'infantil', 'outros')),
    barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    image_path TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência de colunas
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS title VARCHAR(60);
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'degrade';
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL;
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_haircut_gallery_category ON haircut_gallery(category, is_active);
CREATE INDEX IF NOT EXISTS idx_haircut_gallery_created_at ON haircut_gallery(created_at DESC);

-- Trigger de updated_at para haircut_gallery
DROP TRIGGER IF EXISTS trg_haircut_gallery_updated_at ON haircut_gallery;
CREATE TRIGGER trg_haircut_gallery_updated_at
    BEFORE UPDATE ON haircut_gallery
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- RLS e Políticas
ALTER TABLE haircut_gallery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "haircut_gallery_select_policy" ON haircut_gallery;
CREATE POLICY "haircut_gallery_select_policy" ON haircut_gallery
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "haircut_gallery_modify_policy" ON haircut_gallery;
CREATE POLICY "haircut_gallery_modify_policy" ON haircut_gallery
    FOR ALL USING (
        auth.role() = 'service_role' 
        OR auth.role() = 'authenticated'
        OR is_active_barber()
        OR TRUE -- Permite gestão via painel interno
    );

-- Permissões completas de tabela
GRANT ALL ON haircut_gallery TO authenticated, anon, service_role;
GRANT ALL ON services TO authenticated, anon, service_role;

-- ------------------------------------------------------------------------------
-- 4. BUCKET DE ARMAZENAMENTO PARA FOTOS DA GALERIA (haircut-gallery)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('haircut-gallery', 'haircut-gallery', TRUE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
        ON CONFLICT (id) DO UPDATE 
        SET public = TRUE, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

        -- Garante política pública de leitura do bucket
        DROP POLICY IF EXISTS "Public Access to Haircut Gallery" ON storage.objects;
        CREATE POLICY "Public Access to Haircut Gallery" ON storage.objects
            FOR SELECT USING (bucket_id = 'haircut-gallery');

        DROP POLICY IF EXISTS "Barber Upload to Haircut Gallery" ON storage.objects;
        CREATE POLICY "Barber Upload to Haircut Gallery" ON storage.objects
            FOR ALL USING (bucket_id = 'haircut-gallery');
    END IF;
END $$;
