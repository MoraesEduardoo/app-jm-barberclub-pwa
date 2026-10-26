-- ==============================================================================
-- ARQUIVO 10: 010_indexes_and_rls.sql
-- Sistema: JM Barberclub (Chatbot + Painel do Barbeiro)
-- Descrição: Índices de alta performance para cálculo dinâmico de horários
--            e políticas de segurança de linha (Row Level Security - RLS).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ÍNDICES DE ALTA PERFORMANCE
-- ------------------------------------------------------------------------------

-- Appointments: Consulta primária do Chatbot e Painel da Agenda
CREATE INDEX IF NOT EXISTS idx_appointments_date_barber_status 
    ON public.appointments(appointment_date, barber_id, status);

CREATE INDEX IF NOT EXISTS idx_appointments_client_phone 
    ON public.appointments(client_phone);

CREATE INDEX IF NOT EXISTS idx_appointments_time_range 
    ON public.appointments(appointment_date, appointment_time, end_time);

CREATE INDEX IF NOT EXISTS idx_appointments_end_time_compat 
    ON public.appointments(appointment_date, appointment_time, appointment_end_time);

CREATE INDEX IF NOT EXISTS idx_appointments_pre_scheduled 
    ON public.appointments(appointment_date, is_pre_scheduled);

CREATE INDEX IF NOT EXISTS idx_appointments_client_id 
    ON public.appointments(client_id);

-- Jornada e Folgas: Consulta crítica para fatiamento de slots do Chatbot
CREATE INDEX IF NOT EXISTS idx_barber_schedules_lookup 
    ON public.barber_schedules(barber_id, day_of_week, is_working_day);

CREATE INDEX IF NOT EXISTS idx_barber_exceptions_lookup 
    ON public.barber_exceptions(barber_id, exception_date);

CREATE INDEX IF NOT EXISTS idx_barber_services_lookup 
    ON public.barber_services(barber_id, service_id, is_active);

-- Catálogo e Equipe: Carregamento do Menu e Galeria
CREATE INDEX IF NOT EXISTS idx_services_active_order 
    ON public.services(active, display_order);

CREATE INDEX IF NOT EXISTS idx_services_barber_id 
    ON public.services(barber_id);

CREATE INDEX IF NOT EXISTS idx_haircut_gallery_active 
    ON public.haircut_gallery(is_active, category);

-- Fila de Espera, Lembretes e Push
CREATE INDEX IF NOT EXISTS idx_waitlist_lookup 
    ON public.waitlist(preferred_date, barber_id, status);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_status 
    ON public.reminder_logs(scheduled_for, status);

CREATE INDEX IF NOT EXISTS idx_followup_logs_status 
    ON public.followup_logs(scheduled_for, status);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_barber 
    ON public.push_subscriptions(barber_id);

-- ------------------------------------------------------------------------------
-- 2. HABILITAÇÃO DO ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haircut_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. POLÍTICAS DE SEGURANÇA (POLICIES)
-- ------------------------------------------------------------------------------

-- A. SERVIÇOS, EQUIPE, GALERIA E EXPEDIENTE (Leitura Pública para o Chatbot e Painel)
DROP POLICY IF EXISTS "Permitir leitura publica de barbers" ON public.barbers;
CREATE POLICY "Permitir leitura publica de barbers" 
    ON public.barbers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir escrita de barbers para autenticados" ON public.barbers;
CREATE POLICY "Permitir escrita de barbers para autenticados" 
    ON public.barbers FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura publica de services" ON public.services;
CREATE POLICY "Permitir leitura publica de services" 
    ON public.services FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir escrita de services para autenticados" ON public.services;
CREATE POLICY "Permitir escrita de services para autenticados" 
    ON public.services FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura publica de barber_services" ON public.barber_services;
CREATE POLICY "Permitir leitura publica de barber_services" 
    ON public.barber_services FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir escrita de barber_services para autenticados" ON public.barber_services;
CREATE POLICY "Permitir escrita de barber_services para autenticados" 
    ON public.barber_services FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura publica de barber_schedules" ON public.barber_schedules;
CREATE POLICY "Permitir leitura publica de barber_schedules" 
    ON public.barber_schedules FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir escrita de barber_schedules para autenticados" ON public.barber_schedules;
CREATE POLICY "Permitir escrita de barber_schedules para autenticados" 
    ON public.barber_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura publica de barber_exceptions" ON public.barber_exceptions;
CREATE POLICY "Permitir leitura publica de barber_exceptions" 
    ON public.barber_exceptions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir escrita de barber_exceptions para autenticados" ON public.barber_exceptions;
CREATE POLICY "Permitir escrita de barber_exceptions para autenticados" 
    ON public.barber_exceptions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura publica de haircut_gallery" ON public.haircut_gallery;
CREATE POLICY "Permitir leitura publica de haircut_gallery" 
    ON public.haircut_gallery FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir escrita de haircut_gallery para autenticados" ON public.haircut_gallery;
CREATE POLICY "Permitir escrita de haircut_gallery para autenticados" 
    ON public.haircut_gallery FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- B. CLIENTES E AGENDAMENTOS (Inserção via Chatbot e Gestão pelo Painel)
DROP POLICY IF EXISTS "Permitir leitura de clientes" ON public.clients;
CREATE POLICY "Permitir leitura de clientes" 
    ON public.clients FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir criacao de clientes publica e autenticada" ON public.clients;
CREATE POLICY "Permitir criacao de clientes publica e autenticada" 
    ON public.clients FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir atualizacao de clientes para autenticados" ON public.clients;
CREATE POLICY "Permitir atualizacao de clientes para autenticados" 
    ON public.clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura de agendamentos" ON public.appointments;
CREATE POLICY "Permitir leitura de agendamentos" 
    ON public.appointments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir criacao de agendamentos via chatbot" ON public.appointments;
CREATE POLICY "Permitir criacao de agendamentos via chatbot" 
    ON public.appointments FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir gestao total de agendamentos para autenticados" ON public.appointments;
CREATE POLICY "Permitir gestao total de agendamentos para autenticados" 
    ON public.appointments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- C. FILA DE ESPERA (waitlist)
DROP POLICY IF EXISTS "Permitir criacao publica de waitlist" ON public.waitlist;
CREATE POLICY "Permitir criacao publica de waitlist" 
    ON public.waitlist FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura de waitlist para autenticados" ON public.waitlist;
CREATE POLICY "Permitir leitura de waitlist para autenticados" 
    ON public.waitlist FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Permitir atualizacao de waitlist para autenticados" ON public.waitlist;
CREATE POLICY "Permitir atualizacao de waitlist para autenticados" 
    ON public.waitlist FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- D. PUSH SUBSCRIPTIONS E SEGURANÇA INTERNA
DROP POLICY IF EXISTS "Permitir insercao de push subscription" ON public.push_subscriptions;
CREATE POLICY "Permitir insercao de push subscription" 
    ON public.push_subscriptions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir gestao de push para autenticados" ON public.push_subscriptions;
CREATE POLICY "Permitir gestao de push para autenticados" 
    ON public.push_subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acesso estrito de admin_users para autenticados" ON public.admin_users;
CREATE POLICY "Acesso estrito de admin_users para autenticados" 
    ON public.admin_users FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acesso estrito de reminder_logs para autenticados" ON public.reminder_logs;
CREATE POLICY "Acesso estrito de reminder_logs para autenticados" 
    ON public.reminder_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acesso estrito de followup_logs para autenticados" ON public.followup_logs;
CREATE POLICY "Acesso estrito de followup_logs para autenticados" 
    ON public.followup_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
