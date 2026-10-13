-- ==============================================================================
-- MIGRAÇÃO 101: LIMPEZA INICIAL, AUTENTICAÇÃO E BASE ADMINISTRATIVA DA EQUIPA
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/101_admin_base.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. LIMPEZA INICIAL OBRIGATÓRIA (DROP CASCADE EM ORDEM REVERSA DE DEPENDÊNCIA)
-- Elimina estruturas antigas das tabelas administrativas e de suporte para
-- recriação limpa e padronizada.
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS barber_recovery_codes CASCADE;
DROP TABLE IF EXISTS barber_recovery_state CASCADE;
DROP TABLE IF EXISTS push_subscriptions CASCADE;
DROP TABLE IF EXISTS waitlist CASCADE;
DROP TABLE IF EXISTS client_feedbacks CASCADE;
DROP TABLE IF EXISTS cash_flow CASCADE;
DROP TABLE IF EXISTS business_settings CASCADE;

-- Extensões necessárias no PostgreSQL
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Função utilitária para atualização automática de updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 2. TABELA DE BARBEIROS (barbers)
-- Armazena os perfis operacionais e o vínculo direto com o Supabase Auth.
-- Cenário de primeiro acesso: barbeiros sem senha prévia autenticam-se com 
-- credenciais baseadas no telefone e e-mail sintético determinístico
-- (ex: <telefone>@jmbarberclub.internal), preenchendo auth_user_id.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(20) NOT NULL DEFAULT 'barber' CHECK (role IN ('admin', 'barber')),
    commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 50.00 CHECK (commission_rate >= 0 AND commission_rate <= 100),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices otimizados para busca de barbeiros
CREATE INDEX IF NOT EXISTS idx_barbers_auth_user_id ON barbers(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_barbers_phone ON barbers(phone);
CREATE INDEX IF NOT EXISTS idx_barbers_active_role ON barbers(active, role);

-- Trigger para updated_at em barbers
DROP TRIGGER IF EXISTS trg_barbers_updated_at ON barbers;
CREATE TRIGGER trg_barbers_updated_at
    BEFORE UPDATE ON barbers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Comentários documentais
COMMENT ON TABLE barbers IS 'Perfis da equipa de barbeiros e administradores do JM Barberclub com vínculo ao Supabase Auth.';
COMMENT ON COLUMN barbers.auth_user_id IS 'ID do utilizador correspondente na tabela auth.users do Supabase.';
COMMENT ON COLUMN barbers.phone IS 'Telefone normalizado do barbeiro, chave única para recuperação e identificação.';
COMMENT ON COLUMN barbers.role IS 'Nível de privilégio: admin (acesso financeiro total e equipa) ou barber (agenda própria).';

-- ------------------------------------------------------------------------------
-- 3. CÓDIGOS DE RECUPERAÇÃO DE ACESSO (barber_recovery_codes)
-- Suporte ao fluxo de primeiro acesso sem senha e recuperação rápida via WhatsApp.
-- Os códigos são gerados pela gerência ou bot de suporte com prazo de validade rígido.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barber_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    salt TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para validação rápida de códigos
CREATE INDEX IF NOT EXISTS idx_recovery_codes_barber_expires ON barber_recovery_codes(barber_id, expires_at) WHERE used = FALSE;

COMMENT ON TABLE barber_recovery_codes IS 'Códigos temporários criptografados para redefinição ou criação de senha inicial do barbeiro.';

-- ------------------------------------------------------------------------------
-- 4. ESTADO DE CONTROLE E RATE LIMITING DE RECUPERAÇÃO (barber_recovery_state)
-- Blindagem contra ataques de força bruta no formulário de recuperação de senha.
-- Controla tentativas com bloqueio temporário e expiração.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS barber_recovery_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL UNIQUE REFERENCES barbers(id) ON DELETE CASCADE,
    attempts INT NOT NULL DEFAULT 0,
    blocked_until TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_state_barber ON barber_recovery_state(barber_id);

COMMENT ON TABLE barber_recovery_state IS 'Controle de tentativas e bloqueio temporário (Rate Limiting) de validação de senhas.';

-- ------------------------------------------------------------------------------
-- 5. NOTIFICAÇÕES WEB PUSH (push_subscriptions)
-- Inscrições dos dispositivos dos barbeiros para alertas instantâneos de
-- novos agendamentos e cancelamentos de horários em tempo real.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT,
    auth TEXT,
    subscription JSONB,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_sub_barber_id ON push_subscriptions(barber_id);

COMMENT ON TABLE push_subscriptions IS 'Endpoints de Web Push inscritos no navegador para entrega de alertas ao barbeiro.';
