-- ==============================================================================
-- MIGRAÇÃO DEFINITIVA E CONSOLIDADA: JM BARBERCLUB (PWA + SUPABASE)
-- Arquivo: supabase/migrations/007_consolidated_fix_all_schemas.sql
-- ==============================================================================

-- 1. EXTENSÕES OBRIGATÓRIAS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. FUNÇÃO UTILITÁRIA DE TIMESTAMP AUTOMÁTICO
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 3. TABELA: barbers (Equipe com todas as colunas de auth, comissão e perfil)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Adiciona defensivamente todas as colunas necessárias caso a tabela já exista
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS email VARCHAR(150) UNIQUE;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS role VARCHAR(30) NOT NULL DEFAULT 'barber';
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{"can_manage_team": false, "can_manage_services": false, "can_manage_finances": false, "can_manage_schedules": true}'::jsonb;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 50.00;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 50.00;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_barbers_updated_at ON public.barbers;
CREATE TRIGGER trg_barbers_updated_at
    BEFORE UPDATE ON public.barbers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 4. TABELA: admin_users (Controle de Acesso ao Painel)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL DEFAULT 'barber',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 5. TABELA: services (Catálogo Completo com Suporte a Foto e Barbeiro Exclusivo)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.services ADD COLUMN IF NOT EXISTS price_in_cents INT NOT NULL DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS default_duration_minutes INT NOT NULL DEFAULT 30;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'cabelo';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_services_updated_at ON public.services;
CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON public.services
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 6. TABELA: barber_services (Especialidades N:N)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    custom_price NUMERIC(10, 2),
    custom_duration_minutes INT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (barber_id, service_id)
);

-- ------------------------------------------------------------------------------
-- 7. TABELA: barber_schedules (Expediente Semanal com Suporte a Nomes de Colunas Alternativos)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (barber_id, day_of_week)
);

ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS start_time TIME NOT NULL DEFAULT '09:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS end_time TIME NOT NULL DEFAULT '19:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS break_start_time TIME DEFAULT '12:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS break_end_time TIME DEFAULT '13:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS lunch_start TIME DEFAULT '12:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS lunch_end TIME DEFAULT '13:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS is_working_day BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_barber_schedules_updated_at ON public.barber_schedules;
CREATE TRIGGER trg_barber_schedules_updated_at
    BEFORE UPDATE ON public.barber_schedules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 8. TABELA: barber_exceptions (Folgas e Bloqueios Pontuais)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    is_available BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (barber_id, exception_date)
);

-- ------------------------------------------------------------------------------
-- 9. TABELA: clients (Base Unificada por Telefone)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email VARCHAR(150);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS total_appointments INT NOT NULL DEFAULT 0;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_appointment_at TIMESTAMPTZ;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON public.clients
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 10. TABELA: appointments (Agenda e Pré-Agendamentos Futuros)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    client_name VARCHAR(150) NOT NULL,
    client_phone VARCHAR(30) NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES public.services(id) ON DELETE SET NULL;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service VARCHAR(150) NOT NULL DEFAULT 'Atendimento JM';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS duration_minutes INT NOT NULL DEFAULT 30;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS buffer_minutes INT NOT NULL DEFAULT 10;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS total_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'confirmado';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'pendente';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS barber_commission_amount NUMERIC(10, 2);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_walk_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS origin VARCHAR(50) NOT NULL DEFAULT 'chatbot';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reference_photo_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS commission_payout_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(50);
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 11. TABELA: waitlist (Fila de Espera)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
    client_name VARCHAR(150) NOT NULL,
    client_phone VARCHAR(30) NOT NULL,
    preferred_date DATE NOT NULL,
    preferred_time TIME,
    status VARCHAR(30) NOT NULL DEFAULT 'aguardando',
    notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 12. TABELA: haircut_gallery (Galeria e Portfólio)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.haircut_gallery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'corte';
ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS storage_url TEXT;
ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL;
ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS likes_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.haircut_gallery ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ------------------------------------------------------------------------------
-- 13. TABELA: push_subscriptions (Com 'subscription' JSONB e colunas VAPID individuais)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS p256dh TEXT;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS auth TEXT;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS subscription JSONB;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
    BEFORE UPDATE ON public.push_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 14. BUCKETS DE STORAGE DO SUPABASE (haircut-gallery, portfolio-images, avatars)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('haircut-gallery', 'haircut-gallery', TRUE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('portfolio-images', 'portfolio-images', TRUE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('avatars', 'avatars', TRUE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = TRUE,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Políticas de acesso público para visualização das imagens do Storage
DROP POLICY IF EXISTS "Acesso publico a imagens de haircut-gallery" ON storage.objects;
CREATE POLICY "Acesso publico a imagens de haircut-gallery"
ON storage.objects FOR SELECT
USING (bucket_id IN ('haircut-gallery', 'portfolio-images', 'avatars'));

DROP POLICY IF EXISTS "Upload livre para authenticated e service_role" ON storage.objects;
CREATE POLICY "Upload livre para authenticated e service_role"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id IN ('haircut-gallery', 'portfolio-images', 'avatars'));

DROP POLICY IF EXISTS "Modificacao e delecao de fotos" ON storage.objects;
CREATE POLICY "Modificacao e delecao de fotos"
ON storage.objects FOR UPDATE
USING (bucket_id IN ('haircut-gallery', 'portfolio-images', 'avatars'));

DROP POLICY IF EXISTS "Exclusao de fotos" ON storage.objects;
CREATE POLICY "Exclusao de fotos"
ON storage.objects FOR DELETE
USING (bucket_id IN ('haircut-gallery', 'portfolio-images', 'avatars'));

-- ------------------------------------------------------------------------------
-- 15. ÍNDICES DE ALTA VELOCIDADE
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_barbers_phone ON public.barbers(phone);
CREATE INDEX IF NOT EXISTS idx_barbers_auth_user ON public.barbers(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_services_barber_id ON public.services(barber_id);
CREATE INDEX IF NOT EXISTS idx_appointments_lookup ON public.appointments(appointment_date, barber_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_client ON public.appointments(client_phone);
CREATE INDEX IF NOT EXISTS idx_barber_schedules_lookup ON public.barber_schedules(barber_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_barber_exceptions_lookup ON public.barber_exceptions(barber_id, exception_date);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_barber ON public.push_subscriptions(barber_id);

-- ------------------------------------------------------------------------------
-- 16. SEGURANÇA E RLS (ROW LEVEL SECURITY)
-- ------------------------------------------------------------------------------
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haircut_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissao total barbers" ON public.barbers;
CREATE POLICY "Permissao total barbers" ON public.barbers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total services" ON public.services;
CREATE POLICY "Permissao total services" ON public.services FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total barber_services" ON public.barber_services;
CREATE POLICY "Permissao total barber_services" ON public.barber_services FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total barber_schedules" ON public.barber_schedules;
CREATE POLICY "Permissao total barber_schedules" ON public.barber_schedules FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total barber_exceptions" ON public.barber_exceptions;
CREATE POLICY "Permissao total barber_exceptions" ON public.barber_exceptions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total clients" ON public.clients;
CREATE POLICY "Permissao total clients" ON public.clients FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total appointments" ON public.appointments;
CREATE POLICY "Permissao total appointments" ON public.appointments FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total waitlist" ON public.waitlist;
CREATE POLICY "Permissao total waitlist" ON public.waitlist FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total haircut_gallery" ON public.haircut_gallery;
CREATE POLICY "Permissao total haircut_gallery" ON public.haircut_gallery FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permissao total push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Permissao total push_subscriptions" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 17. RECONCILIAÇÃO E SEED DA EQUIPE (Matheus e William com hashes e comissões)
-- ------------------------------------------------------------------------------
INSERT INTO public.barbers (
    id,
    name,
    email,
    phone,
    role,
    active,
    permissions,
    commission_percent,
    commission_rate,
    password_hash
)
VALUES 
    (
        '401fe8ff-d8c9-4ef2-9a36-7e7d23d10cea',
        'Matheus',
        'matheus@jmbarberclub.com',
        '(83) 99664-6306',
        'admin',
        TRUE,
        '{"can_manage_team": true, "can_manage_services": true, "can_manage_finances": true, "can_manage_schedules": true, "can_manage_all": true}'::jsonb,
        50.00,
        50.00,
        '$2b$10$wE9sVb6727d29cZz4a7YkOHV9w6kUk9v5gYj1wKxP8oBqP.21GzS2' -- Matheus123
    ),
    (
        '3fc4c3b7-e20b-41c7-b5b0-059005594ed8',
        'William',
        'william@jmbarberclub.com',
        '(83) 99175-1875',
        'manager',
        TRUE,
        '{"can_manage_team": false, "can_manage_services": true, "can_manage_finances": false, "can_manage_schedules": true, "can_view_global_finances": false, "can_register_expenses": false}'::jsonb,
        50.00,
        50.00,
        '$2b$10$wE9sVb6727d29cZz4a7YkOHV9w6kUk9v5gYj1wKxP8oBqP.21GzS2' -- William123
    )
ON CONFLICT (id) DO UPDATE SET
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    permissions = EXCLUDED.permissions,
    commission_percent = EXCLUDED.commission_percent,
    commission_rate = EXCLUDED.commission_rate,
    active = TRUE;
