-- ==============================================================================
-- MIGRAÇÃO 101: AUTENTICAÇÃO, PERFIS DE BARBEIROS E AUDITORIA ADMINISTRATIVA
-- Sistema: JM Barberclub (Painel do Barbeiro)
-- Arquivo: supabase/migrations/101_barber_auth_and_profiles.sql
-- ==============================================================================

-- 1. Habilitar extensões necessárias para UUID e criptografia
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Garantir ou criar a tabela base de Barbeiros (barbers)
CREATE TABLE IF NOT EXISTS public.barbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'barber' CHECK (role IN ('admin', 'chefe', 'barber', 'staff')),
    active BOOLEAN NOT NULL DEFAULT true,
    avatar_url TEXT,
    bio TEXT,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    commission_percent NUMERIC(5,2) DEFAULT 50.00 CHECK (commission_percent >= 0 AND commission_percent <= 100),
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Adicionar colunas caso a tabela já exista de versões anteriores
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) DEFAULT 50.00;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

-- 4. Constraint de unicidade para o telefone do barbeiro (normalizado)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'barbers_phone_unique'
    ) THEN
        ALTER TABLE public.barbers ADD CONSTRAINT barbers_phone_unique UNIQUE (phone);
    END IF;
END $$;

-- 5. Índices de alta performance para busca e autenticação
CREATE INDEX IF NOT EXISTS idx_barbers_phone ON public.barbers(phone);
CREATE INDEX IF NOT EXISTS idx_barbers_auth_user_id ON public.barbers(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_barbers_active_display ON public.barbers(active, display_order, name);

-- 6. Tabela de Auditoria do Painel Administrativo (barber_audit_logs)
-- Registra modificações críticas feitas pelo Chefe ou Barbeiros (mudança de comissão, senhas, exclusões)
CREATE TABLE IF NOT EXISTS public.barber_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    target_barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- Ex: 'UPDATE_COMMISSION', 'RESET_PASSWORD', 'DEACTIVATE_BARBER', 'UPDATE_PERMISSIONS'
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.barber_audit_logs(actor_barber_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.barber_audit_logs(target_barber_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.barber_audit_logs(action, created_at DESC);

-- 7. Função e Gatilho para atualização automática de updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_barbers_updated_at ON public.barbers;
CREATE TRIGGER trg_barbers_updated_at
    BEFORE UPDATE ON public.barbers
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_timestamp();

COMMENT ON TABLE public.barbers IS 'Tabela de profissionais e barbeiros com controle de perfil, auth_user_id direto e comissões.';
COMMENT ON COLUMN public.barbers.auth_user_id IS 'ID exato no Supabase Auth para busca O(1) sem necessidade de listUsers.';
COMMENT ON COLUMN public.barbers.display_order IS 'Ordem de exibição dos barbeiros no painel e no chatbot/app do cliente.';
COMMENT ON TABLE public.barber_audit_logs IS 'Trilha de auditoria das ações administrativas realizadas no painel.';
