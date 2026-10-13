-- ==============================================================================
-- MIGRAÇÃO 104: INTEGRIDADE DE AGENDAMENTOS, HISTÓRICO E LISTA DE ESPERA (WAITLIST)
-- Sistema: JM Barberclub (Painel do Barbeiro)
-- Arquivo: supabase/migrations/104_appointments_integrity_and_waitlist.sql
-- ==============================================================================

-- 1. Tabela Principal de Agendamentos (appointments)
-- ON DELETE RESTRICT em barbers e services garante que nunca haja exclusão acidental
-- que destrua a contabilidade financeira ou o histórico operacional da barbearia.
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE RESTRICT,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
    client_name TEXT NOT NULL,
    client_phone TEXT NOT NULL,
    appointment_date TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' 
        CHECK (status IN ('pendente', 'confirmado', 'concluido', 'cancelado', 'nao_compareceu')),
    payment_method TEXT CHECK (payment_method IN ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'outro')),
    payment_status TEXT NOT NULL DEFAULT 'pendente' 
        CHECK (payment_status IN ('pendente', 'pago', 'estornado', 'cortesia')),
    notes TEXT,
    reference_photo_id UUID,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by TEXT, -- 'cliente', 'barbeiro', 'sistema'
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Assegurar colunas e constraints em bancos já existentes
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pendente';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reference_photo_id UUID;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

-- 3. Índices de alta performance indispensáveis para o painel
-- A: Agenda diária do barbeiro (utilizado centenas de vezes ao dia pelo painel e walk-in)
CREATE INDEX IF NOT EXISTS idx_appointments_agenda_lookup 
    ON public.appointments(barber_id, appointment_date, status);

-- B: Histórico do cliente por telefone (utilizado para cálculo de retorno e recorrência)
CREATE INDEX IF NOT EXISTS idx_appointments_client_history 
    ON public.appointments(client_phone, appointment_date DESC);

-- C: Filtro de status e data para relatórios e conciliação
CREATE INDEX IF NOT EXISTS idx_appointments_status_date 
    ON public.appointments(status, appointment_date DESC);

-- 4. Tabela de Lista de Espera (waitlist)
-- Registra clientes interessados em horários já ocupados, facilitando preenchimento
-- imediato caso ocorra um cancelamento na grade
CREATE TABLE IF NOT EXISTS public.waitlist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name TEXT NOT NULL,
    client_phone TEXT NOT NULL,
    desired_date DATE NOT NULL,
    desired_time TIME,
    barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'aguardando' 
        CHECK (status IN ('aguardando', 'notificado', 'agendado', 'expirado', 'cancelado')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. Índices para pesquisa eficiente na lista de espera
CREATE INDEX IF NOT EXISTS idx_waitlist_date_barber 
    ON public.waitlist(desired_date, barber_id, status);

CREATE INDEX IF NOT EXISTS idx_waitlist_phone 
    ON public.waitlist(client_phone, desired_date DESC);

-- 6. Trigger para atualização de updated_at
DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_waitlist_updated_at ON public.waitlist;
CREATE TRIGGER trg_waitlist_updated_at
    BEFORE UPDATE ON public.waitlist
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_timestamp();

COMMENT ON TABLE public.appointments IS 'Agendamentos da barbearia com integridade referencial protegida contra exclusões acidentais.';
COMMENT ON TABLE public.waitlist IS 'Fila de espera de clientes para datas e horários disputados ou em caso de cancelamentos.';
