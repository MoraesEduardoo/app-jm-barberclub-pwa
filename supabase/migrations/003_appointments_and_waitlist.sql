-- ==============================================================================
-- MIGRAÇÃO 003: TABELA CENTRAL DE AGENDAMENTOS E FILA DE ESPERA (WAITLIST)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Barbearia)
-- Arquivo: supabase/migrations/003_appointments_and_waitlist.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA PRINCIPAL DE AGENDAMENTOS (appointments)
-- Núcleo da agenda com suporte a pré-agendamento, walk-in e cascata blindada
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    service VARCHAR(150), -- Snapshot textual do serviço para histórico permanente
    client_name VARCHAR(150) NOT NULL,
    client_phone VARCHAR(30),
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    end_time TIME,
    duration_minutes INT NOT NULL DEFAULT 30,
    buffer_minutes INT NOT NULL DEFAULT 10,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'confirmado',
    payment_status VARCHAR(20) NOT NULL DEFAULT 'pendente', -- 'pendente', 'pago'
    payment_method VARCHAR(30), -- 'pix', 'dinheiro', 'cartao_credito', 'cartao_debito'
    barber_commission_amount NUMERIC(10, 2),
    is_walk_in BOOLEAN NOT NULL DEFAULT FALSE,
    is_pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
    pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
    origin VARCHAR(50) DEFAULT 'direct', -- 'chatbot', 'pre_schedule', 'walk_in', 'painel'
    reference_photo_id UUID, -- Chave estrangeira ligada à galeria
    commission_payout_id UUID, -- Chave estrangeira ligada aos fechamentos
    cancelled_at TIMESTAMPTZ,
    cancelled_by VARCHAR(50),
    cancellation_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices de Alta Performance para a Agenda
CREATE INDEX IF NOT EXISTS idx_appointments_date_barber 
    ON public.appointments(appointment_date, barber_id);

CREATE INDEX IF NOT EXISTS idx_appointments_status_date 
    ON public.appointments(status, appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointments_client_phone 
    ON public.appointments(client_phone);

CREATE INDEX IF NOT EXISTS idx_appointments_pre_scheduled 
    ON public.appointments(appointment_date, is_pre_scheduled);

CREATE INDEX IF NOT EXISTS idx_appointments_client_id 
    ON public.appointments(client_id);

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.appointments IS 'Tabela central de agendamentos diários, atendimentos presenciais e pré-agendamentos.';

-- ------------------------------------------------------------------------------
-- 2. TABELA DE FILA DE ESPERA (waitlist)
-- Acionada automaticamente quando um agendamento é cancelado para liberar horário
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

CREATE INDEX IF NOT EXISTS idx_waitlist_lookup 
    ON public.waitlist(preferred_date, barber_id, status);

DROP TRIGGER IF EXISTS trg_waitlist_updated_at ON public.waitlist;
CREATE TRIGGER trg_waitlist_updated_at
    BEFORE UPDATE ON public.waitlist
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.waitlist IS 'Fila de espera para notificação imediata em caso de desistências na agenda.';

-- ------------------------------------------------------------------------------
-- 3. GARANTIA DE COLUNAS DEFENSIVAS EM CLIENTS E APPOINTMENTS
-- ------------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS clean_phone VARCHAR(30);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS preferred_barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_visit_at TIMESTAMPTZ;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS appointment_end_time TIME;

-- ------------------------------------------------------------------------------
-- 4. TRIGGER DE SINCRONIZAÇÃO INTELIGENTE DE CLIENTES E HORÁRIOS
-- Mantém a tabela clients e campos de horário sempre sincronizados
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_client_from_appointment()
RETURNS TRIGGER AS $$
DECLARE
    v_clean_phone VARCHAR(30);
    v_client_id UUID;
BEGIN
    -- Sincroniza end_time e appointment_end_time mutuamente para blindar integrações
    NEW.end_time := COALESCE(NEW.end_time, NEW.appointment_end_time);
    NEW.appointment_end_time := COALESCE(NEW.appointment_end_time, NEW.end_time);

    IF NEW.client_phone IS NOT NULL THEN
        v_clean_phone := REGEXP_REPLACE(NEW.client_phone, '\D', '', 'g');
        
        IF LENGTH(v_clean_phone) >= 8 THEN
            INSERT INTO public.clients (name, phone, clean_phone, preferred_barber_id, last_visit_at, updated_at)
            VALUES (
                COALESCE(NULLIF(TRIM(NEW.client_name), ''), 'Cliente'),
                TRIM(NEW.client_phone),
                v_clean_phone,
                NEW.barber_id,
                NEW.appointment_date::TIMESTAMPTZ,
                NOW()
            )
            ON CONFLICT (phone) DO UPDATE 
            SET 
                name = CASE WHEN clients.name = 'Cliente' AND NEW.client_name IS NOT NULL THEN TRIM(NEW.client_name) ELSE clients.name END,
                clean_phone = EXCLUDED.clean_phone,
                last_visit_at = GREATEST(clients.last_visit_at, NEW.appointment_date::TIMESTAMPTZ),
                preferred_barber_id = COALESCE(NEW.barber_id, clients.preferred_barber_id),
                updated_at = NOW()
            RETURNING id INTO v_client_id;

            NEW.client_id := v_client_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_client_from_appointment ON public.appointments;
CREATE TRIGGER trg_sync_client_from_appointment
    BEFORE INSERT OR UPDATE OF client_name, client_phone, appointment_date, barber_id, end_time, appointment_end_time
    ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_client_from_appointment();
