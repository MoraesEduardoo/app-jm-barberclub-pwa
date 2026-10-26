-- ==============================================================================
-- MIGRAÇÃO 05: FUNÇÕES RPC (MOTOR DE AGENDAMENTO 10 EM 10 MIN E TRANSAÇÕES ATÔMICAS)
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/05_rpc_functions.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FUNÇÃO RPC: chatbot_get_available_slots
-- Assinatura única, canônica e blindada contra ambiguidades.
-- Grade rígida de 10 em 10 minutos com ocupação exata pela duração do serviço.
-- ------------------------------------------------------------------------------
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
    v_current_slot time;
    v_slot_end time;
    v_is_conflict boolean;
    v_now_fortaleza timestamptz;
    v_today_fortaleza date;
    v_time_now_fortaleza time;
BEGIN
    v_now_fortaleza := timezone('America/Fortaleza', now());
    v_today_fortaleza := v_now_fortaleza::date;
    v_time_now_fortaleza := v_now_fortaleza::time;

    IF p_date < v_today_fortaleza THEN
        RETURN;
    END IF;

    -- 1. Verificar bloqueios da barbearia ou folgas do profissional
    IF EXISTS (
        SELECT 1 FROM public.blocked_dates
        WHERE (barber_id = p_barber_id OR barber_id IS NULL)
          AND date = p_date
    ) OR EXISTS (
        SELECT 1 FROM public.barber_leaves
        WHERE (barber_id = p_barber_id OR barber_id IS NULL)
          AND (date = p_date OR (start_date <= p_date AND end_date >= p_date))
    ) THEN
        RETURN;
    END IF;

    -- 2. Identificar dia da semana (0=Domingo, 1=Segunda, ..., 6=Sábado)
    v_dow := EXTRACT(DOW FROM p_date)::integer;

    -- Buscar expediente configurado para o profissional
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

    -- Padrão JM BarberClub caso não haja escala individual cadastrada
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

    -- 3. Calcular a duração do serviço solicitado
    IF p_service_id IS NOT NULL THEN
        SELECT COALESCE(bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30)
        INTO v_service_duration
        FROM public.services s
        LEFT JOIN public.barber_services bs ON bs.service_id = s.id AND bs.barber_id = p_barber_id
        WHERE s.id = p_service_id;
    END IF;

    IF v_service_duration IS NULL OR v_service_duration < 10 THEN
        v_service_duration := 30;
    END IF;

    -- 4. Iteração em grade pura de 10 em 10 minutos
    v_current_slot := v_start_time;

    WHILE v_current_slot + (v_service_duration || ' minutes')::interval <= v_end_time LOOP
        v_slot_end := (v_current_slot + (v_service_duration || ' minutes')::interval)::time;
        v_is_conflict := false;

        -- Regra de antecedência mínima para hoje (mínimo 30 minutos à frente)
        IF p_date = v_today_fortaleza THEN
            IF v_current_slot < (v_time_now_fortaleza + '30 minutes'::interval)::time THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Regra de Almoço / Pausa
        IF NOT v_is_conflict AND v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
            IF (v_current_slot < v_lunch_end AND v_slot_end > v_lunch_start) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Regra de Exceções de Horário (barber_exceptions)
        IF NOT v_is_conflict THEN
            IF EXISTS (
                SELECT 1 FROM public.barber_exceptions
                WHERE barber_id = p_barber_id
                  AND exception_date = p_date
                  AND is_available = false
                  AND (
                      (start_time IS NULL AND end_time IS NULL)
                      OR (v_current_slot < end_time AND v_slot_end > start_time)
                  )
            ) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Regra de Colisão com Agendamentos Existentes (+ buffer de respiro de 10 min)
        IF NOT v_is_conflict THEN
            IF EXISTS (
                SELECT 1 FROM public.appointments a
                WHERE a.barber_id = p_barber_id
                  AND a.appointment_date = p_date
                  AND a.status IN ('confirmed', 'confirmado', 'pending', 'pendente', 'completed', 'concluido', 'concluído', 'bloqueado', 'blocked', 'pre_scheduled')
                  AND (
                      a.appointment_time < v_slot_end
                      AND (a.appointment_time + ((COALESCE(a.duration_minutes, 30) + COALESCE(a.buffer_minutes, 0)) || ' minutes')::interval)::time > v_current_slot
                  )
            ) THEN
                v_is_conflict := true;
            END IF;
        END IF;

        -- Emitir horário livre
        IF NOT v_is_conflict THEN
            slot_time := to_char(v_current_slot, 'HH24:MI');
            RETURN NEXT;
        END IF;

        -- Avançar estritamente 10 minutos
        v_current_slot := (v_current_slot + '10 minutes'::interval)::time;
    END LOOP;

    RETURN;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. FUNÇÃO RPC: chatbot_create_appointment (TRANSAÇÃO ATÔMICA E SEGURA)
-- Assinatura completa, compatível com chamadas de Client & Server Action.
-- Concorrência protegida com detecção antecipada de duplicidade/overlap.
-- ------------------------------------------------------------------------------
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
    v_primary_service_id uuid;
    v_target_service_ids uuid[] := '{}';
    v_service_elem uuid;
    v_created_ids uuid[] := '{}';
    v_new_id uuid;
    v_total_duration integer := 0;
    v_item_duration integer;
    v_item_price numeric(10,2);
    v_item_name text;
    v_total_price numeric(10,2) := 0.00;
    v_current_start time;
    v_estimated_end time;
    v_has_conflict boolean;
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

    v_primary_service_id := v_target_service_ids[1];

    -- 3. Calcular duração total acumulada e valor total
    FOREACH v_service_elem IN ARRAY v_target_service_ids LOOP
        SELECT
            COALESCE(bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30),
            COALESCE(bs.custom_price, s.price, 0.00)
        INTO
            v_item_duration,
            v_item_price
        FROM public.services s
        LEFT JOIN public.barber_services bs ON bs.service_id = s.id AND bs.barber_id = p_barber_id
        WHERE s.id = v_service_elem;

        v_total_duration := v_total_duration + COALESCE(v_item_duration, 30);
        v_total_price := v_total_price + COALESCE(v_item_price, 0.00);
    END LOOP;

    IF v_total_duration = 0 THEN
        v_total_duration := COALESCE(p_duration_minutes, 30);
    END IF;

    v_estimated_end := (p_time + (v_total_duration || ' minutes')::interval)::time;

    -- 4. Trava de concorrência: Verificar se o horário solicitado ainda está livre
    SELECT EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.barber_id = p_barber_id
          AND a.appointment_date = p_date
          AND a.status IN ('confirmed', 'confirmado', 'pending', 'pendente', 'completed', 'concluido', 'concluído', 'bloqueado', 'blocked', 'pre_scheduled')
          AND (
              a.appointment_time < v_estimated_end
              AND (a.appointment_time + ((COALESCE(a.duration_minutes, 30) + COALESCE(a.buffer_minutes, 0)) || ' minutes')::interval)::time > p_time
          )
    ) INTO v_has_conflict;

    IF v_has_conflict THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'O horário selecionado acabou de ser ocupado. Por favor, escolha outro horário.',
            'code', 'SLOT_OCCUPIED'
        );
    END IF;

    -- 5. Upsert atômico do Cliente
    INSERT INTO public.clients (name, phone, updated_at)
    VALUES (trim(p_client_name), v_clean_phone, now())
    ON CONFLICT (phone) DO UPDATE
    SET name = EXCLUDED.name, updated_at = now()
    RETURNING id INTO v_client_id;

    -- 6. Inserir agendamentos por serviço de forma sequencial
    v_current_start := p_time;

    FOREACH v_service_elem IN ARRAY v_target_service_ids LOOP
        SELECT
            s.name,
            COALESCE(bs.custom_duration_minutes, s.duration_minutes, s.default_duration_minutes, 30),
            COALESCE(bs.custom_price, s.price, 0.00)
        INTO
            v_item_name,
            v_item_duration,
            v_item_price
        FROM public.services s
        LEFT JOIN public.barber_services bs ON bs.service_id = s.id AND bs.barber_id = p_barber_id
        WHERE s.id = v_service_elem;

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
            v_service_elem,
            v_client_id,
            trim(p_client_name),
            v_clean_phone,
            v_item_name,
            p_date,
            v_current_start,
            COALESCE(v_item_duration, 30),
            COALESCE(p_buffer_minutes, 10),
            'confirmado',
            'pendente',
            COALESCE(v_item_price, 0.00),
            COALESCE(v_item_price, 0.00),
            COALESCE(p_notes, 'Agendamento via WhatsApp Chatbot'),
            'chatbot',
            'chatbot',
            now(),
            now()
        ) RETURNING id INTO v_new_id;

        v_created_ids := array_append(v_created_ids, v_new_id);

        v_current_start := (v_current_start + (COALESCE(v_item_duration, 30) || ' minutes')::interval)::time;
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
-- 3. SOBRECARGAS RETROCOMPATÍVEIS (chatbot_create_appointments)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chatbot_create_appointments(
    p_appointment_at timestamptz,
    p_barber_id uuid,
    p_client_name text,
    p_client_phone text,
    p_service_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.chatbot_create_appointment(
        p_client_name => p_client_name,
        p_client_phone => p_client_phone,
        p_barber_id => p_barber_id,
        p_service_id => NULL,
        p_service_ids => p_service_ids,
        p_date => (p_appointment_at AT TIME ZONE 'America/Fortaleza')::date,
        p_time => (p_appointment_at AT TIME ZONE 'America/Fortaleza')::time,
        p_duration_minutes => 30,
        p_buffer_minutes => 10,
        p_notes => 'Agendamento via Chatbot'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.chatbot_create_appointments(
    p_barber_id uuid,
    p_service_ids uuid[],
    p_client_name text,
    p_client_phone text,
    p_date date,
    p_time time,
    p_notes text DEFAULT 'Agendamento via Chatbot'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.chatbot_create_appointment(
        p_client_name => p_client_name,
        p_client_phone => p_client_phone,
        p_barber_id => p_barber_id,
        p_service_id => NULL,
        p_service_ids => p_service_ids,
        p_date => p_date,
        p_time => p_time,
        p_duration_minutes => 30,
        p_buffer_minutes => 10,
        p_notes => p_notes
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. RPCs AUXILIARES DE CONSULTA E CANCELAMENTO (chatbot_booked_times, etc.)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chatbot_booked_times(
    p_barber_id uuid,
    p_date date
)
RETURNS TABLE (booked_time text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT to_char(appointment_time, 'HH24:MI') as booked_time
    FROM public.appointments
    WHERE barber_id = p_barber_id
      AND appointment_date = p_date
      AND status IN ('confirmed', 'confirmado', 'pending', 'pendente', 'completed', 'concluido', 'concluído', 'bloqueado', 'blocked', 'pre_scheduled')
    ORDER BY appointment_time ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.chatbot_list_appointments(
    p_phone text
)
RETURNS TABLE (
    id uuid,
    barber_id uuid,
    barber_name text,
    service_id uuid,
    service_name text,
    appointment_date date,
    appointment_time time,
    status text,
    notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
    RETURN QUERY
    SELECT
        a.id,
        a.barber_id,
        b.name AS barber_name,
        a.service_id,
        COALESCE(s.name, a.service, 'Serviço Personalizado') AS service_name,
        a.appointment_date,
        a.appointment_time,
        a.status,
        a.notes
    FROM public.appointments a
    LEFT JOIN public.barbers b ON b.id = a.barber_id
    LEFT JOIN public.services s ON s.id = a.service_id
    WHERE a.client_phone = v_clean
      AND a.status IN ('confirmed', 'confirmado', 'pending', 'pendente', 'pre_scheduled')
      AND a.appointment_date >= (timezone('America/Fortaleza', now()))::date
    ORDER BY a.appointment_date ASC, a.appointment_time ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.chatbot_cancel_appointments(
    p_ids uuid[],
    p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    v_affected integer;
BEGIN
    UPDATE public.appointments
    SET status = 'cancelado', cancelled_at = now(), updated_at = now()
    WHERE id = ANY(p_ids)
      AND client_phone = v_clean
      AND status IN ('confirmed', 'confirmado', 'pending', 'pendente', 'pre_scheduled');

    GET DIAGNOSTICS v_affected = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', (v_affected > 0),
        'affected_rows', v_affected
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. FUNÇÃO RPC DO PAINEL DO BARBEIRO: register_payment_atomic
-- Liquida o atendimento, calcula a comissão exata do barbeiro e atualiza o caixa
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_payment_atomic(
    p_appointment_id uuid,
    p_barber_id uuid,
    p_payment_method varchar,
    p_amount numeric,
    p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_raw_rate numeric;
    v_multiplier numeric;
    v_commission_amount numeric;
BEGIN
    SELECT COALESCE(commission_percent, commission_rate, 50.00)
    INTO v_raw_rate
    FROM public.barbers
    WHERE id = p_barber_id;

    IF v_raw_rate IS NULL OR v_raw_rate <= 0 THEN
        v_multiplier := 0.50;
    ELSIF v_raw_rate <= 1 THEN
        v_multiplier := v_raw_rate;
    ELSE
        v_multiplier := v_raw_rate / 100.0;
    END IF;

    v_commission_amount := ROUND((p_amount * v_multiplier), 2);

    UPDATE public.appointments
    SET
        payment_status = 'pago',
        status = 'concluido',
        payment_method = p_payment_method,
        paid_at = now(),
        price = p_amount,
        total_price = p_amount,
        barber_commission_amount = v_commission_amount,
        notes = COALESCE(p_description, notes),
        updated_at = now()
    WHERE id = p_appointment_id;

    RETURN jsonb_build_object(
        'success', true,
        'commission_amount', v_commission_amount,
        'paid_amount', p_amount
    );
END;
$$;
