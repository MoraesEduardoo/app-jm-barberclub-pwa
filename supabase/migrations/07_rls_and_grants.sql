-- ==============================================================================
-- MIGRAÇÃO 07: SEGURANÇA (RLS), POLÍTICAS DE ACESSO, GRANTS E RELOAD DO POSTGREST
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/07_rls_and_grants.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ATIVAÇÃO DE ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS
-- ------------------------------------------------------------------------------
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haircut_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. POLÍTICAS DE LEITURA E GESTÃO (COMPATÍVEIS COM CHATBOT E PAINEL DO BARBEIRO)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE POLICY "Allow public read barbers" ON public.barbers FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage barbers" ON public.barbers FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public read services" ON public.services FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage services" ON public.services FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public read barber_services" ON public.barber_services FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage barber_services" ON public.barber_services FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public read barber_schedules" ON public.barber_schedules FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage barber_schedules" ON public.barber_schedules FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public read blocked_dates" ON public.blocked_dates FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage blocked_dates" ON public.blocked_dates FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public read barber_leaves" ON public.barber_leaves FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage barber_leaves" ON public.barber_leaves FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow public read barber_exceptions" ON public.barber_exceptions FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow admin manage barber_exceptions" ON public.barber_exceptions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all access clients" ON public.clients FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all access haircut_gallery" ON public.haircut_gallery FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all access commission_payouts" ON public.commission_payouts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all access appointments" ON public.appointments FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all access cash_flow" ON public.cash_flow FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all read chat_sessions" ON public.chat_sessions FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all write chat_sessions" ON public.chat_sessions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all read chat_messages" ON public.chat_messages FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all write chat_messages" ON public.chat_messages FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all access push_subscriptions" ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all access audit_logs" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------------------
-- 3. CONCESSÃO DE PRIVILÉGIOS (GRANTS PARA ANON, AUTHENTICATED E SERVICE_ROLE)
-- ------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON public.barbers TO anon, authenticated, service_role;
GRANT ALL ON public.services TO anon, authenticated, service_role;
GRANT ALL ON public.barber_services TO anon, authenticated, service_role;
GRANT ALL ON public.barber_schedules TO anon, authenticated, service_role;
GRANT ALL ON public.blocked_dates TO anon, authenticated, service_role;
GRANT ALL ON public.barber_leaves TO anon, authenticated, service_role;
GRANT ALL ON public.barber_exceptions TO anon, authenticated, service_role;
GRANT ALL ON public.clients TO anon, authenticated, service_role;
GRANT ALL ON public.haircut_gallery TO anon, authenticated, service_role;
GRANT ALL ON public.commission_payouts TO anon, authenticated, service_role;
GRANT ALL ON public.appointments TO anon, authenticated, service_role;
GRANT ALL ON public.cash_flow TO anon, authenticated, service_role;
GRANT ALL ON public.chat_sessions TO anon, authenticated, service_role;
GRANT ALL ON public.chat_messages TO anon, authenticated, service_role;
GRANT ALL ON public.push_subscriptions TO anon, authenticated, service_role;
GRANT ALL ON public.audit_logs TO anon, authenticated, service_role;

GRANT SELECT ON public.view_monthly_cash_flow TO anon, authenticated, service_role;
GRANT SELECT ON public.view_barber_performance TO anon, authenticated, service_role;

-- Grants de Execução nas Funções RPC
GRANT EXECUTE ON FUNCTION public.chatbot_get_available_slots(uuid, date, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointment(text, text, uuid, uuid, uuid[], date, time, integer, integer, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointments(timestamptz, uuid, text, text, uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_create_appointments(uuid, uuid[], text, text, date, time, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_booked_times(uuid, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_list_appointments(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chatbot_cancel_appointments(uuid[], text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_payment_atomic(uuid, uuid, varchar, numeric, text) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. RECARGA IMEDIATA DO SCHEMA CACHE DO POSTGREST
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
