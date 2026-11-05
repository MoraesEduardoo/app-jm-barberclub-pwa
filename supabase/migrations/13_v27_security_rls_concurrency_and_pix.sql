-- ============================================================================
-- MIGRATION 13: Consolidação v2.7 — Auditoria Estrutural, Chave Pix, Acertos,
-- Blindagem de Concorrência (FOR UPDATE + Unique Index) e Isolamento RLS
-- Projeto: JM Barberclub (Painel do Barbeiro & Chatbot WhatsApp)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. EVOLUÇÃO DE SCHEMA: CHAVE PIX E COMISSÃO DE PRODUTOS EM `public.barbers`
--    E DETALHAMENTO AUDITÁVEL EM `public.commission_payouts`
-- ============================================================================

-- 1.1. Adiciona campos de Chave Pix e Comissão de Produtos na tabela `barbers`
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_key_type varchar(30) DEFAULT 'cpf_cnpj',
  ADD COLUMN IF NOT EXISTS product_commission_percent numeric(5,2) DEFAULT 10.00 NOT NULL;

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

-- Garante que `appointments` possui vínculo com `commission_payouts`
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS commission_payout_id uuid REFERENCES public.commission_payouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS barber_commission_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS commission_paid boolean DEFAULT false;

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
  SELECT COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.default_duration_minutes, s.duration_minutes, 30)
  INTO v_new_duration
  FROM public.services s
  LEFT JOIN public.barber_services bs
    ON bs.service_id = s.id AND bs.barber_id = NEW.barber_id
  WHERE s.id = NEW.service_id;

  v_new_duration := GREATEST(COALESCE(v_new_duration, 30), 5);
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
        AND v_new_start < (a.appointment_time + (COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.default_duration_minutes, s.duration_minutes, 30) || ' minutes')::interval)::time
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


-- 2.4. Atualização da RPC Atômica `public.chatbot_create_appointment`
-- Com `SELECT ... FOR UPDATE` explícito, validação de expediente/férias e captura de colisão
CREATE OR REPLACE FUNCTION public.chatbot_create_appointment(
  p_client_name text,
  p_client_phone text,
  p_barber_id uuid,
  p_service_id uuid,
  p_date date,
  p_time time without time zone
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
  v_duration integer;
  v_service_price numeric(10,2);
  v_end_time time;
  v_conflict_count integer;
  v_new_id uuid;
  v_leave_exists boolean;
BEGIN
  -- 1. Lock transacional advisory + Lock de linha (`SELECT ... FOR UPDATE`) no barbeiro
  PERFORM pg_advisory_xact_lock(hashtext(p_barber_id::text || ':' || p_date::text));

  SELECT b.id, b.name
  INTO v_barber_id, v_barber_name
  FROM public.barbers b
  WHERE b.id = p_barber_id
    AND (b.active IS NULL OR b.active = true)
    AND (b.is_active IS NULL OR b.is_active = true)
  FOR UPDATE;

  IF v_barber_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BARBER_INACTIVE',
      'message', 'Este profissional não está disponível para agendamentos no momento.'
    );
  END IF;

  -- 2. Verifica se o barbeiro está em férias/ausência na data solicitada
  SELECT EXISTS (
    SELECT 1
    FROM public.barber_leaves bl
    WHERE bl.barber_id = p_barber_id
      AND p_date BETWEEN bl.start_date AND bl.end_date
  ) INTO v_leave_exists;

  IF v_leave_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BARBER_ON_LEAVE',
      'message', 'O profissional selecionado não estará atendendo nesta data.'
    );
  END IF;

  -- 3. Busca duração efetiva e preço (considerando `barber_services`)
  SELECT
    COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.default_duration_minutes, s.duration_minutes, 30),
    COALESCE(bs.custom_price, CASE WHEN s.price >= 1000 THEN s.price / 100.0 ELSE s.price END, 0)
  INTO v_duration, v_service_price
  FROM public.services s
  LEFT JOIN public.barber_services bs
    ON bs.service_id = s.id AND bs.barber_id = p_barber_id
  WHERE s.id = p_service_id
    AND (bs.is_active IS NULL OR bs.is_active = true);

  IF v_duration IS NULL THEN
    v_duration := 30;
  END IF;

  v_end_time := (p_time + (v_duration || ' minutes')::interval)::time;

  -- 4. Lock pessimista (`FOR UPDATE`) nos agendamentos ativos do dia para validar colisão
  SELECT COUNT(*)
  INTO v_conflict_count
  FROM (
    SELECT a.id
    FROM public.appointments a
    LEFT JOIN public.services s ON s.id = a.service_id
    LEFT JOIN public.barber_services bs ON bs.service_id = a.service_id AND bs.barber_id = a.barber_id
    WHERE a.barber_id = p_barber_id
      AND a.appointment_date = p_date
      AND COALESCE(a.status, 'agendado') NOT IN ('cancelado', 'cancelled')
      AND p_time < (a.appointment_time + (COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.default_duration_minutes, s.duration_minutes, 30) || ' minutes')::interval)::time
      AND v_end_time > a.appointment_time
    FOR UPDATE OF a
  ) locked_conflicts;

  IF v_conflict_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SLOT_ALREADY_BOOKED',
      'message', 'Este horário acabou de ser preenchido por outro cliente. Por favor, escolha outro horário.'
    );
  END IF;

  v_clean_phone := regexp_replace(COALESCE(p_client_phone, ''), '\D', '', 'g');

  -- 5. Inserção atômica protegida pelo índice único `idx_appointments_unique_active_slot`
  INSERT INTO public.appointments (
    client_name,
    client_phone,
    clean_phone,
    barber_id,
    service_id,
    appointment_date,
    appointment_time,
    price,
    total_price,
    status,
    payment_status
  ) VALUES (
    TRIM(COALESCE(p_client_name, 'Cliente')),
    p_client_phone,
    v_clean_phone,
    p_barber_id,
    p_service_id,
    p_date,
    p_time,
    v_service_price,
    v_service_price,
    'agendado',
    'pendente'
  )
  RETURNING id INTO v_new_id;

  -- 6. Atualiza ou insere o cliente no CRM (`clients`) de forma best-effort
  IF v_clean_phone <> '' THEN
    BEGIN
      INSERT INTO public.clients (name, phone, clean_phone, total_visits, last_visit_at)
      VALUES (TRIM(COALESCE(p_client_name, 'Cliente')), p_client_phone, v_clean_phone, 1, now())
      ON CONFLICT (clean_phone) DO UPDATE
      SET
        name = COALESCE(NULLIF(EXCLUDED.name, ''), public.clients.name),
        total_visits = COALESCE(public.clients.total_visits, 0) + 1,
        last_visit_at = now(),
        updated_at = now();
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_new_id,
    'barber_id', p_barber_id,
    'barber_name', v_barber_name,
    'appointment_date', p_date,
    'appointment_time', to_char(p_time, 'HH24:MI'),
    'duration_minutes', v_duration,
    'price', v_service_price,
    'message', 'Agendamento confirmado com sucesso!'
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SLOT_ALREADY_BOOKED',
      'message', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Escolha outro horário disponível.'
    );
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INTERNAL_ERROR',
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


-- 3.2. Garantir RLS Habilitado em Todas as Tabelas do Ecossistema
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
ALTER TABLE public.barber_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_recovery_state ENABLE ROW LEVEL SECURITY;


-- 3.3. Políticas RLS para `public.appointments` (Isolamento de Agenda por Barbeiro)
DROP POLICY IF EXISTS "Allow all access appointments" ON public.appointments;
DROP POLICY IF EXISTS "appointments_select_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_insert_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_update_policy" ON public.appointments;
DROP POLICY IF EXISTS "appointments_delete_policy" ON public.appointments;

-- Leitura: Cada barbeiro autenticado vê apenas a sua própria agenda (`barber_id = current_barber_id()`),
-- exceto se for o Chefe/Admin ou possuir a permissão `view_all_appointments`.
-- (O cálculo público de slots livres pelo Chatbot ocorre via RPC `SECURITY DEFINER`).
CREATE POLICY "appointments_select_policy"
  ON public.appointments
  FOR SELECT
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('view_all_appointments')
  );

-- Criação: Barbeiro cria encaixes/agendamentos para si mesmo ou Chefe/Gerente cria para a equipe
CREATE POLICY "appointments_insert_policy"
  ON public.appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_schedule_others')
  );

-- Atualização: Barbeiro altera apenas os seus próprios atendimentos (status, cobrança, produtos)
-- ou Chefe/Gerente autorizado
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

-- Exclusão: Apenas o próprio barbeiro do agendamento ou Chefe/Admin
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

-- Leitura: Cada colaborador (ex: William) enxerga EXCLUSIVAMENTE seus próprios recibos de acerto.
-- O Chefe (Matheus / Admin) enxerga os acertos de toda a barbearia.
CREATE POLICY "commission_payouts_select_isolated"
  ON public.commission_payouts
  FOR SELECT
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
  );

-- Escrita (Efetuar Acerto / Alterar / Excluir): Exclusivo para o Chefe / Admin
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

-- Leitura: Barbeiro consulta apenas suas próprias entradas financeiras (`barber_id = current_barber_id()`),
-- enquanto o Chefe/Admin (ou quem tem `manage_finance`) visualiza o caixa global e despesas.
CREATE POLICY "cash_flow_select_isolated"
  ON public.cash_flow
  FOR SELECT
  TO authenticated
  USING (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_finance')
  );

-- Inserção: Barbeiro registra recebimento de atendimento próprio ou Chefe/Admin lança receitas/despesas
CREATE POLICY "cash_flow_insert_isolated"
  ON public.cash_flow
  FOR INSERT
  TO authenticated
  WITH CHECK (
    barber_id = public.current_barber_id()
    OR public.is_current_barber_admin()
    OR public.current_barber_has_permission('manage_finance')
  );

-- Edição/Exclusão de lançamentos de caixa: Exclusivo para Chefe/Admin ou `manage_finance`
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

-- Leitura pública dos profissionais ativos (necessário para listagem de barbeiros no agendamento)
CREATE POLICY "barbers_select_policy"
  ON public.barbers
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Atualização: O barbeiro pode atualizar apenas seu próprio perfil básico (nome, avatar, pix_key),
-- enquanto o Chefe/Admin pode atualizar qualquer membro (incluindo comissões e permissões).
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

-- Criação e Remoção de Barbeiros: Exclusivo para Chefe/Admin
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


-- 3.9. Políticas RLS para `push_subscriptions` e Tabelas de Recuperação de Senha
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

DROP POLICY IF EXISTS "Allow service_role only recovery_codes" ON public.barber_recovery_codes;
DROP POLICY IF EXISTS "Allow service_role only recovery_state" ON public.barber_recovery_state;

-- Tabelas de recuperação de senha permanecem inacessíveis via PostgREST público (apenas service_role)
REVOKE ALL ON public.barber_recovery_codes FROM anon, authenticated;
REVOKE ALL ON public.barber_recovery_state FROM anon, authenticated;

-- Revoga permissões diretas de escrita da role `anon` em tabelas financeiras e administrativas
REVOKE INSERT, UPDATE, DELETE ON public.commission_payouts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.cash_flow FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.barbers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.services FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.barber_services FROM anon;

-- Garante execução das funções auxiliares para authenticated e service_role
GRANT EXECUTE ON FUNCTION public.current_barber_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_barber_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_barber_has_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointment(text, text, uuid, uuid, date, time without time zone) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_payment_atomic(uuid, uuid, text, numeric, text) TO authenticated, service_role;

COMMIT;
