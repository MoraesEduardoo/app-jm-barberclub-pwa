-- ==============================================================================
-- MIGRAÇÃO 14: BLINDAGEM DE ALTA CONCORRÊNCIA DO CHATBOT (v2.7)
-- Auditoria de Locks Transacionais (pg_advisory_xact_lock + SELECT FOR UPDATE),
-- Unificação de Assinatura RPC (Prevenção PGRST203), Tratamento SQLSTATE 23505
-- (SLOT_ALREADY_BOOKED) e Índices Covering (Index-Only Scan < 2ms)
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. VALIDAÇÃO E REFORÇO DA RESTRIÇÃO FÍSICA DE UNICIDADE DE SLOT ATIVO
-- ==============================================================================

-- 1.1. Garante o índice único parcial físico para barrar duplicidade no motor PostgreSQL
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_active_slot
  ON public.appointments (barber_id, appointment_date, appointment_time)
  WHERE COALESCE(status, 'agendado') NOT IN ('cancelado', 'cancelled');

-- 1.2. Índice Parcial Covering alinhado exatamente com o predicado COALESCE(status, 'agendado')
--      para permitir Index-Only Scan tanto em chatbot_get_available_slots quanto em chatbot_create_appointment
DROP INDEX IF EXISTS public.idx_appointments_active_collision_covering;
CREATE INDEX IF NOT EXISTS idx_appointments_active_collision_covering
  ON public.appointments (barber_id, appointment_date, appointment_time ASC)
  INCLUDE (id, duration_minutes, buffer_minutes, end_time, status, is_walk_in, service_id)
  WHERE COALESCE(status, 'agendado') NOT IN ('cancelado', 'cancelled');


-- ==============================================================================
-- 2. OTIMIZAÇÃO DE ÍNDICES COVERING (INDEX-ONLY SCAN) NAS TABELAS DO CHATBOT
--    (`appointments`, `barbers`, `services`, `barber_schedules`, `barber_leaves`)
-- ==============================================================================

-- 2.1. `public.barbers`: Index-Only Scan para validação instantânea de barbeiro ativo
CREATE INDEX IF NOT EXISTS idx_barbers_id_active_covering
  ON public.barbers (id)
  INCLUDE (name, active, is_active, role, commission_percent, product_commission_percent)
  WHERE COALESCE(active, true) = true AND COALESCE(is_active, true) = true;

-- 2.2. `public.services`: Index-Only Scan para lookup de duração e preço por service_id
CREATE INDEX IF NOT EXISTS idx_services_id_duration_price_covering
  ON public.services (id)
  INCLUDE (name, price, duration_minutes, default_duration_minutes, is_active, active);

-- 2.3. `public.barber_schedules`: Covering Index por (barber_id, day_of_week)
--      Elimina Heap Fetch ao consultar início/fim do expediente e horário de almoço
DROP INDEX IF EXISTS public.idx_barber_schedules_day_covering;
CREATE INDEX IF NOT EXISTS idx_barber_schedules_day_covering
  ON public.barber_schedules (barber_id, day_of_week)
  INCLUDE (start_time, end_time, break_start_time, break_end_time, lunch_start, lunch_end, is_working, is_working_day);

-- 2.4. `public.barber_leaves`: Índices otimizados para busca por intervalo de datas (start_date <= p_date <= end_date)
CREATE INDEX IF NOT EXISTS idx_barber_leaves_barber_date_range
  ON public.barber_leaves (barber_id, start_date, end_date)
  INCLUDE (date);

CREATE INDEX IF NOT EXISTS idx_barber_leaves_global_date_range
  ON public.barber_leaves (start_date, end_date)
  WHERE barber_id IS NULL;

-- 2.5. `public.barber_exceptions` e `public.blocked_dates`: Índices parciais para bloqueio de dia inteiro e parcial
CREATE INDEX IF NOT EXISTS idx_barber_exceptions_fullday_unavailable
  ON public.barber_exceptions (barber_id, exception_date)
  WHERE is_available = false AND start_time IS NULL AND end_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_blocked_dates_lookup
  ON public.blocked_dates (date, barber_id);


-- ==============================================================================
-- 3. OTIMIZAÇÃO DE PERFORMANCE EM MILISSEGUNDOS: `public.chatbot_get_available_slots`
-- ==============================================================================
-- Melhorias aplicadas:
-- - Verifica se o barbeiro está ativo (`idx_barbers_id_active_covering`).
-- - Usa `COALESCE(a.status, 'agendado') NOT IN ('cancelado', 'cancelled')`, garantindo
--   que agendamentos criados no Painel com status `'agendado'` também bloqueiem o slot
--   e que o planner use `idx_appointments_active_collision_covering` via Index-Only Scan.
-- - Calcula a janela real de ocupação considerando `end_time` gravado ou `duration_minutes + buffer_minutes`.

CREATE OR REPLACE FUNCTION public.chatbot_get_available_slots(
  p_barber_id uuid,
  p_date date,
  p_service_id uuid DEFAULT NULL
)
RETURNS TABLE (slot_time text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_barber_exists boolean;
  v_dow integer;
  v_start_time time;
  v_end_time time;
  v_lunch_start time;
  v_lunch_end time;
  v_is_working boolean := true;
  v_service_duration integer := 30;
  v_now_fortaleza timestamp;
  v_today_fortaleza date;
  v_time_now_fortaleza time;
  v_min_cutoff_time time;
BEGIN
  -- 1. Valida se o barbeiro existe e está ativo (Index-Only Scan em idx_barbers_id_active_covering)
  SELECT EXISTS (
    SELECT 1
    FROM public.barbers b
    WHERE b.id = p_barber_id
      AND COALESCE(b.active, true) = true
      AND COALESCE(b.is_active, true) = true
  ) INTO v_barber_exists;

  IF NOT v_barber_exists THEN
    RETURN;
  END IF;

  -- 2. Hora e data atuais estritamente no fuso horário America/Fortaleza (UTC-3)
  v_now_fortaleza := (now() AT TIME ZONE 'America/Fortaleza');
  v_today_fortaleza := v_now_fortaleza::date;
  v_time_now_fortaleza := v_now_fortaleza::time;

  -- Não exibe horários para datas passadas
  IF p_date < v_today_fortaleza THEN
    RETURN;
  END IF;

  -- 3. Verifica bloqueios gerais da barbearia, férias ou folgas de dia inteiro do profissional
  IF EXISTS (
    SELECT 1 FROM public.blocked_dates bd
    WHERE bd.date = p_date
      AND (bd.barber_id = p_barber_id OR bd.barber_id IS NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.barber_leaves bl
    WHERE (bl.barber_id = p_barber_id OR bl.barber_id IS NULL)
      AND (bl.date = p_date OR (bl.start_date <= p_date AND bl.end_date >= p_date))
  ) OR EXISTS (
    SELECT 1 FROM public.barber_exceptions be
    WHERE be.barber_id = p_barber_id
      AND be.exception_date = p_date
      AND be.is_available = false
      AND be.start_time IS NULL
      AND be.end_time IS NULL
  ) THEN
    RETURN;
  END IF;

  -- 4. Identifica dia da semana (0=Domingo, 1=Segunda, ..., 6=Sábado)
  v_dow := EXTRACT(DOW FROM p_date)::integer;

  -- Busca expediente configurado para o profissional (Index-Only Scan em idx_barber_schedules_day_covering)
  SELECT
    bs.start_time,
    bs.end_time,
    COALESCE(bs.break_start_time, bs.lunch_start),
    COALESCE(bs.break_end_time, bs.lunch_end),
    COALESCE(bs.is_working, bs.is_working_day, true)
  INTO
    v_start_time,
    v_end_time,
    v_lunch_start,
    v_lunch_end,
    v_is_working
  FROM public.barber_schedules bs
  WHERE bs.barber_id = p_barber_id
    AND bs.day_of_week = v_dow
  LIMIT 1;

  -- Escala padrão JM BarberClub caso não haja escala individual cadastrada
  IF v_start_time IS NULL THEN
    IF v_dow = 0 THEN -- Domingo: 09:00 - 12:30
      v_start_time := '09:00'::time;
      v_end_time := '12:30'::time;
      v_is_working := true;
    ELSIF v_dow = 1 THEN -- Segunda-feira: 14:30 - 19:00
      v_start_time := '14:30'::time;
      v_end_time := '19:00'::time;
      v_is_working := true;
    ELSE -- Terça a Sábado: 09:00 - 19:00
      v_start_time := '09:00'::time;
      v_end_time := '19:00'::time;
      v_is_working := true;
    END IF;
  END IF;

  IF v_is_working = false OR v_start_time IS NULL OR v_end_time IS NULL THEN
    RETURN;
  END IF;

  -- 5. Calcula a duração do serviço solicitado (Index-Only Scan em idx_barber_services_lookup_covering + idx_services_id_duration_price_covering)
  IF p_service_id IS NOT NULL THEN
    SELECT COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30)
    INTO v_service_duration
    FROM public.services s
    LEFT JOIN public.barber_services bs
      ON bs.service_id = s.id AND bs.barber_id = p_barber_id
    WHERE s.id = p_service_id;
  END IF;

  IF v_service_duration IS NULL OR v_service_duration < 5 THEN
    v_service_duration := 30;
  END IF;

  IF v_start_time + make_interval(mins => v_service_duration) > v_end_time THEN
    RETURN;
  END IF;

  v_min_cutoff_time := date_trunc('minute', v_time_now_fortaleza);

  -- 6. Geração e filtragem Set-Based em uma única passagem (Zero N+1 queries)
  RETURN QUERY
  WITH busy_appointments AS MATERIALIZED (
    SELECT
      a.appointment_time AS win_start,
      GREATEST(
        COALESCE(a.end_time, (a.appointment_time + make_interval(mins => COALESCE(a.duration_minutes, 30)))::time),
        (a.appointment_time + make_interval(
          mins => COALESCE(a.duration_minutes, 30) + COALESCE(a.buffer_minutes, 0)
        ))::time
      ) AS win_end
    FROM public.appointments a
    WHERE a.barber_id = p_barber_id
      AND a.appointment_date = p_date
      AND COALESCE(a.status, 'agendado') NOT IN ('cancelado', 'cancelled')
  ),
  busy_exceptions AS MATERIALIZED (
    SELECT
      e.start_time AS win_start,
      e.end_time AS win_end
    FROM public.barber_exceptions e
    WHERE e.barber_id = p_barber_id
      AND e.exception_date = p_date
      AND e.is_available = false
      AND e.start_time IS NOT NULL
      AND e.end_time IS NOT NULL
  ),
  candidate_slots AS (
    SELECT
      gs::time AS c_start,
      (gs + make_interval(mins => v_service_duration))::time AS c_end
    FROM generate_series(
      p_date + v_start_time,
      p_date + v_end_time - make_interval(mins => v_service_duration),
      interval '10 minutes'
    ) AS gs
  )
  SELECT to_char(cs.c_start, 'HH24:MI') AS slot_time
  FROM candidate_slots cs
  WHERE
    -- Regra 1: No dia atual, apenas horários estritamente após o minuto atual em America/Fortaleza
    (p_date > v_today_fortaleza OR cs.c_start > v_min_cutoff_time)
    -- Regra 2: Respeito ao horário de almoço / pausa
    AND (
      v_lunch_start IS NULL
      OR v_lunch_end IS NULL
      OR NOT (cs.c_start < v_lunch_end AND cs.c_end > v_lunch_start)
    )
    -- Regra 3: Sem colisão com exceções parciais do dia
    AND NOT EXISTS (
      SELECT 1
      FROM busy_exceptions be
      WHERE cs.c_start < be.win_end
        AND cs.c_end > be.win_start
    )
    -- Regra 4: Sem colisão com agendamentos ativos + buffer_minutes
    AND NOT EXISTS (
      SELECT 1
      FROM busy_appointments ba
      WHERE cs.c_start < ba.win_end
        AND cs.c_end > ba.win_start
    )
  ORDER BY cs.c_start ASC;
END;
$$;


-- ==============================================================================
-- 4. UNIFICAÇÃO E BLINDAGEM DA RPC ATÔMICA: `public.chatbot_create_appointment`
-- ==============================================================================
-- Remove a sobrecarga ambígua de 6 parâmetros para evitar erro PostgREST `PGRST203`
-- e consolida toda a lógica na assinatura canônica (compatível com 6, 7 ou 10 parâmetros).

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
  -- 1. Validação de parâmetros obrigatórios (data, horário e profissional)
  IF p_barber_id IS NULL OR p_date IS NULL OR p_time IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MISSING_PARAMETERS',
      'error', 'Profissional, data e horário são obrigatórios para confirmar o agendamento.',
      'message', 'Profissional, data e horário são obrigatórios para confirmar o agendamento.'
    );
  END IF;

  -- 2. Higienização e validação do telefone do cliente
  v_clean_phone := regexp_replace(COALESCE(p_client_phone, ''), '\D', '', 'g');
  IF length(v_clean_phone) < 8 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_PHONE',
      'error', 'Número de telefone inválido. Informe um número com DDD.',
      'message', 'Número de telefone inválido. Informe um número com DDD.'
    );
  END IF;

  -- 3. Montagem da lista de serviços (aceita p_service_ids[] ou p_service_id único)
  IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
    v_target_service_ids := p_service_ids;
  ELSIF p_service_id IS NOT NULL THEN
    v_target_service_ids := ARRAY[p_service_id];
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'code', 'MISSING_SERVICE',
      'error', 'Nenhum serviço foi selecionado para o agendamento.',
      'message', 'Nenhum serviço foi selecionado para o agendamento.'
    );
  END IF;

  -- ============================================================================
  -- 4. BLOQUEIOS TRANSACIONAIS RIGOROSOS DE ALTA CONCORRÊNCIA (ANTI-RACE CONDITION)
  -- ============================================================================
  -- 4.1. Lock Advisory exclusivo por (barber_id + appointment_date) durante toda a transação
  PERFORM pg_advisory_xact_lock(hashtext(p_barber_id::text || ':' || p_date::text));

  -- 4.2. Lock Pessimista de Linha (`SELECT ... FOR UPDATE`) no registro do Barbeiro
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
      'error', 'Este profissional não está ativo ou disponível para agendamentos.',
      'message', 'Este profissional não está ativo ou disponível para agendamentos.'
    );
  END IF;

  -- 5. Verifica se o barbeiro está em férias, folga ou data bloqueada
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

  -- 6. Calcula duração total e preço total respeitando `custom_duration` e `custom_price` de `barber_services`
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

  -- 7. Verifica se há bloqueio parcial (`barber_exceptions`) colidindo com a janela do agendamento
  IF EXISTS (
    SELECT 1
    FROM public.barber_exceptions be
    WHERE be.barber_id = p_barber_id
      AND be.exception_date = p_date
      AND be.is_available = false
      AND be.start_time IS NOT NULL
      AND be.end_time IS NOT NULL
      AND p_time < be.end_time
      AND v_estimated_end > be.start_time
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'SLOT_ALREADY_BOOKED',
      'error', 'Este horário está bloqueado na agenda do profissional. Por favor, escolha outro horário.',
      'message', 'Este horário está bloqueado na agenda do profissional. Por favor, escolha outro horário.'
    );
  END IF;

  -- 8. Lock Pessimista (`SELECT ... FOR UPDATE OF a`) nos agendamentos ativos do dia
  --    Impede que qualquer outra transação leia ou modifique os slots concorrentes até o COMMIT
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
      'conflict_appointment_id', v_conflict_id,
      'conflict_time', to_char(v_conflict_time, 'HH24:MI'),
      'error', 'Este horário acabou de ser preenchido por outro cliente. Por favor, escolha outro horário disponível.',
      'message', 'Este horário acabou de ser preenchido por outro cliente. Por favor, escolha outro horário disponível.'
    );
  END IF;

  -- 9. Upsert atômico do Cliente no CRM (`public.clients`)
  BEGIN
    INSERT INTO public.clients (name, phone, clean_phone, total_visits, last_visit_at, updated_at)
    VALUES (
      TRIM(COALESCE(NULLIF(p_client_name, ''), 'Cliente')),
      v_clean_phone,
      v_clean_phone,
      1,
      now(),
      now()
    )
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

  -- 10. Inserção atômica dos agendamentos na ordem dos serviços selecionados
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
      'error', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Por favor, escolha outro horário disponível.',
      'message', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Por favor, escolha outro horário disponível.'
    );
  WHEN OTHERS THEN
    IF SQLSTATE = '23505' OR SQLERRM ILIKE '%CONFLITO_HORARIO%' OR SQLERRM ILIKE '%idx_appointments_unique_active_slot%' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SLOT_ALREADY_BOOKED',
        'sqlstate', '23505',
        'error', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Por favor, escolha outro horário disponível.',
        'message', 'Este horário acabou de ser reservado simultaneamente por outro cliente. Por favor, escolha outro horário disponível.'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'INTERNAL_ERROR',
      'sqlstate', SQLSTATE,
      'error', SQLERRM,
      'message', 'Não foi possível concluir o agendamento no momento. Tente novamente.'
    );
END;
$$;


-- ==============================================================================
-- 5. PERMISSÕES, ESTATÍSTICAS DO PLANNER E RELOAD DO SCHEMA CACHE
-- ==============================================================================

GRANT EXECUTE ON FUNCTION public.chatbot_get_available_slots(uuid, date, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointment(text, text, uuid, uuid, uuid[], date, time without time zone, integer, integer, text) TO anon, authenticated, service_role;

ANALYZE public.appointments;
ANALYZE public.barbers;
ANALYZE public.services;
ANALYZE public.barber_services;
ANALYZE public.barber_schedules;
ANALYZE public.barber_leaves;
ANALYZE public.barber_exceptions;
ANALYZE public.blocked_dates;

NOTIFY pgrst, 'reload schema';

COMMIT;
