-- ==============================================================================
-- MIGRAÇÃO 114: SUPORTE A PRÉ-AGENDAMENTOS FUTUROS (PRE-SCHEDULED / CHATBOT)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/114_pre_scheduled_appointments.sql
-- ==============================================================================

-- 1. ADICIONA COLUNAS DE IDENTIFICAÇÃO DE PRÉ-AGENDAMENTO E ORIGEM
ALTER TABLE public.appointments 
    ADD COLUMN IF NOT EXISTS is_pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.appointments 
    ADD COLUMN IF NOT EXISTS pre_scheduled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.appointments 
    ADD COLUMN IF NOT EXISTS origin VARCHAR(50) DEFAULT 'direct';

-- 2. ATUALIZA AGENDAMENTOS EXISTENTES VINDOS DE PRÉ-AGENDAMENTO OU COM STATUS PRE_SCHEDULED
UPDATE public.appointments
SET 
    is_pre_scheduled = TRUE,
    pre_scheduled = TRUE,
    origin = 'pre_schedule'
WHERE 
    status IN ('pre_scheduled', 'pre_agendado', 'pre-agendado')
    OR notes ILIKE '%pré-agendad%'
    OR notes ILIKE '%pre_scheduled%'
    OR notes ILIKE '%pré agendad%';

-- 3. ÍNDICES DE ALTA PERFORMANCE PARA BUSCA DE PRÉ-AGENDAMENTOS NA AGENDA
CREATE INDEX IF NOT EXISTS idx_appointments_pre_scheduled 
    ON public.appointments (appointment_date, is_pre_scheduled);

CREATE INDEX IF NOT EXISTS idx_appointments_origin 
    ON public.appointments (origin);

CREATE INDEX IF NOT EXISTS idx_appointments_status_date 
    ON public.appointments (status, appointment_date);

-- 4. COMENTÁRIOS EXPLICATIVOS
COMMENT ON COLUMN public.appointments.is_pre_scheduled IS 'Flag que identifica se o horário é um pré-agendamento recorrente vindo do chatbot.';
COMMENT ON COLUMN public.appointments.origin IS 'Canal de origem do agendamento (chatbot, pre_schedule, walk_in, painel).';
