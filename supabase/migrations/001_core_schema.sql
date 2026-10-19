-- ==============================================================================
-- MIGRAÇÃO 001: ESTRUTURA BASE (CORE) · EQUIPE, SERVIÇOS E CLIENTES
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Barbearia)
-- Arquivo: supabase/migrations/001_core_schema.sql
-- ==============================================================================

-- 1. EXTENSÕES NECESSÁRIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. FUNÇÃO UTILITÁRIA PARA ATUALIZAÇÃO AUTOMÁTICA DE updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 3. TABELA DE PROFISSIONAIS E ACESSOS (barbers)
-- Suporta os 3 níveis de privilégio: 'admin' (Chefe), 'manager' (Gerente), 'barber' (Barbeiro)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE,
    phone VARCHAR(30),
    password_hash TEXT NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'barber' CHECK (role IN ('admin', 'manager', 'barber')),
    permissions JSONB NOT NULL DEFAULT '{
        "manage_services": false,
        "manage_schedule_others": false,
        "view_all_appointments": false,
        "manage_finance": false
    }'::jsonb,
    commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 50.00,
    commission_rate NUMERIC(5, 4) GENERATED ALWAYS AS (commission_percent / 100.0) STORED,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    avatar_url TEXT,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_barbers_role ON public.barbers(role);
CREATE INDEX IF NOT EXISTS idx_barbers_active ON public.barbers(active);
CREATE INDEX IF NOT EXISTS idx_barbers_email ON public.barbers(email);

DROP TRIGGER IF EXISTS trg_barbers_updated_at ON public.barbers;
CREATE TRIGGER trg_barbers_updated_at
    BEFORE UPDATE ON public.barbers
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.barbers IS 'Equipe da JM Barberclub com controle de acesso RBAC de 3 níveis e comissões.';

-- ------------------------------------------------------------------------------
-- 4. TABELA DE CATÁLOGO DE SERVIÇOS & PREÇOS (services)
-- Catálogo oficial de procedimentos, integrado com o Chatbot e Painel
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    price_in_cents INT NOT NULL DEFAULT 0,
    default_duration_minutes INT NOT NULL DEFAULT 30 CHECK (default_duration_minutes > 0),
    category VARCHAR(50) NOT NULL DEFAULT 'cabelo' CHECK (category IN ('cabelo', 'barba', 'combo', 'tratamento', 'outros')),
    image_url TEXT,
    storage_url TEXT,
    display_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_active_order ON public.services(active, display_order);
CREATE INDEX IF NOT EXISTS idx_services_category ON public.services(category);

DROP TRIGGER IF EXISTS trg_services_updated_at ON public.services;
CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON public.services
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.services IS 'Catálogo de serviços e valores oferecidos no painel e chatbot.';

-- ------------------------------------------------------------------------------
-- 5. TABELA DE BASE UNIFICADA DE CLIENTES (clients)
-- Consolidação única por telefone, cálculo de fidelidade e métricas de retenção
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) UNIQUE NOT NULL,
    clean_phone VARCHAR(30),
    email VARCHAR(150),
    notes TEXT,
    preferred_barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    total_visits INT NOT NULL DEFAULT 0,
    total_spent NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    last_visit_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'ativo', -- 'ativo', 'fiel', 'atrasado', 'novo'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_clean_phone ON public.clients(clean_phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_last_visit ON public.clients(last_visit_at DESC);

DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON public.clients
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.clients IS 'Base centralizada de clientes da JM Barberclub com histórico e métricas.';
