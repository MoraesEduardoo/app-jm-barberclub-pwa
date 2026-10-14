-- ==============================================================================
-- MIGRAÇÃO 110: AUDITORIA TOTAL DE INTEGRAÇÃO — STORAGE, GALERIA E EXPEDIENTE
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/110_audit_storage_gallery_and_schedules.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. BUCKETS DE STORAGE E POLÍTICAS PÚBLICAS
-- Garante a existência dos buckets 'haircut-gallery' e 'portfolio-images'
-- com acesso público de leitura e permissão irrestrita de upload para barbeiros/service_role.
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
        -- 1.1 Bucket principal: haircut-gallery
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('haircut-gallery', 'haircut-gallery', TRUE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'])
        ON CONFLICT (id) DO UPDATE 
        SET public = TRUE, 
            file_size_limit = 10485760, 
            allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

        -- 1.2 Bucket de compatibilidade: portfolio-images
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('portfolio-images', 'portfolio-images', TRUE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'])
        ON CONFLICT (id) DO UPDATE 
        SET public = TRUE, 
            file_size_limit = 10485760, 
            allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

        -- 1.3 Políticas de Leitura Pública
        DROP POLICY IF EXISTS "Public Access to Haircut Gallery" ON storage.objects;
        CREATE POLICY "Public Access to Haircut Gallery" ON storage.objects
            FOR SELECT USING (bucket_id IN ('haircut-gallery', 'portfolio-images'));

        -- 1.4 Políticas de Escrita/Upload
        DROP POLICY IF EXISTS "Barber Upload to Haircut Gallery" ON storage.objects;
        CREATE POLICY "Barber Upload to Haircut Gallery" ON storage.objects
            FOR ALL USING (bucket_id IN ('haircut-gallery', 'portfolio-images'))
            WITH CHECK (bucket_id IN ('haircut-gallery', 'portfolio-images'));
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. TABELA DA GALERIA DE CORTES (haircut_gallery) & COMPATIBILIDADE (portfolio_items)
-- Colunas flexíveis com suporte a image_path, image_url e storage_url.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS haircut_gallery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(120) NOT NULL DEFAULT 'Corte JM Barberclub',
    category VARCHAR(30) NOT NULL DEFAULT 'degrade',
    barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    image_path TEXT NOT NULL DEFAULT '',
    image_url TEXT,
    storage_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência de colunas em haircut_gallery
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS title VARCHAR(120) NOT NULL DEFAULT 'Corte JM Barberclub';
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'degrade';
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL;
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE haircut_gallery ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_haircut_gallery_category ON haircut_gallery(category, is_active);
CREATE INDEX IF NOT EXISTS idx_haircut_gallery_barber_id ON haircut_gallery(barber_id);
CREATE INDEX IF NOT EXISTS idx_haircut_gallery_created_at ON haircut_gallery(created_at DESC);

-- View/Tabela de compatibilidade para portfolio_items se consultada legada
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portfolio_items' AND table_schema = 'public') THEN
        CREATE VIEW portfolio_items AS 
        SELECT 
            id, 
            title, 
            category, 
            barber_id, 
            COALESCE(image_path, image_url, storage_url) AS image_path,
            COALESCE(image_url, storage_url, image_path) AS image_url,
            COALESCE(storage_url, image_url, image_path) AS storage_url,
            is_active, 
            created_at, 
            updated_at 
        FROM haircut_gallery;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. TABELA EXPEDIENTE (barber_schedules): COLUNAS, TIPOS E UNIQUE CONSTRAINT
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barber_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    day_of_week VARCHAR(20) NOT NULL,
    start_time TIME NOT NULL DEFAULT '09:00',
    end_time TIME NOT NULL DEFAULT '19:00',
    is_working BOOLEAN NOT NULL DEFAULT TRUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    has_lunch_break BOOLEAN NOT NULL DEFAULT FALSE,
    lunch_start TIME DEFAULT '12:00',
    lunch_end TIME DEFAULT '13:00',
    break_start TIME DEFAULT '12:00',
    break_end TIME DEFAULT '13:00',
    buffer_minutes INT NOT NULL DEFAULT 10 CHECK (buffer_minutes >= 0 AND buffer_minutes <= 60),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência de colunas em barber_schedules
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS start_time TIME NOT NULL DEFAULT '09:00';
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS end_time TIME NOT NULL DEFAULT '19:00';
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS is_working BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS has_lunch_break BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS lunch_start TIME DEFAULT '12:00';
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS lunch_end TIME DEFAULT '13:00';
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS break_start TIME DEFAULT '12:00';
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS break_end TIME DEFAULT '13:00';
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS buffer_minutes INT NOT NULL DEFAULT 10;
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE barber_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Garante que day_of_week aceite strings (domingo, segunda, etc.) mesmo que tenha sido criado como SMALLINT
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'barber_schedules' 
          AND column_name = 'day_of_week' 
          AND data_type IN ('smallint', 'integer', 'bigint')
    ) THEN
        ALTER TABLE barber_schedules 
        ALTER COLUMN day_of_week TYPE VARCHAR(20) 
        USING (
            CASE day_of_week::text
                WHEN '0' THEN 'domingo'
                WHEN '1' THEN 'segunda'
                WHEN '2' THEN 'terca'
                WHEN '3' THEN 'quarta'
                WHEN '4' THEN 'quinta'
                WHEN '5' THEN 'sexta'
                WHEN '6' THEN 'sabado'
                ELSE day_of_week::text
            END
        );
    END IF;
END $$;

-- CONSTRAINT DE UNICIDADE OBRIGATÓRIA PARA ON CONFLICT (barber_id, day_of_week)
ALTER TABLE barber_schedules DROP CONSTRAINT IF EXISTS uq_barber_schedules_day;
ALTER TABLE barber_schedules ADD CONSTRAINT uq_barber_schedules_day UNIQUE (barber_id, day_of_week);
CREATE UNIQUE INDEX IF NOT EXISTS idx_barber_schedules_unique ON barber_schedules(barber_id, day_of_week);

-- ------------------------------------------------------------------------------
-- 4. TABELA DE EXCEÇÕES E FOLGAS (barber_exceptions)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barber_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência de colunas em barber_exceptions
ALTER TABLE barber_exceptions ADD COLUMN IF NOT EXISTS exception_date DATE;
ALTER TABLE barber_exceptions ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE barber_exceptions ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE barber_exceptions ADD COLUMN IF NOT EXISTS reason VARCHAR(255);
ALTER TABLE barber_exceptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_barber_exceptions_date ON barber_exceptions(barber_id, exception_date);

-- Se barber_schedule_overrides existir, sincroniza registros existentes
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'barber_schedule_overrides' AND table_schema = 'public') THEN
        INSERT INTO barber_exceptions (id, barber_id, exception_date, start_time, end_time, reason, created_at)
        SELECT id, barber_id, override_date, start_time, end_time, reason, created_at
        FROM barber_schedule_overrides
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. SEED INICIAL DE EXPEDIENTE PARA MATHEUS E WILLIAM
-- Garante que ambos tenham os 7 dias cadastrados na grade (Segunda a Sábado ativos, Domingo folga)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_barber RECORD;
    v_day TEXT;
    v_days TEXT[] := ARRAY['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    v_is_working BOOLEAN;
BEGIN
    FOR v_barber IN SELECT id, name FROM barbers LOOP
        FOREACH v_day IN ARRAY v_days LOOP
            v_is_working := (v_day <> 'domingo');
            INSERT INTO barber_schedules (
                barber_id, day_of_week, start_time, end_time, 
                is_working, active, has_lunch_break, 
                lunch_start, lunch_end, break_start, break_end, buffer_minutes
            )
            VALUES (
                v_barber.id, v_day, '09:00', '19:00',
                v_is_working, v_is_working, TRUE,
                '12:00', '13:00', '12:00', '13:00', 10
            )
            ON CONFLICT (barber_id, day_of_week) DO UPDATE 
            SET has_lunch_break = COALESCE(barber_schedules.has_lunch_break, TRUE),
                lunch_start = COALESCE(barber_schedules.lunch_start, '12:00'),
                lunch_end = COALESCE(barber_schedules.lunch_end, '13:00'),
                break_start = COALESCE(barber_schedules.break_start, '12:00'),
                break_end = COALESCE(barber_schedules.break_end, '13:00');
        END LOOP;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 6. PERMISSÕES E POLÍTICAS RLS (SERVICE_ROLE, AUTHENTICATED E ANON)
-- Permite leitura e escrita direta sem bloqueios de sessão
-- ------------------------------------------------------------------------------
ALTER TABLE haircut_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "haircut_gallery_open_policy" ON haircut_gallery;
CREATE POLICY "haircut_gallery_open_policy" ON haircut_gallery FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "barber_schedules_open_policy" ON barber_schedules;
CREATE POLICY "barber_schedules_open_policy" ON barber_schedules FOR ALL USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "barber_exceptions_open_policy" ON barber_exceptions;
CREATE POLICY "barber_exceptions_open_policy" ON barber_exceptions FOR ALL USING (TRUE) WITH CHECK (TRUE);

GRANT ALL ON haircut_gallery TO authenticated, anon, service_role;
GRANT ALL ON barber_schedules TO authenticated, anon, service_role;
GRANT ALL ON barber_exceptions TO authenticated, anon, service_role;

COMMENT ON TABLE haircut_gallery IS 'Galeria de fotos e inspirações de cortes da JM Barberclub com URLs e caminhos de storage.';
COMMENT ON TABLE barber_schedules IS 'Expediente semanal com suporte a almoço, buffer e constraint única.';
COMMENT ON TABLE barber_exceptions IS 'Bloqueios e folgas pontuais de agenda dos barbeiros.';
