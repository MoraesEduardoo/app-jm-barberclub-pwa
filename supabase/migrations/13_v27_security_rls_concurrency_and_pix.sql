-- ============================================================================
-- MIGRATION 13: Consolidação v2.7 — Auditoria Estrutural, Chave Pix, Acertos,
-- Blindagem de Concorrência (FOR UPDATE + Unique Index) e Isolamento RLS
-- Projeto: JM Barberclub (Painel do Barbeiro & Chatbot WhatsApp)
-- ============================================================================
-- Totalmente idempotente e defensiva (garante tabelas e colunas antes de
-- aplicar índices, triggers, funções RPC e políticas RLS).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. GARANTIA DEFENSIVA DE TABELAS E COLUNAS BASE (PREVENÇÃO DE ERRO 42P01/42703)
-- ============================================================================

-- 0.1. Garante colunas essenciais em `public.barbers`
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS clean_phone varchar(20),
  ADD COLUMN IF NOT EXISTS role varchar(30) DEFAULT 'barber',
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS commission_percent numeric(5,2) DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS product_commission_percent numeric(5,2) DEFAULT 10.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_key_type varchar(30) DEFAULT 'cpf_cnpj',
  ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 0.2. Garante colunas essenciais em `public.services`
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS price numeric(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS duration_minutes integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS default_duration_minutes integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;

-- 0.3. Garante existência da tabela `public.products`
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

-- 0.4. Garante existência da tabela `public.barber_services`
CREATE TABLE IF NOT EXISTS public.barber_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  custom_duration integer,
  custom_duration_minutes integer,
  custom_price numeric(10,2),
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT barber_services_barber_service_unique UNIQUE (barber_id, service_id)
);

ALTER TABLE public.barber_services
  ADD COLUMN IF NOT EXISTS custom_duration integer,
  ADD COLUMN IF NOT EXISTS custom_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS custom_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- 0.5. Garante existência das tabelas de expediente, folgas, bloqueios e clientes
CREATE TABLE IF NOT EXISTS public.barber_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL,
  start_time time NOT NULL DEFAULT '09:00:00',
  end_time time NOT NULL DEFAULT '19:00:00',
  break_start_time time,
  break_end_time time,
  lunch_start time,
  lunch_end time,
  is_working boolean DEFAULT true,
  is_working_day boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.barber_schedules
  ADD COLUMN IF NOT EXISTS break_start_time time,
  ADD COLUMN IF NOT EXISTS break_end_time time,
  ADD COLUMN IF NOT EXISTS lunch_start time,
  ADD COLUMN IF NOT EXISTS lunch_end time,
  ADD COLUMN IF NOT EXISTS is_working boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_working_day boolean DEFAULT true;

CREATE TABLE IF NOT EXISTS public.barber_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  is_available boolean DEFAULT false NOT NULL,
  start_time time,
  end_time time,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.barber_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE,
  date date,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.barber_leaves
  ADD COLUMN IF NOT EXISTS date date,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;

CREATE TABLE IF NOT EXISTS public.blocked_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE,
  date date NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE,
  clean_phone varchar(20),
  total_visits integer DEFAULT 1,
  last_visit_at timestamptz DEFAULT now(),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS clean_phone varchar(20),
  ADD COLUMN IF NOT EXISTS total_visits integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_visit_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

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

-- 0.6. Garante existência da tabela `public.commission_payouts` (Acertos Financeiros)
CREATE TABLE IF NOT EXISTS public.commission_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_code varchar(50) UNIQUE NOT NULL,
  barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  period_label varchar(100),
  total_revenue numeric(10,2) NOT NULL DEFAULT 0.00,
  service_revenue numeric(10,2) NOT NULL DEFAULT 0.00,
  product_revenue numeric(10,2) NOT NULL DEFAULT 0.00,
  commission_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  service_commission_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  product_commission_amount numeric(10,2) NOT NULL DEFAULT 0.00,
  commission_percent numeric(5,2) NOT NULL DEFAULT 50.00,
  product_commission_percent numeric(5,2) NOT NULL DEFAULT 10.00,
  pix_key_snapshot text,
  appointments_count integer NOT NULL DEFAULT 0,
  payment_method varchar(30) NOT NULL DEFAULT 'pix',
  status varchar(20) NOT NULL DEFAULT 'paid',
  notes text,
  appointment_ids jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 0.7. Garante existência da tabela `public.cash_flow` (Livro Caixa)
CREATE TABLE IF NOT EXISTS public.cash_flow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid,
  barber_id uuid REFERENCES public.barbers(id) ON DELETE SET NULL,
  type varchar(20) NOT NULL DEFAULT 'income',
  category varchar(60) NOT NULL DEFAULT 'outros',
  description text,
  amount numeric(10,2) NOT NULL DEFAULT 0.00,
  transaction_date date DEFAULT CURRENT_DATE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payment_method varchar(30) DEFAULT 'pix',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.cash_flow
  ADD COLUMN IF NOT EXISTS appointment_id uuid,
  ADD COLUMN IF NOT EXISTS transaction_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz DEFAULT now();


-- ============================================================================
-- 1. EVOLUÇÃO DE SCHEMA: CHAVE PIX E COMISSÃO DE PRODUTOS EM `public.barbers`
--    E DETALHAMENTO AUDITÁVEL EM `public.commission_payouts`
-- ============================================================================

-- Sincroniza os valores de comissão existentes (Matheus/Admin = 100% integral;
-- demais colaboradores = 50% serviços e 10% produtos, ou valor salvo em permissions)
UPDATE public.barbers
SET
  commission_percent = CASE
    WHEN LOWER(TRIM(name)) = 'matheus' OR role = 'admin' THEN 100.00
    ELSE COALESCE(
      NULLIF((permissions->>'service_commission_percent')::numeric, 0),
      commission_percent,
      50.00
    )
  END,
  commission_rate = CASE
    WHEN LOWER(TRIM(name)) = 'matheus' OR role = 'admin' THEN 100.00
    ELSE COALESCE(
      NULLIF((permissions->>'service_commission_percent')::numeric, 0),
      commission_rate,
      commission_percent,
      50.00
    )
  END,
  product_commission_percent = CASE
    WHEN LOWER(TRIM(name)) = 'matheus' OR role = 'admin' THEN 100.00
    ELSE COALESCE(
      (permissions->>'product_commission_percent')::numeric,
      product_commission_percent,
      10.00
    )
  END,
  pix_key = COALESCE(pix_key, NULLIF(TRIM(permissions->>'pix_key'), ''), phone)
WHERE true;

-- Trigger para manter commission_percent, commission_rate, product_commission_percent
-- e permissions JSONB sempre sincronizados em `public.barbers`
CREATE OR REPLACE FUNCTION public.fn_sync_barber_commission_and_pix()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.permissions IS NULL THEN
    NEW.permissions := '{}'::jsonb;
  END IF;

  -- Regra do Proprietário (Matheus): 100% integral em serviços e produtos
  IF LOWER(TRIM(COALESCE(NEW.name, ''))) = 'matheus' THEN
    NEW.commission_percent := 100.00;
    NEW.commission_rate := 100.00;
    NEW.product_commission_percent := 100.00;
  ELSE
    NEW.commission_percent := COALESCE(NEW.commission_percent, NEW.commission_rate, 50.00);
    NEW.commission_rate := NEW.commission_percent;
    NEW.product_commission_percent := COALESCE(
      NEW.product_commission_percent,
      (NEW.permissions->>'product_commission_percent')::numeric,
      10.00
    );
  END IF;

  -- Sincroniza dentro do JSONB permissions para retrocompatibilidade total com a UI
  NEW.permissions := jsonb_set(
    jsonb_set(
      NEW.permissions,
      '{service_commission_percent}',
      to_jsonb(NEW.commission_percent),
      true
    ),
    '{product_commission_percent}',
    to_jsonb(NEW.product_commission_percent),
    true
  );

  IF NEW.pix_key IS NOT NULL AND TRIM(NEW.pix_key) <> '' THEN
    NEW.permissions := jsonb_set(NEW.permissions, '{pix_key}', to_jsonb(TRIM(NEW.pix_key)), true);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_barber_commission_and_pix ON public.barbers;
CREATE TRIGGER trg_sync_barber_commission_and_pix
BEFORE INSERT OR UPDATE ON public.barbers
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_barber_commission_and_pix();

-- 1.2. Evolução da tabela de Acertos Financeiros (`public.commission_payouts`)
ALTER TABLE public.commission_payouts
  ADD COLUMN IF NOT EXISTS service_revenue numeric(10,2) DEFAULT 0.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS product_revenue numeric(10,2) DEFAULT 0.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS service_commission_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS product_commission_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS product_commission_percent numeric(5,2) DEFAULT 10.00 NOT NULL,
  ADD COLUMN IF NOT EXISTS pix_key_snapshot text;

-- Garante que `appointments` possui todas as colunas operacionais e vínculo com `commission_payouts`
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS clean_phone varchar(20),
  ADD COLUMN IF NOT EXISTS service text,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS duration_minutes integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS buffer_minutes integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS price numeric(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_price numeric(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS is_walk_in boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'chatbot',
  ADD COLUMN IF NOT EXISTS origin text DEFAULT 'chatbot',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS commission_payout_id uuid REFERENCES public.commission_payouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS barber_commission_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS commission_paid boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Índices otimizados para Acertos Financeiros por Barbeiro (`barber_id`)
CREATE INDEX IF NOT EXISTS idx_commission_payouts_barber_paid_at
  ON public.commission_payouts (barber_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_commission_payouts_barber_period
  ON public.commission_payouts (barber_id, period_start, period_end)
  WHERE status = 'paid';

CREATE INDEX IF NOT EXISTS idx_appointments_commission_payout_id
  ON public.appointments (commission_payout_id)
  WHERE commission_payout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_barber_unsettled
  ON public.appointments (barber_id, appointment_date)
  WHERE commission_payout_id IS NULL
    AND COALESCE(status, 'agendado') NOT IN ('cancelado', 'cancelled');


-- ============================================================================
-- 2. BLINDAGEM CONTRA CONCORRÊNCIA E DUPLO AGENDAMENTO (TRANSAÇÕES ATÔMICAS)
-- ============================================================================

-- 2.1. Saneamento defensivo: se houver agendamentos ativos duplicados exatamente
-- no mesmo (barber_id, appointment_date, appointment_time), preserva o mais antigo
-- (ou já pago/concluído) e cancela a duplicata acidental antes de criar o Unique Index.
WITH ranked_slots AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY barber_id, appointment_date, appointment_time
      ORDER BY
        CASE WHEN payment_status = 'pago' OR status = 'concluido' THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
    ) AS rn
  FROM public.appointments
  WHERE barber_id IS NOT NULL
    AND appointment_date IS NOT NULL
    AND appointment_time IS NOT NULL
    AND COALESCE(status, 'agendado') NOT IN ('cancelado', 'cancelled')
)
UPDATE public.appointments a
SET
  status = 'cancelado',
  notes = COALESCE(a.notes || ' | ', '') || '[Auto-saneamento v2.7: slot duplicado]'
FROM ranked_slots r
WHERE a.id = r.id
  AND r.rn > 1;

-- 2.2. Índice Único Parcial Físico no Motor do PostgreSQL:
-- Impede fisicamente que duas transações gravem o mesmo (barber_id, appointment_date, appointment_time)
-- enquanto o agendamento estiver ativo (não cancelado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_active_slot
  ON public.appointments (barber_id, appointment_date, appointment_time)
  WHERE COALESCE(status, 'agendado') NOT IN ('cancelado', 'cancelled');

-- 2.3. Trigger Transacional com `SELECT ... FOR UPDATE` + `pg_advisory_xact_lock`
-- Protege TODAS as vias de escrita (RPC do Chatbot, Server Actions e encaixes manuais)
-- contra sobreposição de horários (overlap de duração) e condição de corrida (race condition).
CREATE OR REPLACE FUNCTION public.fn_prevent_appointment_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_barber_lock uuid;
  v_new_duration integer;
  v_new_start time;
  v_new_end time;
  v_conflict_id uuid;
  v_conflict_client text;
  v_conflict_time time;
BEGIN
  -- Ignora agendamentos cancelados ou registros sem barbeiro/data/hora
  IF NEW.barber_id IS NULL OR NEW.appointment_date IS NULL OR NEW.appointment_time IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status, 'agendado') IN ('cancelado', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Se for um UPDATE que não alterou barbeiro, data, hora nem reativou status cancelado,
  -- não precisa revalidar colisão de slot (ex: apenas dando baixa de pagamento ou nota)
  IF TG_OP = 'UPDATE'
     AND OLD.barber_id IS NOT DISTINCT FROM NEW.barber_id
     AND OLD.appointment_date IS NOT DISTINCT FROM NEW.appointment_date
     AND OLD.appointment_time IS NOT DISTINCT FROM NEW.appointment_time
     AND COALESCE(OLD.status, 'agendado') NOT IN ('cancelado', 'cancelled')
  THEN
    RETURN NEW;
  END IF;

  -- 1) Lock Transacional Advisory por (barber_id + appointment_date)
  PERFORM pg_advisory_xact_lock(hashtext(NEW.barber_id::text || ':' || NEW.appointment_date::text));

  -- 2) Lock Pessimista de Linha (`SELECT ... FOR UPDATE`) no registro do Barbeiro
  -- Garante serialização estrita entre duas transações simultâneas para o mesmo profissional
  SELECT b.id
  INTO v_barber_lock
  FROM public.barbers b
  WHERE b.id = NEW.barber_id
  FOR UPDATE;

  -- 3) Calcula duração efetiva do novo agendamento (respeitando custom_duration de barber_services)
  SELECT COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.default_duration_minutes, s.duration_minutes, NEW.duration_minutes, 30)
  INTO v_new_duration
  FROM public.services s
  LEFT JOIN public.barber_services bs
    ON bs.service_id = s.id AND bs.barber_id = NEW.barber_id
  WHERE s.id = NEW.service_id;

  v_new_duration := GREATEST(COALESCE(v_new_duration, NEW.duration_minutes, 30), 5);
  v_new_start := NEW.appointment_time;
  v_new_end := (NEW.appointment_time + (v_new_duration || ' minutes')::interval)::time;

  -- 4) Lock Pessimista (`FOR UPDATE`) nos agendamentos ativos do barbeiro na mesma data
  -- e verificação de colisão de horário exato (ou sobreposição para agendamentos regulares)
  SELECT a.id, a.client_name, a.appointment_time
  INTO v_conflict_id, v_conflict_client, v_conflict_time
  FROM public.appointments a
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.barber_services bs ON bs.service_id = a.service_id AND bs.barber_id = a.barber_id
  WHERE a.barber_id = NEW.barber_id
    AND a.appointment_date = NEW.appointment_date
    AND a.id IS DISTINCT FROM NEW.id
    AND COALESCE(a.status, 'agendado') NOT IN ('cancelado', 'cancelled')
    AND (
      -- Mesmo horário exato é sempre bloqueado (mesmo em encaixes)
      a.appointment_time = v_new_start
      OR (
        -- Se não for encaixe explícito (is_walk_in = false), bloqueia qualquer sobreposição de janela
        COALESCE(NEW.is_walk_in, false) = false
        AND COALESCE(a.is_walk_in, false) = false
        AND v_new_start < (a.appointment_time + (COALESCE(a.duration_minutes, bs.custom_duration, bs.custom_duration_minutes, s.default_duration_minutes, s.duration_minutes, 30) || ' minutes')::interval)::time
        AND v_new_end > a.appointment_time
      )
    )
  LIMIT 1
  FOR UPDATE OF a;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'CONFLITO_HORARIO: O horário % já está ocupado para este barbeiro (Agendamento ID: %).',
      to_char(v_conflict_time, 'HH24:MI'), v_conflict_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_appointment_overlap ON public.appointments;
CREATE TRIGGER trg_prevent_appointment_overlap
BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.fn_prevent_appointment_overlap();


-- 2.4. Atualização da RPC Atômica Canônica `public.chatbot_create_appointment`
-- Unifica a assinatura (sem ambiguidade PGRST203), utiliza `pg_advisory_xact_lock` +
-- `SELECT ... FOR UPDATE` explícito e retorna `SLOT_ALREADY_BOOKED` em caso de colisão
DROP FUNCTION IF EXISTS public.chatbot_create_appointment(text, text, uuid, uuid, date, time without time zone);
DROP FUNCTION IF EXISTS public.chatbot_create_appointment(text, text, uuid, uuid, uuid[], date, time without time zone, integer, integer, text);

CREATE OR REPLACE FUNCTION public.chatbot_create_appointment(
  p_client_name text,
  p_client_phone text,
  p_barber_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_service_ids uuid[] DEFAULT NULL,
  p_date date DEFAULT NULL,
  p_time time without time zone DEFAULT NULL,
  p_duration_minutes integer DEFAULT 30,
  p_buffer_minutes integer DEFAULT 10,
  p_notes text DEFAULT 'Agendamento via Chatbot'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_barber_id uuid;
  v_barber_name text;
  v_clean_phone text;
  v_client_id uuid;
  v_target_service_ids uuid[] := '{}';
  v_created_ids uuid[] := '{}';
  v_new_id uuid;
  v_total_duration integer := 0;
  v_total_price numeric(10,2) := 0.00;
  v_current_start time;
  v_item_end time;
  v_estimated_end time;
  v_conflict_id uuid;
  v_conflict_time time;
  v_is_blocked boolean := false;
  v_rec record;
BEGIN
  IF p_barber_id IS NULL OR p_date IS NULL OR p_time IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MISSING_PARAMETERS',
      'error', 'Profissional, data e horário são obrigatórios.',
      'message', 'Profissional, data e horário são obrigatórios.'
    );
  END IF;

  v_clean_phone := regexp_replace(COALESCE(p_client_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) < 8 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_PHONE',
      'error', 'Número de telefone inválido.',
      'message', 'Número de telefone inválido.'
    );
  END IF;

  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    v_target_service_ids := p_service_ids;
  ELSIF p_service_id IS NOT NULL THEN
    v_target_service_ids := ARRAY[p_service_id];
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MISSING_SERVICE',
      'error', 'Nenhum serviço foi informado para o agendamento.',
      'message', 'Nenhum serviço foi informado para o agendamento.'
    );
  END IF;

  -- 1. Lock transacional advisory + Lock de linha (`SELECT ... FOR UPDATE`) no barbeiro
  PERFORM pg_advisory_xact_lock(hashtext(p_barber_id::text || ':' || p_date::text));

  SELECT b.id, b.name
  INTO v_barber_id, v_barber_name
  FROM public.barbers b
  WHERE b.id = p_barber_id
    AND COALESCE(b.active, true) = true
    AND COALESCE(b.is_active, true) = true
  FOR UPDATE;

  IF v_barber_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BARBER_INACTIVE',
      'error', 'Este profissional não está disponível para agendamentos no momento.',
      'message', 'Este profissional não está disponível para agendamentos no momento.'
    );
  END IF;

  -- 2. Verifica se o barbeiro está em férias/ausência ou data bloqueada
  SELECT EXISTS (
    SELECT 1 FROM public.blocked_dates bd
    WHERE bd.date = p_date
      AND (bd.barber_id = p_barber_id OR bd.barber_id IS NULL)
    UNION ALL
    SELECT 1 FROM public.barber_leaves bl
    WHERE (bl.barber_id = p_barber_id OR bl.barber_id IS NULL)
      AND (bl.date = p_date OR (bl.start_date <= p_date AND bl.end_date >= p_date))
    UNION ALL
    SELECT 1 FROM public.barber_exceptions be
    WHERE be.barber_id = p_barber_id
      AND be.exception_date = p_date
      AND be.is_available = false
      AND be.start_time IS NULL
      AND be.end_time IS NULL
  ) INTO v_is_blocked;

  IF v_is_blocked THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BARBER_ON_LEAVE',
      'error', 'O profissional selecionado não estará atendendo nesta data.',
      'message', 'O profissional selecionado não estará atendendo nesta data.'
    );
  END IF;

  -- 3. Calcula duração efetiva e preço (considerando `barber_services`)
  SELECT
    COALESCE(SUM(COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30)), 0)::integer,
    COALESCE(SUM(COALESCE(bs.custom_price, CASE WHEN s.price >= 1000 THEN s.price / 100.0 ELSE s.price END, 0.00)), 0.00)::numeric(10,2)
  INTO
    v_total_duration,
    v_total_price
  FROM unnest(v_target_service_ids) WITH ORDINALITY AS u(service_id, ord)
  LEFT JOIN public.services s ON s.id = u.service_id
  LEFT JOIN public.barber_services bs ON bs.service_id = s.id AND bs.barber_id = p_barber_id;

  IF v_total_duration <= 0 THEN
    v_total_duration := GREATEST(COALESCE(p_duration_minutes, 30), 5);
  END IF;

  v_estimated_end := (p_time + make_interval(mins => v_total_duration))::time;

  -- 4. Lock pessimista (`FOR UPDATE OF a`) nos agendamentos ativos do dia para validar colisão
  SELECT a.id, a.appointment_time
  INTO v_conflict_id, v_conflict_time
  FROM public.appointments a
  WHERE a.barber_id = p_barber_id
    AND a.appointment_date = p_date
    AND COALESCE(a.status, 'agendado') NOT IN ('cancelado', 'cancelled')
    AND (
      a.appointment_time = p_time
      OR (
        p_time < GREATEST(
          COALESCE(a.end_time, (a.appointment_time + make_interval(mins => COALESCE(a.duration_minutes, 30)))::time),
          (a.appointment_time + make_interval(
            mins => COALESCE(a.duration_minutes, 30) + COALESCE(a.buffer_minutes, 0)
          ))::time
        )
        AND v_estimated_end > a.appointment_time
      )
    )
  LIMIT 1
  FOR UPDATE OF a;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SLOT_ALREADY_BOOKED',
      'error', 'Este horário acabou de ser preenchido por outro cliente. Por favor, escolha outro horário.',
      'message', 'Este horário acabou de ser preenchido por outro cliente. Por favor, escolha outro horário.'
    );
  END IF;

  -- 5. Atualiza ou insere o cliente no CRM (`clients`) de forma best-effort
  BEGIN
    INSERT INTO public.clients (name, phone, clean_phone, total_visits, last_visit_at, updated_at)
    VALUES (TRIM(COALESCE(NULLIF(p_client_name, ''), 'Cliente')), v_clean_phone, v_clean_phone, 1, now(), now())
    ON CONFLICT (phone) DO UPDATE
    SET
      name = COALESCE(NULLIF(TRIM(EXCLUDED.name), ''), public.clients.name),
      clean_phone = COALESCE(EXCLUDED.clean_phone, public.clients.clean_phone),
      total_visits = COALESCE(public.clients.total_visits, 0) + 1,
      last_visit_at = now(),
      updated_at = now()
    RETURNING id INTO v_client_id;
  EXCEPTION WHEN OTHERS THEN
    SELECT c.id INTO v_client_id
    FROM public.clients c
    WHERE c.phone = v_clean_phone OR c.clean_phone = v_clean_phone
    LIMIT 1;
  END;

  -- 6. Inserção atômica protegida pelo índice único `idx_appointments_unique_active_slot`
  v_current_start := p_time;

  FOR v_rec IN
    SELECT
      u.service_id,
      COALESCE(s.name, 'Serviço') AS item_name,
      GREATEST(
        COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, p_duration_minutes, 30)::integer,
        5
      ) AS item_duration,
      COALESCE(
        bs.custom_price,
        CASE WHEN s.price >= 1000 THEN s.price / 100.0 ELSE s.price END,
        0.00
      )::numeric(10,2) AS item_price
    FROM unnest(v_target_service_ids) WITH ORDINALITY AS u(service_id, ord)
    LEFT JOIN public.services s ON s.id = u.service_id
    LEFT JOIN public.barber_services bs ON bs.service_id = s.id AND bs.barber_id = p_barber_id
    ORDER BY u.ord ASC
  LOOP
    v_item_end := (v_current_start + make_interval(mins => v_rec.item_duration))::time;

    INSERT INTO public.appointments (
      barber_id,
      service_id,
      client_id,
      client_name,
      client_phone,
      clean_phone,
      service,
      appointment_date,
      appointment_time,
      end_time,
      duration_minutes,
      buffer_minutes,
      status,
      payment_status,
      price,
      total_price,
      notes,
      source,
      origin,
      created_at,
      updated_at
    ) VALUES (
      p_barber_id,
      v_rec.service_id,
      v_client_id,
      TRIM(COALESCE(NULLIF(p_client_name, ''), 'Cliente')),
      v_clean_phone,
      v_clean_phone,
      v_rec.item_name,
      p_date,
      v_current_start,
      v_item_end,
      v_rec.item_duration,
      COALESCE(p_buffer_minutes, 10),
      'confirmado',
      'pendente',
      v_rec.item_price,
      v_rec.item_price,
      COALESCE(p_notes, 'Agendamento via WhatsApp Chatbot'),
      'chatbot',
      'chatbot',
      now(),
      now()
    )
    RETURNING id INTO v_new_id;

    v_created_ids := array_append(v_created_ids, v_new_id);
    v_current_start := v_item_end;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'APPOINTMENT_CREATED',
    'appointment_id', v_created_ids[1],
    'appointment_ids', v_created_ids,
    'barber_id', p_barber_id,
    'barber_name', v_barber_name,
    'client_id', v_client_id,
    'date', p_date,
    'appointment_date', p_date,
    'start_time', to_char(p_time, 'HH24:MI'),
    'appointment_time', to_char(p_time, 'HH24:MI'),
    'end_time', to_char(v_estimated_end, 'HH24:MI'),
    'duration_minutes', v_total_duration,
    'total_duration', v_total_duration,
    'price', v_total_price,
    'total_price', v_total_price,
    'message', 'Agendamento confirmado com sucesso!'
  );

EXCEPTION
  WHEN unique_violation OR exclusion_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SLOT_ALREADY_BOOKED',
      'sqlstate', SQLSTATE,
      'error', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Escolha outro horário disponível.',
      'message', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Escolha outro horário disponível.'
    );
  WHEN OTHERS THEN
    IF SQLSTATE = '23505' OR SQLERRM ILIKE '%CONFLITO_HORARIO%' OR SQLERRM ILIKE '%idx_appointments_unique_active_slot%' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SLOT_ALREADY_BOOKED',
        'sqlstate', '23505',
        'error', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Escolha outro horário disponível.',
        'message', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Escolha outro horário disponível.'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'INTERNAL_ERROR',
      'sqlstate', SQLSTATE,
      'error', SQLERRM,
      'message', SQLERRM
    );
END;
$$;


-- 2.5. Atualização de `public.register_payment_atomic` para respeitar a regra v2.7:
-- Proprietário (Matheus) = 100% integral; Colaboradores = 50% serviços + 10% produtos
CREATE OR REPLACE FUNCTION public.register_payment_atomic(
  p_appointment_id uuid,
  p_barber_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_description text DEFAULT 'Serviço de Barbearia'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_barber_name text;
  v_barber_role text;
  v_service_comm_pct numeric(5,2);
  v_product_comm_pct numeric(5,2);
  v_service_price numeric(10,2);
  v_total_amount numeric(10,2);
  v_products_amount numeric(10,2);
  v_commission numeric(10,2);
  v_cash_flow_id uuid;
BEGIN
  -- Lock pessimista na linha do agendamento para evitar duplo recebimento simultâneo
  SELECT COALESCE(a.price, 0)
  INTO v_service_price
  FROM public.appointments a
  WHERE a.id = p_appointment_id
  FOR UPDATE;

  SELECT
    b.name,
    b.role,
    COALESCE(b.commission_percent, b.commission_rate, 50.00),
    COALESCE(b.product_commission_percent, (b.permissions->>'product_commission_percent')::numeric, 10.00)
  INTO v_barber_name, v_barber_role, v_service_comm_pct, v_product_comm_pct
  FROM public.barbers b
  WHERE b.id = p_barber_id;

  v_total_amount := GREATEST(COALESCE(p_amount, v_service_price, 0), 0);

  IF v_service_price <= 0 OR v_service_price > v_total_amount THEN
    v_service_price := v_total_amount;
  END IF;

  v_products_amount := GREATEST(v_total_amount - v_service_price, 0);

  -- Regra de Negócio v2.7:
  -- Matheus (Proprietário) recebe 100% integral.
  -- Colaboradores recebem v_service_comm_pct% (50%) sobre serviço + v_product_comm_pct% (10%) sobre produtos.
  IF LOWER(TRIM(COALESCE(v_barber_name, ''))) = 'matheus' THEN
    v_commission := ROUND(v_total_amount, 2);
  ELSE
    v_commission := ROUND(
      (v_service_price * (COALESCE(v_service_comm_pct, 50.00) / 100.0)) +
      (v_products_amount * (COALESCE(v_product_comm_pct, 10.00) / 100.0)),
      2
    );
  END IF;

  UPDATE public.appointments
  SET
    status = 'concluido',
    payment_status = 'pago',
    payment_method = p_payment_method,
    total_price = v_total_amount,
    barber_commission_amount = v_commission,
    updated_at = now()
  WHERE id = p_appointment_id;

  INSERT INTO public.cash_flow (
    appointment_id,
    barber_id,
    type,
    category,
    amount,
    payment_method,
    description,
    transaction_date,
    occurred_at
  ) VALUES (
    p_appointment_id,
    p_barber_id,
    'income',
    'service',
    v_total_amount,
    p_payment_method,
    p_description,
    CURRENT_DATE,
    now()
  )
  RETURNING id INTO v_cash_flow_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'appointment_id', p_appointment_id,
    'cash_flow_id', v_cash_flow_id,
    'total_amount', v_total_amount,
    'service_amount', v_service_price,
    'products_amount', v_products_amount,
    'calculated_commission', v_commission
  );
END;
$$;


-- ============================================================================
-- 3. POLÍTICAS DE SEGURANÇA (RLS - ROW LEVEL SECURITY) POR BARBEIRO (v2.7)
-- ============================================================================

-- 3.1. Funções Auxiliares de Identidade e RBAC no Banco de Dados
-- Resolvem o `barber_id` a partir da sessão Supabase Auth (`auth.uid()` ou `auth.jwt()`)
CREATE OR REPLACE FUNCTION public.current_barber_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_jwt jsonb;
  v_barber_id uuid;
  v_jwt_barber_id text;
  v_email text;
  v_digits text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1) Vínculo direto por auth_user_id ou id === auth.uid()
  SELECT b.id
  INTO v_barber_id
  FROM public.barbers b
  WHERE b.auth_user_id = v_uid OR b.id = v_uid
  LIMIT 1;

  IF v_barber_id IS NOT NULL THEN
    RETURN v_barber_id;
  END IF;

  -- 2) Vínculo via metadados do JWT (user_metadata.barber_id ou app_metadata.barber_id)
  v_jwt := COALESCE(auth.jwt(), '{}'::jsonb);
  v_jwt_barber_id := COALESCE(
    v_jwt -> 'user_metadata' ->> 'barber_id',
    v_jwt -> 'app_metadata' ->> 'barber_id'
  );

  IF v_jwt_barber_id IS NOT NULL AND v_jwt_barber_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT b.id
    INTO v_barber_id
    FROM public.barbers b
    WHERE b.id = v_jwt_barber_id::uuid
    LIMIT 1;

    IF v_barber_id IS NOT NULL THEN
      RETURN v_barber_id;
    END IF;
  END IF;

  -- 3) Vínculo pelo telefone contido no e-mail sintético de autenticação (ex: 85999999999@jmbarber.local)
  v_email := COALESCE(v_jwt ->> 'email', '');
  IF v_email <> '' THEN
    v_digits := regexp_replace(split_part(v_email, '@', 1), '\D', '', 'g');
    IF length(v_digits) >= 8 THEN
      SELECT b.id
      INTO v_barber_id
      FROM public.barbers b
      WHERE regexp_replace(COALESCE(b.phone, ''), '\D', '', 'g') = v_digits
         OR RIGHT(regexp_replace(COALESCE(b.phone, ''), '\D', '', 'g'), 9) = RIGHT(v_digits, 9)
      LIMIT 1;
    END IF;
  END IF;

  RETURN v_barber_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_current_barber_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_barber_id uuid;
  v_is_admin boolean;
BEGIN
  -- Service role tem privilégio administrativo irrestrito no backend
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN true;
  END IF;

  v_barber_id := public.current_barber_id();
  IF v_barber_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT (b.role = 'admin' OR LOWER(TRIM(b.name)) = 'matheus')
  INTO v_is_admin
  FROM public.barbers b
  WHERE b.id = v_barber_id;

  RETURN COALESCE(v_is_admin, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_barber_has_permission(p_perm_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_barber_id uuid;
  v_allowed boolean;
BEGIN
  IF public.is_current_barber_admin() THEN
    RETURN true;
  END IF;

  v_barber_id := public.current_barber_id();
  IF v_barber_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    CASE
      WHEN b.role = 'admin' THEN true
      WHEN b.role = 'manager' AND p_perm_key IN ('view_all_appointments', 'manage_schedule_others', 'manage_services') THEN true
      ELSE COALESCE((b.permissions ->> p_perm_key)::boolean, false)
    END
  INTO v_allowed
  FROM public.barbers b
  WHERE b.id = v_barber_id;

  RETURN COALESCE(v_allowed, false);
END;
$$;


-- 3.2. Garantir RLS Habilitado em Todas as Tabelas Existentes
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;


-- 3.3. Políticas RLS para `public.appointments` (Isolamento de Agenda por Barbeiro)
DROP POLICY IF EXISTS "Allow all access appointments" ON public.appointments;
DROP POLICY IF EXISTS "appointments_select_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_insert_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_update_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_delete_policy" ON public.appointments;

CREATE POLICY "appointments_select_policy"
  ON public.appointments
  FOR SELECT
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('view_all_appointments')
  );

CREATE POLICY "appointments_insert_policy"
  ON public.appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  );

CREATE POLICY "appointments_update_policy"
  ON public.appointments
  FOR UPDATE
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  )
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  );

CREATE POLICY "appointments_delete_policy"
  ON public.appointments
  FOR DELETE
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
  );


-- 3.4. Políticas RLS para `public.commission_payouts` (Acertos e Comissões Isolados)
DROP POLICY IF EXISTS "Allow all access commission_payouts" ON public.commission_payouts;
DROP POLICY IF EXISTS "commission_payouts_select_isolated" ON public.commission_payouts;
DROP POLICY IF EXISTS "commission_payouts_admin_write" ON public.commission_payouts;

CREATE POLICY "commission_payouts_select_isolated"
  ON public.commission_payouts
  FOR SELECT
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
  );

CREATE POLICY "commission_payouts_admin_write"
  ON public.commission_payouts
  FOR ALL
  TO authenticated
  USING (public.is_current_barber_admin())
  WITH CHECK (public.is_current_barber_admin());


-- 3.5. Políticas RLS para `public.cash_flow` (Fluxo de Caixa e Despesas Isolados)
DROP POLICY IF EXISTS "Allow all access cash_flow" ON public.cash_flow;
DROP POLICY IF EXISTS "cash_flow_select_isolated" ON public.cash_flow;
DROP POLICY IF EXISTS "cash_flow_insert_isolated" ON public.cash_flow;
DROP POLICY IF EXISTS "cash_flow_modify_admin" ON public.cash_flow;
DROP POLICY IF EXISTS "cash_flow_delete_admin" ON public.cash_flow;

CREATE POLICY "cash_flow_select_isolated"
  ON public.cash_flow
  FOR SELECT
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_finance')
  );

CREATE POLICY "cash_flow_insert_isolated"
  ON public.cash_flow
  FOR INSERT
  TO authenticated
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_finance')
  );

CREATE POLICY "cash_flow_modify_admin"
  ON public.cash_flow
  FOR UPDATE
  TO authenticated
  USING (
    public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_finance')
  )
  WITH CHECK (
    public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_finance')
  );

CREATE POLICY "cash_flow_delete_admin"
  ON public.cash_flow
  FOR DELETE
  TO authenticated
  USING (
    public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_finance')
  );


-- 3.6. Políticas RLS para `public.barbers` (Perfis, Comissões e Chave Pix)
DROP POLICY IF EXISTS "Allow public read barbers" ON public.barbers;
DROP POLICY IF EXISTS "Allow admin manage barbers" ON public.barbers;
DROP POLICY IF EXISTS "barbers_select_policy" ON public.barbers;
DROP POLICY IF EXISTS "barbers_update_own_or_admin" ON public.barbers;
DROP POLICY IF EXISTS "barbers_insert_admin_only" ON public.barbers;
DROP POLICY IF EXISTS "barbers_delete_admin_only" ON public.barbers;

CREATE POLICY "barbers_select_policy"
  ON public.barbers
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "barbers_update_own_or_admin"
  ON public.barbers
  FOR UPDATE
  TO authenticated
  USING (
    id = public.current_barber_id()
    OR public.is_current_barber_admin()
  )
  WITH CHECK (
    id = public.current_barber_id()
    OR public.is_current_barber_admin()
  );

CREATE POLICY "barbers_insert_admin_only"
  ON public.barbers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_current_barber_admin());

CREATE POLICY "barbers_delete_admin_only"
  ON public.barbers
  FOR DELETE
  TO authenticated
  USING (public.is_current_barber_admin());


-- 3.7. Políticas RLS para Expediente, Folgas e Exceções (`barber_schedules`, `barber_exceptions`, `barber_leaves`)
DROP POLICY IF EXISTS "Allow public read barber_schedules" ON public.barber_schedules;
DROP POLICY IF EXISTS "Allow admin manage barber_schedules" ON public.barber_schedules;
DROP POLICY IF EXISTS "barber_schedules_select" ON public.barber_schedules;
DROP POLICY IF EXISTS "barber_schedules_write_isolated" ON public.barber_schedules;

CREATE POLICY "barber_schedules_select"
  ON public.barber_schedules
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "barber_schedules_write_isolated"
  ON public.barber_schedules
  FOR ALL
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  )
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  );

DROP POLICY IF EXISTS "Allow public read barber_exceptions" ON public.barber_exceptions;
DROP POLICY IF EXISTS "Allow admin manage barber_exceptions" ON public.barber_exceptions;
DROP POLICY IF EXISTS "barber_exceptions_select" ON public.barber_exceptions;
DROP POLICY IF EXISTS "barber_exceptions_write_isolated" ON public.barber_exceptions;

CREATE POLICY "barber_exceptions_select"
  ON public.barber_exceptions
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "barber_exceptions_write_isolated"
  ON public.barber_exceptions
  FOR ALL
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  )
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  );

DROP POLICY IF EXISTS "Allow public read barber_leaves" ON public.barber_leaves;
DROP POLICY IF EXISTS "Allow admin manage barber_leaves" ON public.barber_leaves;
DROP POLICY IF EXISTS "barber_leaves_select" ON public.barber_leaves;
DROP POLICY IF EXISTS "barber_leaves_write_isolated" ON public.barber_leaves;

CREATE POLICY "barber_leaves_select"
  ON public.barber_leaves
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "barber_leaves_write_isolated"
  ON public.barber_leaves
  FOR ALL
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  )
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  );


-- 3.8. Políticas RLS para Catálogo (`services`, `products`, `barber_services`)
DROP POLICY IF EXISTS "Allow public read services" ON public.services;
DROP POLICY IF EXISTS "Allow admin manage services" ON public.services;
DROP POLICY IF EXISTS "services_select_all" ON public.services;
DROP POLICY IF EXISTS "services_write_authorized" ON public.services;

CREATE POLICY "services_select_all"
  ON public.services
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "services_write_authorized"
  ON public.services
  FOR ALL
  TO authenticated
  USING (
    public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_services')
  )
  WITH CHECK (
    public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_services')
  );

DROP POLICY IF EXISTS "Allow public read products" ON public.products;
DROP POLICY IF EXISTS "Allow authenticated manage products" ON public.products;
DROP POLICY IF EXISTS "Allow service_role full access products" ON public.products;
DROP POLICY IF EXISTS "products_select_all" ON public.products;
DROP POLICY IF EXISTS "products_write_authenticated" ON public.products;

CREATE POLICY "products_select_all"
  ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "products_write_authenticated"
  ON public.products
  FOR ALL
  TO authenticated
  USING (
    public.current_barber_id() IS NOT NULL
  )
  WITH CHECK (
    public.current_barber_id() IS NOT NULL
  );

DROP POLICY IF EXISTS "Allow public read barber_services" ON public.barber_services;
DROP POLICY IF EXISTS "Allow admin manage barber_services" ON public.barber_services;
DROP POLICY IF EXISTS "barber_services_select_all" ON public.barber_services;
DROP POLICY IF EXISTS "barber_services_write_isolated" ON public.barber_services;

CREATE POLICY "barber_services_select_all"
  ON public.barber_services
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "barber_services_write_isolated"
  ON public.barber_services
  FOR ALL
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_services')
  )
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_services')
  );


-- 3.9. Políticas RLS para `push_subscriptions` e proteção defensiva para tabelas opcionais
DROP POLICY IF EXISTS "Allow all access push_subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_isolated" ON public.push_subscriptions;

CREATE POLICY "push_subscriptions_isolated"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
  )
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
  );

-- Bloco condicional seguro para `barber_recovery_codes` e `barber_recovery_state`
-- (só executa se as tabelas existirem no banco, evitando o erro 42P01)
DO $$
BEGIN
  IF to_regclass('public.barber_recovery_codes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.barber_recovery_codes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Allow service_role only recovery_codes" ON public.barber_recovery_codes';
    EXECUTE 'REVOKE ALL ON public.barber_recovery_codes FROM anon, authenticated';
  END IF;

  IF to_regclass('public.barber_recovery_state') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.barber_recovery_state ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Allow service_role only recovery_state" ON public.barber_recovery_state';
    EXECUTE 'REVOKE ALL ON public.barber_recovery_state FROM anon, authenticated';
  END IF;
END $$;

-- Revoga permissões diretas de escrita da role `anon` em tabelas financeiras e administrativas
REVOKE INSERT, UPDATE, DELETE ON public.commission_payouts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.cash_flow FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.barbers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.services FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.barber_services FROM anon;

-- Garante execução das funções auxiliares e RPCs para os perfis corretos
GRANT EXECUTE ON FUNCTION public.current_barber_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_barber_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_barber_has_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointment(text, text, uuid, uuid, uuid[], date, time without time zone, integer, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_payment_atomic(uuid, uuid, text, numeric, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
