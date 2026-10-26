-- ==============================================================================
-- MIGRAÇÃO 01: EXTENSÕES ESSENCIAIS E LIMPEZA SEGURA (COLD-START SAFE)
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/01_extensions_and_cleanup.sql
-- ==============================================================================

SET client_min_messages TO warning;

-- ------------------------------------------------------------------------------
-- 1. EXTENSÕES ESSENCIAIS DO POSTGRESQL
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. REMOÇÃO SEGURA DE TRIGGERS ANTERIORES (RESILIENTE A BANCO 100% VAZIO)
-- Em PostgreSQL, DROP TRIGGER falha se a tabela ainda não existir. O bloco DO
-- garante execução limpa tanto em banco recém-resetado quanto em banco populado.
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    DROP TRIGGER IF EXISTS trg_update_clients_timestamp ON public.clients CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP TRIGGER IF EXISTS trg_update_chat_sessions_timestamp ON public.chat_sessions CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP TRIGGER IF EXISTS trg_update_appointments_timestamp ON public.appointments CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP TRIGGER IF EXISTS trg_sync_barbers_columns ON public.barbers CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP TRIGGER IF EXISTS trg_sync_services_columns ON public.services CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP TRIGGER IF EXISTS trg_sync_schedules_columns ON public.barber_schedules CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
    DROP TRIGGER IF EXISTS trg_sync_appointments_columns ON public.appointments CASCADE;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ------------------------------------------------------------------------------
-- 3. REMOÇÃO DE FUNÇÕES RPC ANTIGAS E ASSINATURAS CONFLITANTES
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(uuid, date, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(uuid, uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_get_available_slots(text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_create_appointment(text, text, uuid, uuid, uuid[], date, time, integer, integer, text) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_create_appointment(text, text, uuid, uuid, date, time, integer, integer, text) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_create_appointments(timestamptz, uuid, text, text, uuid[]) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_create_appointments(uuid, uuid[], text, text, date, time, text) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_create_appointments(text, text, uuid, uuid[], date, time, text) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_booked_times(uuid, date) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_list_appointments(text) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_cancel_appointments(uuid[], text) CASCADE;
DROP FUNCTION IF EXISTS public.chatbot_reschedule_appointments(uuid[], text, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.register_payment_atomic(uuid, uuid, varchar, numeric, text) CASCADE;
DROP FUNCTION IF EXISTS public.register_payment_atomic(uuid, uuid, varchar, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

-- ------------------------------------------------------------------------------
-- 4. REMOÇÃO DEFINITIVA DE TABELAS OBSOLETAS (INCLUINDO WAITLIST E OVERRIDES)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS public.waitlist CASCADE;
DROP TABLE IF EXISTS public.barber_schedule_overrides CASCADE;
DROP TABLE IF EXISTS public.barber_recovery_codes CASCADE;
DROP TABLE IF EXISTS public.barber_recovery_state CASCADE;
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.chat_sessions CASCADE;
DROP TABLE IF EXISTS public.barber_exceptions CASCADE;
DROP TABLE IF EXISTS public.barber_leaves CASCADE;
DROP TABLE IF EXISTS public.blocked_dates CASCADE;
