-- ==============================================================================
-- ARQUIVO 12: 012_transactional_rpcs.sql
-- Sistema: JM Barberclub (Chatbot + Painel do Barbeiro)
-- Descrição: Stored Procedures / RPCs com isolamento transacional e locking
--            para cálculo dinâmico de slots em grade de 10 em 10 minutos,
--            duração exata do serviço e agendamento atômico anti-concorrência.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. GARANTIA DEFENSIVA DE COLUNAS DEPENDENTES NAS TABELAS DO ESQUEMA
-- ------------------------------------------------------------------------------
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS default_duration_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.barber_services ADD COLUMN IF NOT EXISTS custom_duration_minutes INTEGER;
ALTER TABLE public.barber_services ADD COLUMN IF NOT EXISTS custom_price NUMERIC(10, 2);
ALTER TABLE public.barber_services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS break_start_time TIME DEFAULT '12:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS break_end_time TIME DEFAULT '13:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS lunch_start TIME DEFAULT '12:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS lunch_end TIME DEFAULT '13:00:00';
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS is_working_day BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.barber_schedules ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.barber_exceptions ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.barber_exceptions ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE public.barber_exceptions ADD COLUMN IF NOT EXISTS end_time TIME;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS clean_phone VARCHAR(30);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS total_appointments INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_appointment_at TIMESTAMPTZ;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMPTZ;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS preferred_barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS appointment_end_time TIME;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS total_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS origin VARCHAR(50) NOT NULL DEFAULT 'chatbot';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS notes TEXT;

-- ------------------------------------------------------------------------------
-- 1. RPC: chatbot_get_available_slots
-- Limpeza de sobrecargas anteriores para evitar conflitos de assinatura
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(UUID, UUID, DATE);

CREATE OR REPLACE FUNCTION public.chatbot_get_available_slots(
    p_barber_id UUID,
    p_service_id UUID,
    p_date DATE
)
RETURNS TABLE (
    slot_time TIME,
    slot_end TIME,
    is_available BOOLEAN
) AS $$
DECLARE
    v_dow SMALLINT;
    v_work_start TIME;
    v_work_end TIME;
    v_lunch_start TIME;
    v_lunch_end TIME;
    v_is_working BOOLEAN;
    v_duration INT;
    v_curr_slot TIME;
    v_curr_end TIME;
    v_has_conflict BOOLEAN;
BEGIN
    -- 1. Determina o dia da semana (0=Domingo, 6=Sábado)
    v_dow := EXTRACT(DOW FROM p_date)::SMALLINT;

    -- 2. Busca duração exata do serviço (customizada do barbeiro ou padrão da tabela services)
    SELECT COALESCE(bs.custom_duration_minutes, s.default_duration_minutes, 30)
    INTO v_duration
    FROM public.services s
    LEFT JOIN public.barber_services bs 
        ON bs.service_id = s.id AND bs.barber_id = p_barber_id AND bs.is_active = TRUE
    WHERE s.id = p_service_id;

    IF v_duration IS NULL OR v_duration <= 0 THEN
        v_duration := 30;
    END IF;

    -- 3. Verifica jornada semanal padrão do barbeiro com suporte a ambos os esquemas de colunas
    SELECT 
        start_time, 
        end_time, 
        COALESCE(break_start_time, lunch_start), 
        COALESCE(break_end_time, lunch_end), 
        COALESCE(is_working_day, active, TRUE)
    INTO 
        v_work_start, v_work_end, v_lunch_start, v_lunch_end, v_is_working
    FROM public.barber_schedules
    WHERE barber_id = p_barber_id AND day_of_week = v_dow;

    -- Se não trabalha no dia da semana ou expediente não cadastrado, retorna vazio
    IF v_is_working IS NOT TRUE OR v_work_start IS NULL OR v_work_end IS NULL THEN
        RETURN;
    END IF;

    -- 4. Verifica se o dia inteiro está bloqueado em exceções/folgas
    IF EXISTS (
        SELECT 1 FROM public.barber_exceptions
        WHERE barber_id = p_barber_id 
          AND exception_date = p_date 
          AND is_available = FALSE
          AND (start_time IS NULL OR (start_time <= v_work_start AND end_time >= v_work_end))
    ) THEN
        RETURN;
    END IF;

    -- 5. Itera em grade de 10 em 10 minutos desde a abertura até o fechamento
    v_curr_slot := v_work_start;

    WHILE (v_curr_slot + (v_duration || ' minutes')::INTERVAL)::TIME <= v_work_end LOOP
        v_curr_end := (v_curr_slot + (v_duration || ' minutes')::INTERVAL)::TIME;
        v_has_conflict := FALSE;

        -- Checa conflito com intervalo de almoço
        IF v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
            IF v_curr_slot < v_lunch_end AND v_curr_end > v_lunch_start THEN
                v_has_conflict := TRUE;
            END IF;
        END IF;

        -- Checa conflito com exceções parciais (bloqueios de turno)
        IF NOT v_has_conflict AND EXISTS (
            SELECT 1 FROM public.barber_exceptions
            WHERE barber_id = p_barber_id 
              AND exception_date = p_date 
              AND is_available = FALSE
              AND start_time IS NOT NULL 
              AND end_time IS NOT NULL
              AND v_curr_slot < end_time 
              AND v_curr_end > start_time
        ) THEN
            v_has_conflict := TRUE;
        END IF;

        -- Checa conflito com agendamentos já confirmados/ativos
        -- Considera tanto end_time quanto appointment_end_time para retrocompatibilidade
        IF NOT v_has_conflict AND EXISTS (
            SELECT 1 FROM public.appointments
            WHERE barber_id = p_barber_id 
              AND appointment_date = p_date 
              AND status NOT IN ('cancelado')
              AND appointment_time < v_curr_end 
              AND COALESCE(end_time, appointment_end_time, (appointment_time + (duration_minutes || ' minutes')::INTERVAL)::TIME) > v_curr_slot
        ) THEN
            v_has_conflict := TRUE;
        END IF;

        -- Retorna o slot se estiver completamente livre
        IF NOT v_has_conflict THEN
            slot_time := v_curr_slot;
            slot_end := v_curr_end;
            is_available := TRUE;
            RETURN NEXT;
        END IF;

        -- Passo rigoroso de 10 em 10 minutos (regra de negócio JM BarberClub)
        v_curr_slot := (v_curr_slot + INTERVAL '10 minutes')::TIME;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 2. RPC: chatbot_create_appointment
-- Criação atômica com FOR UPDATE lock, preenchimento de end_time e appointment_end_time,
-- sincronização de cliente e integridade com a equipe.
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.chatbot_create_appointment(UUID, UUID, TEXT, TEXT, DATE, TIME, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.chatbot_create_appointments(UUID, UUID, TEXT, TEXT, DATE, TIME, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.chatbot_create_appointment(
    p_barber_id UUID,
    p_service_id UUID,
    p_client_name TEXT,
    p_client_phone TEXT,
    p_appointment_date DATE,
    p_appointment_time TIME,
    p_notes TEXT DEFAULT NULL,
    p_origin TEXT DEFAULT 'chatbot',
    p_is_pre_scheduled BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_clean_phone TEXT;
    v_barber_name TEXT;
    v_service_name TEXT;
    v_price NUMERIC(10, 2);
    v_duration INT;
    v_end_time TIME;
    v_dow SMALLINT;
    v_work_start TIME;
    v_work_end TIME;
    v_lunch_start TIME;
    v_lunch_end TIME;
    v_is_working BOOLEAN;
    v_client_id UUID;
    v_appointment_id UUID;
BEGIN
    -- 1. Higienização básica dos dados de entrada
    v_clean_phone := regexp_replace(COALESCE(p_client_phone, ''), '\D', '', 'g');
    IF length(v_clean_phone) < 8 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Número de telefone inválido.');
    END IF;

    IF trim(COALESCE(p_client_name, '')) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Nome do cliente é obrigatório.');
    END IF;

    -- 2. Validação do Barbeiro
    SELECT name INTO v_barber_name 
    FROM public.barbers 
    WHERE id = p_barber_id AND active = TRUE;

    IF v_barber_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Barbeiro selecionado não está ativo ou não foi encontrado.');
    END IF;

    -- 3. Validação do Serviço e Duração
    SELECT 
        s.name, 
        COALESCE(bs.custom_price, s.price),
        COALESCE(bs.custom_duration_minutes, s.default_duration_minutes, 30)
    INTO 
        v_service_name, v_price, v_duration
    FROM public.services s
    LEFT JOIN public.barber_services bs 
        ON bs.service_id = s.id AND bs.barber_id = p_barber_id AND bs.is_active = TRUE
    WHERE s.id = p_service_id AND s.active = TRUE;

    IF v_service_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Serviço selecionado não está disponível.');
    END IF;

    IF v_duration IS NULL OR v_duration <= 0 THEN
        v_duration := 30;
    END IF;

    -- 4. Cálculo do horário de término
    v_end_time := (p_appointment_time + (v_duration || ' minutes')::INTERVAL)::TIME;

    -- 5. Validação de Expediente Semanal (barber_schedules)
    v_dow := EXTRACT(DOW FROM p_appointment_date)::SMALLINT;

    SELECT 
        start_time, 
        end_time, 
        COALESCE(break_start_time, lunch_start), 
        COALESCE(break_end_time, lunch_end), 
        COALESCE(is_working_day, active, TRUE)
    INTO 
        v_work_start, v_work_end, v_lunch_start, v_lunch_end, v_is_working
    FROM public.barber_schedules
    WHERE barber_id = p_barber_id AND day_of_week = v_dow;

    IF v_is_working IS NOT TRUE OR v_work_start IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'O barbeiro não atende nesta data (dia de folga semanal).');
    END IF;

    IF p_appointment_time < v_work_start OR v_end_time > v_work_end THEN
        RETURN jsonb_build_object('success', false, 'error', 'Horário fora do expediente de atendimento do barbeiro.');
    END IF;

    -- Validação do intervalo de almoço
    IF v_lunch_start IS NOT NULL AND v_lunch_end IS NOT NULL THEN
        IF p_appointment_time < v_lunch_end AND v_end_time > v_lunch_start THEN
            RETURN jsonb_build_object('success', false, 'error', 'Horário coincide com o intervalo de almoço do profissional.');
        END IF;
    END IF;

    -- 6. Validação de Folgas e Bloqueios Especiais (barber_exceptions)
    IF EXISTS (
        SELECT 1 FROM public.barber_exceptions
        WHERE barber_id = p_barber_id 
          AND exception_date = p_appointment_date 
          AND is_available = FALSE
          AND (
              start_time IS NULL 
              OR (p_appointment_time < end_time AND v_end_time > start_time)
          )
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'O barbeiro possui um bloqueio de agenda ou folga programada neste horário.');
    END IF;

    -- 7. BLOQUEIO TRANSACIONAL CONTRA RACE CONDITION (FOR UPDATE LOCK)
    PERFORM id 
    FROM public.appointments
    WHERE barber_id = p_barber_id AND appointment_date = p_appointment_date
    FOR UPDATE;

    -- Checa se já existe algum agendamento no mesmo período
    IF EXISTS (
        SELECT 1 FROM public.appointments
        WHERE barber_id = p_barber_id 
          AND appointment_date = p_appointment_date 
          AND status NOT IN ('cancelado')
          AND appointment_time < v_end_time 
          AND COALESCE(end_time, appointment_end_time, (appointment_time + (duration_minutes || ' minutes')::INTERVAL)::TIME) > p_appointment_time
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Este horário acabou de ser reservado por outro cliente. Por favor, escolha outro.');
    END IF;

    -- 8. Sincronização Automática na Base de Clientes (clients)
    INSERT INTO public.clients (name, phone, clean_phone, total_appointments, last_appointment_at, last_visit_at, preferred_barber_id)
    VALUES (trim(p_client_name), v_clean_phone, v_clean_phone, 1, NOW(), NOW(), p_barber_id)
    ON CONFLICT (phone) DO UPDATE SET
        name = EXCLUDED.name,
        clean_phone = EXCLUDED.clean_phone,
        total_appointments = public.clients.total_appointments + 1,
        last_appointment_at = NOW(),
        last_visit_at = NOW(),
        preferred_barber_id = COALESCE(p_barber_id, public.clients.preferred_barber_id)
    RETURNING id INTO v_client_id;

    -- 9. Inserção Atômica do Agendamento (populando end_time E appointment_end_time)
    INSERT INTO public.appointments (
        barber_id,
        service_id,
        client_id,
        service,
        client_name,
        client_phone,
        appointment_date,
        appointment_time,
        end_time,
        appointment_end_time,
        duration_minutes,
        price,
        total_price,
        status,
        payment_status,
        is_pre_scheduled,
        pre_scheduled,
        origin,
        notes
    )
    VALUES (
        p_barber_id,
        p_service_id,
        v_client_id,
        v_service_name,
        trim(p_client_name),
        v_clean_phone,
        p_appointment_date,
        p_appointment_time,
        v_end_time,
        v_end_time,
        v_duration,
        v_price,
        v_price,
        CASE WHEN p_is_pre_scheduled THEN 'pre_scheduled' ELSE 'confirmado' END,
        'pendente',
        p_is_pre_scheduled,
        p_is_pre_scheduled,
        COALESCE(p_origin, 'chatbot'),
        p_notes
    )
    RETURNING id INTO v_appointment_id;

    -- 10. Retorno estruturado de sucesso
    RETURN jsonb_build_object(
        'success', true,
        'appointment_id', v_appointment_id,
        'client_id', v_client_id,
        'client_name', trim(p_client_name),
        'client_phone', v_clean_phone,
        'barber_name', v_barber_name,
        'service_name', v_service_name,
        'appointment_date', p_appointment_date,
        'appointment_time', p_appointment_time,
        'end_time', v_end_time,
        'appointment_end_time', v_end_time,
        'duration_minutes', v_duration,
        'price', v_price
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', 'Erro interno na transação de agendamento: ' || SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 3. ALIAS / WRAPPER PADRONIZADO: chatbot_create_appointments
-- Garante compatibilidade caso o cliente chame no plural ou singular
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chatbot_create_appointments(
    p_barber_id UUID,
    p_service_id UUID,
    p_client_name TEXT,
    p_client_phone TEXT,
    p_appointment_date DATE,
    p_appointment_time TIME,
    p_notes TEXT DEFAULT NULL,
    p_origin TEXT DEFAULT 'chatbot',
    p_is_pre_scheduled BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
BEGIN
    RETURN public.chatbot_create_appointment(
        p_barber_id,
        p_service_id,
        p_client_name,
        p_client_phone,
        p_appointment_date,
        p_appointment_time,
        p_notes,
        p_origin,
        p_is_pre_scheduled
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 4. CONCESSÃO DE PRIVILÉGIOS DE EXECUÇÃO
-- Permite que a API do Chatbot (anon/service_role) e o Painel executem as funções
-- ------------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.chatbot_get_available_slots(UUID, UUID, DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointment(UUID, UUID, TEXT, TEXT, DATE, TIME, TEXT, TEXT, BOOLEAN) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointments(UUID, UUID, TEXT, TEXT, DATE, TIME, TEXT, TEXT, BOOLEAN) TO anon, authenticated, service_role;
