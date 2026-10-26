-- ==============================================================================
-- MIGRAÇÃO 02: TABELAS PRINCIPAIS DO SISTEMA (ORDEM ESTRITA DE CHAVES ESTRANGEIRAS)
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/02_core_tables.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA DE BARBEIROS / EQUIPE (public.barbers)
-- Unifica as colunas do Chatbot e do Painel Administrativo (RBAC + Comissões)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barbers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    phone text,
    clean_phone text,
    email text,
    role text DEFAULT 'barber' NOT NULL,
    avatar_url text,
    is_active boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    password_hash text,
    auth_user_id uuid,
    commission_percent numeric(5,2) DEFAULT 50.00 NOT NULL,
    commission_rate numeric(5,2) DEFAULT 50.00 NOT NULL,
    permissions jsonb DEFAULT '{"manage_services": false, "manage_schedule_others": false, "view_all_appointments": false, "manage_finance": false}'::jsonb NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 2. TABELA DE CATÁLOGO DE SERVIÇOS (public.services)
-- Isolamento individual de imagem por ID e sincronia entre duration_minutes
-- (usado pelas RPCs SQL) e default_duration_minutes (usado pelo Painel Next.js)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text,
    price numeric(10,2) NOT NULL DEFAULT 0.00,
    price_in_cents integer DEFAULT 0,
    duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes >= 10),
    default_duration_minutes integer NOT NULL DEFAULT 30 CHECK (default_duration_minutes >= 10),
    category text DEFAULT 'cabelo',
    image_url text,
    image_path text,
    storage_url text,
    barber_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 3. TABELA DE VÍNCULO E ESPECIALIDADES BARBEIRO-SERVIÇO (public.barber_services)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    custom_duration_minutes integer CHECK (custom_duration_minutes >= 10),
    custom_price numeric(10,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE (barber_id, service_id)
);

-- ------------------------------------------------------------------------------
-- 4. ESCALA SEMANAL DE TRABALHO DOS BARBEIROS (public.barber_schedules)
-- Suporta tanto is_working (RPCs SQL) quanto is_working_day (Painel Next.js)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time time NOT NULL DEFAULT '09:00:00',
    end_time time NOT NULL DEFAULT '19:00:00',
    break_start_time time,
    break_end_time time,
    lunch_start time,
    lunch_end time,
    is_working boolean DEFAULT true NOT NULL,
    is_working_day boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE (barber_id, day_of_week)
);

-- ------------------------------------------------------------------------------
-- 5. TABELAS DE BLOQUEIOS, FOLGAS E EXCEÇÕES DE EXPEDIENTE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocked_dates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE,
    date date NOT NULL,
    reason text DEFAULT 'Bloqueio administrativo',
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.barber_leaves (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE,
    date date,
    start_date date,
    end_date date,
    reason text DEFAULT 'Folga / Férias',
    created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.barber_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE,
    exception_date date NOT NULL,
    start_time time,
    end_time time,
    is_available boolean DEFAULT false NOT NULL,
    reason text DEFAULT 'Exceção de expediente',
    created_at timestamptz DEFAULT now() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 6. TABELA DE CLIENTES (public.clients)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    phone text NOT NULL UNIQUE,
    email text,
    notes text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 7. TABELA DE GALERIA DE CORTES (public.haircut_gallery)
-- Referenciada opcionalmente por appointments (reference_photo_id)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.haircut_gallery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(150) NOT NULL DEFAULT 'Corte JM Barberclub',
    description text,
    category varchar(50) NOT NULL DEFAULT 'degrade',
    image_path text,
    image_url text,
    storage_url text,
    barber_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    display_order integer NOT NULL DEFAULT 0,
    likes_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 8. TABELA DE FECHAMENTO DE COMISSÕES (public.commission_payouts)
-- Referenciada opcionalmente por appointments (commission_payout_id)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commission_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_code varchar(50) UNIQUE NOT NULL,
    barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    admin_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    period_label varchar(100),
    total_revenue numeric(10,2) NOT NULL DEFAULT 0.00,
    commission_amount numeric(10,2) NOT NULL DEFAULT 0.00,
    commission_percent numeric(5,2) NOT NULL DEFAULT 50.00,
    appointments_count integer NOT NULL DEFAULT 0,
    payment_method varchar(30) NOT NULL DEFAULT 'pix',
    status varchar(20) NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'pending', 'cancelled')),
    notes text,
    appointment_ids jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    paid_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 9. TABELA PRINCIPAL DE AGENDAMENTOS (public.appointments)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE RESTRICT,
    service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
    client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
    reference_photo_id uuid REFERENCES public.haircut_gallery(id) ON DELETE SET NULL,
    commission_payout_id uuid REFERENCES public.commission_payouts(id) ON DELETE SET NULL,
    client_name text NOT NULL,
    client_phone text,
    service text,
    appointment_date date NOT NULL,
    appointment_time time NOT NULL,
    end_time time,
    duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes >= 10),
    buffer_minutes integer NOT NULL DEFAULT 10 CHECK (buffer_minutes >= 0),
    status text NOT NULL DEFAULT 'confirmado' CHECK (
        status IN (
            'pendente', 'confirmado', 'cancelado', 'concluido', 'concluído', 'bloqueado', 'pre_scheduled',
            'pending', 'confirmed', 'cancelled', 'completed', 'blocked'
        )
    ),
    payment_status text DEFAULT 'pendente',
    payment_method text,
    paid_at timestamptz,
    price numeric(10,2) DEFAULT 0.00,
    total_price numeric(10,2) DEFAULT 0.00,
    barber_commission_amount numeric(10,2),
    commission_paid boolean DEFAULT false,
    is_walk_in boolean DEFAULT false,
    is_pre_scheduled boolean DEFAULT false,
    pre_scheduled boolean DEFAULT false,
    origin text DEFAULT 'chatbot',
    source text DEFAULT 'chatbot',
    notes text,
    cancelled_at timestamptz,
    cancellation_reason text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Coluna gerada automaticamente para o horário final exato do agendamento
DO $$ BEGIN
    ALTER TABLE public.appointments
    ADD COLUMN appointment_end_time time
    GENERATED ALWAYS AS ((appointment_time + (duration_minutes || ' minutes')::interval)::time) STORED;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- ------------------------------------------------------------------------------
-- 10. LIVRO CAIXA E DESPESAS OPERACIONAIS (public.cash_flow)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_flow (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
    type varchar(20) NOT NULL CHECK (type IN ('income', 'expense', 'entrada', 'saida')),
    category varchar(60) NOT NULL DEFAULT 'outros',
    description text,
    amount numeric(10,2) NOT NULL CHECK (amount > 0),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    payment_method varchar(30) DEFAULT 'pix',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 11. GESTÃO DE SESSÕES E MENSAGENS DO CHATBOT (WhatsApp / Web)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token text UNIQUE NOT NULL,
    phone text NOT NULL,
    client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
    current_step text DEFAULT 'welcome' NOT NULL,
    state_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_active_at timestamptz DEFAULT now() NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    phone text NOT NULL,
    sender text NOT NULL CHECK (sender IN ('user', 'assistant', 'bot', 'system')),
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 12. ASSINATURAS PUSH E AUDITORIA DE SEGURANÇA DO PAINEL
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE,
    keys jsonb,
    p256dh text,
    auth text,
    subscription jsonb,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
    actor_name varchar(150),
    action varchar(80) NOT NULL,
    target_entity varchar(60),
    target_id varchar(100),
    details jsonb DEFAULT '{}'::jsonb,
    ip_address varchar(50),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 13. VIEWS ANALÍTICAS DO PAINEL ADMINISTRATIVO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_monthly_cash_flow AS
SELECT
    TO_CHAR(COALESCE(occurred_at, created_at), 'YYYY-MM') AS month_ref,
    COALESCE(SUM(CASE WHEN type IN ('income', 'entrada') THEN amount ELSE 0 END), 0)::numeric(10,2) AS total_income,
    COALESCE(SUM(CASE WHEN type IN ('expense', 'saida') THEN amount ELSE 0 END), 0)::numeric(10,2) AS total_expense,
    COALESCE(SUM(CASE WHEN type IN ('income', 'entrada') THEN amount ELSE -amount END), 0)::numeric(10,2) AS net_balance,
    COUNT(*)::int AS total_entries
FROM public.cash_flow
GROUP BY TO_CHAR(COALESCE(occurred_at, created_at), 'YYYY-MM');

CREATE OR REPLACE VIEW public.view_barber_performance AS
SELECT
    b.id AS barber_id,
    b.name AS barber_name,
    COUNT(a.id) FILTER (WHERE a.payment_status = 'pago' OR a.status IN ('concluido', 'concluído', 'completed'))::int AS total_concluidos,
    COALESCE(SUM(a.price) FILTER (WHERE a.payment_status = 'pago'), 0)::numeric(10,2) AS faturamento_bruto,
    COALESCE(SUM(COALESCE(a.barber_commission_amount, a.price * (COALESCE(b.commission_percent, 50) / 100.0))) FILTER (WHERE a.payment_status = 'pago'), 0)::numeric(10,2) AS total_comissao,
    COALESCE(AVG(a.price) FILTER (WHERE a.payment_status = 'pago'), 0)::numeric(10,2) AS ticket_medio
FROM public.barbers b
LEFT JOIN public.appointments a ON a.barber_id = b.id
GROUP BY b.id, b.name;
