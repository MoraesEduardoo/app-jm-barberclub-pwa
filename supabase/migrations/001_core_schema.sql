-- ==============================================================================
-- ARQUIVO 1: 001_core_schema.sql
-- Sistema: JM Barberclub (Chatbot + Painel do Barbeiro)
-- Descrição: Estrutura completa de tabelas essenciais, chaves primárias UUID,
--            relacionamentos com integridade referencial e auditoria histórica.
-- ==============================================================================

-- 1. Habilitar extensão para geração de UUID v4 criptográfico
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Função de disparo automática para atualização da coluna updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- TABELA 1: barbers (Equipe de Barbeiros: Matheus, William e Administradores)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE,
    phone VARCHAR(30) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'barber' CHECK (role IN ('admin', 'manager', 'barber')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    permissions JSONB NOT NULL DEFAULT '{"can_manage_team": false, "can_manage_services": false, "can_manage_finances": false, "can_manage_schedules": true}'::jsonb,
    commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 50.00 CHECK (commission_percent >= 0 AND commission_percent <= 100),
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_barbers_updated_at ON public.barbers;
CREATE TRIGGER trg_barbers_updated_at
    BEFORE UPDATE ON public.barbers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.barbers IS 'Cadastro dos barbeiros e administradores da barbearia.';

-- ------------------------------------------------------------------------------
-- TABELA 2: admin_users (Usuários com Acesso ao Painel Administrativo)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL DEFAULT 'barber' CHECK (role IN ('admin', 'manager', 'barber')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
    BEFORE UPDATE ON public.admin_users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.admin_users IS 'Credenciais de acesso e segurança para o painel administrativo.';

-- ------------------------------------------------------------------------------
-- TABELA 3: services (Catálogo de Procedimentos e Serviços)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    price_in_cents INT NOT NULL CHECK (price_in_cents >= 0),
    default_duration_minutes INT NOT NULL DEFAULT 30 CHECK (default_duration_minutes > 0),
    category VARCHAR(50) NOT NULL DEFAULT 'cabelo' CHECK (category IN ('cabelo', 'barba', 'combo', 'tratamento', 'outros')),
    image_url TEXT,
    storage_url TEXT,
    image_path TEXT,
    display_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL, -- Se NULL, realizado por toda a equipe
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_services_updated_at ON public.services;
CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON public.services
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.services IS 'Catálogo oficial de procedimentos, valores e fotos para o Chatbot e Painel.';

-- ------------------------------------------------------------------------------
-- TABELA 4: barber_services (Associação N:N entre Barbeiros e Serviços)
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

COMMENT ON TABLE public.barber_services IS 'Associação que define quais serviços cada profissional está habilitado a atender.';

-- ------------------------------------------------------------------------------
-- TABELA 5: barber_schedules (Jornada de Trabalho Semanal Padrão)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Domingo, 6=Sábado
    start_time TIME NOT NULL DEFAULT '09:00:00',
    end_time TIME NOT NULL DEFAULT '19:00:00',
    break_start_time TIME DEFAULT '12:00:00',
    break_end_time TIME DEFAULT '13:00:00',
    lunch_start TIME DEFAULT '12:00:00',
    lunch_end TIME DEFAULT '13:00:00',
    is_working_day BOOLEAN NOT NULL DEFAULT TRUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (barber_id, day_of_week)
);

DROP TRIGGER IF EXISTS trg_barber_schedules_updated_at ON public.barber_schedules;
CREATE TRIGGER trg_barber_schedules_updated_at
    BEFORE UPDATE ON public.barber_schedules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.barber_schedules IS 'Expediente e horários de trabalho padrão semanais por profissional.';

-- ------------------------------------------------------------------------------
-- TABELA 6: barber_exceptions (Exceções, Bloqueios Pontuais e Folgas)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    start_time TIME, -- Se NULL, bloqueia o dia inteiro
    end_time TIME,
    is_available BOOLEAN NOT NULL DEFAULT FALSE, -- FALSE = Bloqueado/Folga
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (barber_id, exception_date)
);

COMMENT ON TABLE public.barber_exceptions IS 'Bloqueios extraordinários, feriados e folgas por barbeiro.';

-- ------------------------------------------------------------------------------
-- TABELA 7: clients (Base Unificada de Clientes)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL UNIQUE,
    clean_phone VARCHAR(30),
    preferred_barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    email VARCHAR(150),
    total_appointments INT NOT NULL DEFAULT 0,
    last_appointment_at TIMESTAMPTZ,
    last_visit_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON public.clients
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.clients IS 'Base unificada de clientes identificados por telefone para fidelização.';

-- ------------------------------------------------------------------------------
-- TABELA 8: appointments (Núcleo Transacional de Agendamentos da Barbearia)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    service VARCHAR(150) NOT NULL, -- Snapshot textual do serviço no ato do agendamento
    client_name VARCHAR(150) NOT NULL,
    client_phone VARCHAR(30) NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    end_time TIME NOT NULL,
    appointment_end_time TIME,
    duration_minutes INT NOT NULL DEFAULT 30,
    buffer_minutes INT NOT NULL DEFAULT 10,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado', 'concluido', 'cancelado', 'pre_scheduled')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (payment_status IN ('pendente', 'pago', 'reembolsado')),
    payment_method VARCHAR(30) CHECK (payment_method IN ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'outro')),
    barber_commission_amount NUMERIC(10, 2),
    is_walk_in BOOLEAN NOT NULL DEFAULT FALSE,
    is_pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
    pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
    origin VARCHAR(50) NOT NULL DEFAULT 'chatbot' CHECK (origin IN ('chatbot', 'painel', 'pre_schedule', 'walk_in')),
    reference_photo_id UUID,
    commission_payout_id UUID,
    notes TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by VARCHAR(50),
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.appointments IS 'Tabela central de agendamentos, cortes em andamento e pré-agendamentos futuros.';

-- ------------------------------------------------------------------------------
-- TABELA 9: waitlist (Fila de Espera para Horários Desistidos)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
    client_name VARCHAR(150) NOT NULL,
    client_phone VARCHAR(30) NOT NULL,
    preferred_date DATE NOT NULL,
    preferred_time TIME,
    status VARCHAR(30) NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando', 'notificado', 'atendido', 'cancelado')),
    notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_waitlist_updated_at ON public.waitlist;
CREATE TRIGGER trg_waitlist_updated_at
    BEFORE UPDATE ON public.waitlist
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.waitlist IS 'Fila de espera para notificação imediata em caso de cancelamentos.';

-- ------------------------------------------------------------------------------
-- TABELA 10: haircut_gallery (Galeria de Cortes e Estilos do Catálogo)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.haircut_gallery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL DEFAULT 'corte',
    image_url TEXT,
    storage_url TEXT,
    image_path TEXT,
    barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    likes_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.haircut_gallery IS 'Portfólio visual exibido aos clientes no chatbot e no catálogo online.';

-- ------------------------------------------------------------------------------
-- TABELA 11: reminder_logs (Histórico de Lembretes Automáticos)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminder_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    client_phone VARCHAR(30) NOT NULL,
    channel VARCHAR(30) NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms')),
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'falha')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.reminder_logs IS 'Logs de disparos de lembretes pré-corte (ex: 2h antes).';

-- ------------------------------------------------------------------------------
-- TABELA 12: followup_logs (Mensagens Pós-Corte e Fidelização)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.followup_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    client_phone VARCHAR(30) NOT NULL,
    scheduled_for DATE NOT NULL,
    sent_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'cancelado')),
    rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
    feedback_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.followup_logs IS 'Mensagens de acompanhamento pós-atendimento para retenção e NPS.';

-- ------------------------------------------------------------------------------
-- TABELA 13: push_subscriptions (Assinaturas Web Push PWA para Barbeiros)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT,
    auth TEXT,
    keys JSONB,
    subscription JSONB,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
    BEFORE UPDATE ON public.push_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.push_subscriptions IS 'Tokens Web Push para envio de notificações instantâneas no celular do barbeiro.';
