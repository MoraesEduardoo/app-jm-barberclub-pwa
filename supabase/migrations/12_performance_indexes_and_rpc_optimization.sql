-- ==============================================================================
-- MIGRAÇÃO 12: OTIMIZAÇÃO DE PERFORMANCE SQL, ÍNDICES COBERTURA (COVERING) E
-- REESCRITA SET-BASED DAS FUNÇÕES RPC (ZERO N+1 QUERIES)
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/12_performance_indexes_and_rpc_optimization.sql
-- ==============================================================================
-- Diagnóstico Resolvido:
-- 1. Eliminação de 120+ subqueries em loop (N+1) dentro de chatbot_get_available_slots
--    por meio de CTE Set-Based com generate_series + intervalos pré-materializados.
-- 2. Eliminação de dupla consulta FOREACH em chatbot_create_appointment + lock
--    transacional leve (pg_advisory_xact_lock) por barbeiro/data.
-- 3. Criação de Índices Parciais e Covering Indexes (Index-Only Scan) em
--    public.appointments, public.barber_services, public.barbers e FKs não indexadas.
-- 4. Remoção de trigger redundante BEFORE UPDATE em public.appointments.
-- ==============================================================================

SET client_min_messages TO warning;

-- ------------------------------------------------------------------------------
-- 1. ÍNDICES DE ALTA PERFORMANCE E INDEX-ONLY SCAN (COVERING & PARTIAL INDEXES)
-- ------------------------------------------------------------------------------

-- 1.1. Índices Covering em public.barber_services (elimina Heap Fetch ao buscar
--      custom_duration e custom_price por barbeiro + serviço ou por serviço)
CREATE INDEX IF NOT EXISTS idx_barber_services_lookup_covering
ON public.barber_services (barber_id, service_id)
INCLUDE (custom_duration, custom_duration_minutes, custom_price, is_active);

CREATE INDEX IF NOT EXISTS idx_barber_services_service_lookup
ON public.barber_services (service_id, barber_id)
INCLUDE (custom_duration, custom_duration_minutes, custom_price, is_active);

-- 1.2. Índice Parcial Covering para Detecção de Colisão de Horários em public.appointments
--      Usado diretamente por chatbot_get_available_slots e chatbot_create_appointment
--      para realizar Index-Only Scan apenas nos agendamentos ativos do dia.
CREATE INDEX IF NOT EXISTS idx_appointments_active_collision_covering
ON public.appointments (barber_id, appointment_date, appointment_time)
INCLUDE (duration_minutes, buffer_minutes, end_time, status)
WHERE status NOT IN ('cancelado', 'cancelled');

-- 1.3. Índice com appointment_date na liderança para consultas globais (Toda a Equipe,
--      Relatórios Financeiros por período e Dashboard diário sem filtro de barber_id)
CREATE INDEX IF NOT EXISTS idx_appointments_date_leading
ON public.appointments (appointment_date, appointment_time ASC)
INCLUDE (barber_id, service_id, status, payment_status, price, total_price, barber_commission_amount);

-- 1.4. Índices de Chaves Estrangeiras (FKs) em public.appointments
--      Evitam Sequential Scan em JOINs com services/clients e eliminam locks de tabela
--      ao atualizar ou excluir registros em public.services ou public.clients.
CREATE INDEX IF NOT EXISTS idx_appointments_service_id_fk
ON public.appointments (service_id);

CREATE INDEX IF NOT EXISTS idx_appointments_client_id_fk
ON public.appointments (client_id);

-- 1.5. Índice Parcial para Agendamentos Ativos/Futuros por Telefone do Cliente
--      Acelera chatbot_list_appointments e chatbot_cancel_appointments.
CREATE INDEX IF NOT EXISTS idx_appointments_client_active_future
ON public.appointments (client_phone, appointment_date ASC, appointment_time ASC)
WHERE status NOT IN ('cancelado', 'cancelled');

-- 1.6. Índice Parcial para Histórico de Cancelamentos (aba Cancelados)
CREATE INDEX IF NOT EXISTS idx_appointments_cancelled_partial
ON public.appointments (barber_id, appointment_date DESC, cancelled_at DESC)
WHERE status IN ('cancelado', 'cancelled');

-- 1.7. Índices de Lookup Rápido em public.barbers e public.barber_exceptions
CREATE INDEX IF NOT EXISTS idx_barbers_active_order
ON public.barbers (is_active, display_order ASC, name ASC);

CREATE INDEX IF NOT EXISTS idx_barbers_clean_phone
ON public.barbers (clean_phone);

CREATE INDEX IF NOT EXISTS idx_barber_exceptions_unavailable
ON public.barber_exceptions (barber_id, exception_date)
INCLUDE (start_time, end_time)
WHERE is_available = false;

-- ------------------------------------------------------------------------------
-- 2. REMOÇÃO DE TRIGGER REDUNDANTE EM public.appointments
-- ------------------------------------------------------------------------------
-- O trigger `trg_sync_appointments_columns` já executa `NEW.updated_at := now()`
-- em todo INSERT ou UPDATE. Manter `trg_update_appointments_timestamp` causava
-- dupla invocação de função PL/pgSQL em cada confirmação/atualização de agendamento.
DROP TRIGGER IF EXISTS trg_update_appointments_timestamp ON public.appointments;

-- ------------------------------------------------------------------------------
-- 3. OTIMIZAÇÃO SET-BASED (ZERO N+1) DA RPC: public.chatbot_get_available_slots
-- ------------------------------------------------------------------------------
-- Substitui as ~120 subqueries executadas dentro do loop WHILE por uma única
-- query Set-Based com CTEs (busy_appointments, busy_exceptions e generate_series).
CREATE OR REPLACE FUNCTION public.chatbot_get_available_slots(
    p_barber_id uuid,
    p_date date,
    p_service_id uuid DEFAULT NULL
)
RETURNS TABLE (slot_time text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
    -- 1. Hora e data atuais estritamente no fuso horário America/Fortaleza (UTC-3)
    v_now_fortaleza := (now() AT TIME ZONE 'America/Fortaleza');
    v_today_fortaleza := v_now_fortaleza::date;
    v_time_now_fortaleza := v_now_fortaleza::time;

    -- Não exibe horários para datas passadas
    IF p_date < v_today_fortaleza THEN
        RETURN;
    END IF;

    -- 2. Verificar bloqueios gerais da barbearia ou folgas de dia inteiro do profissional
    IF EXISTS (
        SELECT 1 FROM public.blocked_dates
        WHERE (barber_id = p_barber_id OR barber_id IS NULL)
          AND date = p_date
    ) OR EXISTS (
        SELECT 1 FROM public.barber_leaves
        WHERE (barber_id = p_barber_id OR barber_id IS NULL)
          AND (date = p_date OR (start_date <= p_date AND end_date >= p_date))
    ) OR EXISTS (
        SELECT 1 FROM public.barber_exceptions
        WHERE barber_id = p_barber_id
          AND exception_date = p_date
          AND is_available = false
          AND start_time IS NULL
          AND end_time IS NULL
    ) THEN
        RETURN;
    END IF;

    -- 3. Identificar dia da semana (0=Domingo, 1=Segunda, ..., 6=Sábado)
    v_dow := EXTRACT(DOW FROM p_date)::integer;

    -- Buscar expediente configurado para o profissional (Index Scan em idx_barber_schedules_day)
    SELECT
        start_time,
        end_time,
        COALESCE(break_start_time, lunch_start),
        COALESCE(break_end_time, lunch_end),
        COALESCE(is_working, is_working_day, true)
    INTO
        v_start_time,
        v_end_time,
        v_lunch_start,
        v_lunch_end,
        v_is_working
    FROM public.barber_schedules
    WHERE barber_id = p_barber_id AND day_of_week = v_dow;

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

    -- 4. Calcular a duração do serviço solicitado (Index-Only Scan em idx_barber_services_lookup_covering)
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

    -- 5. Geração e filtragem Set-Based em uma única passagem (sem N+1 queries em loop)
    RETURN QUERY
    WITH busy_appointments AS MATERIALIZED (
        SELECT
            a.appointment_time AS win_start,
            (
                a.appointment_time + make_interval(
                    mins => COALESCE(a.duration_minutes, 30) + COALESCE(a.buffer_minutes, 0)
                )
            )::time AS win_end
        FROM public.appointments a
        WHERE a.barber_id = p_barber_id
          AND a.appointment_date = p_date
          AND a.status NOT IN ('cancelado', 'cancelled')
          AND a.status IN (
              'confirmed', 'confirmado',
              'pending', 'pendente',
              'completed', 'concluido', 'concluído',
              'bloqueado', 'blocked',
              'pre_scheduled', 'pre_agendado'
          )
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

-- ------------------------------------------------------------------------------
-- 4. OTIMIZAÇÃO DA RPC: public.chatbot_create_appointment
-- ------------------------------------------------------------------------------
-- Elimina o duplo loop FOREACH que consultava `services` + `barber_services`
-- duas vezes seguidas para os mesmos serviços, e adiciona `pg_advisory_xact_lock`
-- por (barber_id, p_date) para evitar race conditions em confirmações simultâneas.
CREATE OR REPLACE FUNCTION public.chatbot_create_appointment(
    p_client_name text,
    p_client_phone text,
    p_barber_id uuid,
    p_service_id uuid DEFAULT NULL,
    p_service_ids uuid[] DEFAULT NULL,
    p_date date DEFAULT NULL,
    p_time time DEFAULT NULL,
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
    v_clean_phone text;
    v_client_id uuid;
    v_target_service_ids uuid[] := '{}';
    v_created_ids uuid[] := '{}';
    v_new_id uuid;
    v_total_duration integer := 0;
    v_total_price numeric(10,2) := 0.00;
    v_current_start time;
    v_estimated_end time;
    v_has_conflict boolean;
    v_rec record;
BEGIN
    -- 1. Higienização do telefone do cliente (apenas dígitos)
    v_clean_phone := regexp_replace(COALESCE(p_client_phone, ''), '\D', '', 'g');
    IF length(v_clean_phone) < 8 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Número de telefone inválido.',
            'code', 'INVALID_PHONE'
        );
    END IF;

    -- 2. Montar lista de serviços
    IF p_service_ids IS NOT NULL AND array_length(p_service_ids, 1) > 0 THEN
        v_target_service_ids := p_service_ids;
    ELSIF p_service_id IS NOT NULL THEN
        v_target_service_ids := ARRAY[p_service_id];
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Nenhum serviço foi informado para o agendamento.',
            'code', 'MISSING_SERVICE'
        );
    END IF;

    -- 3. Lock transacional leve por barbeiro + data (evita colisão concorrente sem travar a tabela)
    PERFORM pg_advisory_xact_lock(hashtext(p_barber_id::text || ':' || p_date::text));

    -- 4. Calcular duração total e preço total em uma única query Set-Based
    SELECT
        COALESCE(SUM(COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30)), 0)::integer,
        COALESCE(SUM(COALESCE(bs.custom_price, s.price, 0.00)), 0.00)::numeric(10,2)
    INTO
        v_total_duration,
        v_total_price
    FROM unnest(v_target_service_ids) WITH ORDINALITY AS u(service_id, ord)
    LEFT JOIN public.services s ON s.id = u.service_id
    LEFT JOIN public.barber_services bs ON bs.service_id = s.id AND bs.barber_id = p_barber_id;

    IF v_total_duration <= 0 THEN
        v_total_duration := COALESCE(p_duration_minutes, 30);
    END IF;

    v_estimated_end := (p_time + make_interval(mins => v_total_duration))::time;

    -- 5. Verificar colisão usando o índice parcial idx_appointments_active_collision_covering
    SELECT EXISTS (
        SELECT 1
        FROM public.appointments a
        WHERE a.barber_id = p_barber_id
          AND a.appointment_date = p_date
          AND a.status NOT IN ('cancelado', 'cancelled')
          AND a.status IN (
              'confirmed', 'confirmado',
              'pending', 'pendente',
              'completed', 'concluido', 'concluído',
              'bloqueado', 'blocked',
              'pre_scheduled', 'pre_agendado'
          )
          AND (
              a.appointment_time < v_estimated_end
              AND (
                  a.appointment_time + make_interval(
                      mins => COALESCE(a.duration_minutes, 30) + COALESCE(a.buffer_minutes, 0)
                  )
              )::time > p_time
          )
    ) INTO v_has_conflict;

    IF v_has_conflict THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O horário selecionado acabou de ser ocupado. Por favor, escolha outro horário.',
            'code', 'SLOT_OCCUPIED'
        );
    END IF;

    -- 6. Upsert atômico do Cliente (evita escrita desnecessária se o nome não mudou)
    INSERT INTO public.clients (name, phone, updated_at)
    VALUES (trim(p_client_name), v_clean_phone, now())
    ON CONFLICT (phone) DO UPDATE
    SET
        name = EXCLUDED.name,
        updated_at = now()
    WHERE public.clients.name IS DISTINCT FROM EXCLUDED.name
    RETURNING id INTO v_client_id;

    IF v_client_id IS NULL THEN
        SELECT id INTO v_client_id
        FROM public.clients
        WHERE phone = v_clean_phone
        LIMIT 1;
    END IF;

    -- 7. Inserir agendamentos na ordem exata dos serviços selecionados
    v_current_start := p_time;

    FOR v_rec IN
        SELECT
            u.service_id,
            COALESCE(s.name, 'Serviço') AS item_name,
            COALESCE(bs.custom_duration, bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30)::integer AS item_duration,
            COALESCE(bs.custom_price, s.price, 0.00)::numeric(10,2) AS item_price
        FROM unnest(v_target_service_ids) WITH ORDINALITY AS u(service_id, ord)
        LEFT JOIN public.services s ON s.id = u.service_id
        LEFT JOIN public.barber_services bs ON bs.service_id = s.id AND bs.barber_id = p_barber_id
        ORDER BY u.ord ASC
    LOOP
        INSERT INTO public.appointments (
            barber_id,
            service_id,
            client_id,
            client_name,
            client_phone,
            service,
            appointment_date,
            appointment_time,
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
            trim(p_client_name),
            v_clean_phone,
            v_rec.item_name,
            p_date,
            v_current_start,
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
        ) RETURNING id INTO v_new_id;

        v_created_ids := array_append(v_created_ids, v_new_id);
        v_current_start := (v_current_start + make_interval(mins => v_rec.item_duration))::time;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'appointment_id', v_created_ids[1],
        'appointment_ids', v_created_ids,
        'client_id', v_client_id,
        'date', p_date,
        'start_time', to_char(p_time, 'HH24:MI'),
        'end_time', to_char(v_estimated_end, 'HH24:MI'),
        'total_duration', v_total_duration,
        'total_price', v_total_price
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM,
        'code', SQLSTATE
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. PERMISSÕES, ATUALIZAÇÃO DE ESTATÍSTICAS DO PLANNER E RELOAD DO POSTGREST
-- ------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.chatbot_get_available_slots(uuid, date, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointment(text, text, uuid, uuid, uuid[], date, time, integer, integer, text) TO anon, authenticated, service_role;

ANALYZE public.barbers;
ANALYZE public.services;
ANALYZE public.barber_services;
ANALYZE public.barber_schedules;
ANALYZE public.barber_exceptions;
ANALYZE public.clients;
ANALYZE public.appointments;

NOTIFY pgrst, 'reload schema';
