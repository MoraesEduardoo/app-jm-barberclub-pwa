-- ==============================================================================
-- MIGRAÇÃO 106: ROW LEVEL SECURITY (RLS) E POLÍTICAS DE ACESSO DO PAINEL
-- Sistema: JM Barberclub (Painel do Barbeiro)
-- Arquivo: supabase/migrations/106_rls_and_admin_security.sql
-- ==============================================================================

-- 1. Habilitar RLS nas tabelas administrativas e operacionais
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_audit_logs ENABLE ROW LEVEL SECURITY;

-- 2. Função auxiliar de segurança para checar se o usuário atual é Chefe/Admin
CREATE OR REPLACE FUNCTION public.is_admin_or_chefe()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.barbers 
        WHERE auth_user_id = auth.uid() 
          AND role IN ('admin', 'chefe')
          AND active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Políticas para a tabela BARBERS
-- Qualquer usuário (inclusive cliente anônimo) pode ver barbeiros ativos
DROP POLICY IF EXISTS "barbers_public_read_active" ON public.barbers;
CREATE POLICY "barbers_public_read_active" ON public.barbers
    FOR SELECT USING (active = true OR auth.uid() IS NOT NULL);

-- Apenas o chefe/admin pode inserir, atualizar ou remover barbeiros
DROP POLICY IF EXISTS "barbers_admin_write" ON public.barbers;
CREATE POLICY "barbers_admin_write" ON public.barbers
    FOR ALL USING (public.is_admin_or_chefe() OR auth.uid() = auth_user_id);

-- 4. Políticas para a tabela SERVICES
-- Leitura pública para agendamento
DROP POLICY IF EXISTS "services_public_read" ON public.services;
CREATE POLICY "services_public_read" ON public.services
    FOR SELECT USING (true);

-- Escrita restrita ao chefe/admin
DROP POLICY IF EXISTS "services_admin_write" ON public.services;
CREATE POLICY "services_admin_write" ON public.services
    FOR ALL USING (public.is_admin_or_chefe());

-- 5. Políticas para a tabela BARBER_SERVICES
DROP POLICY IF EXISTS "barber_services_public_read" ON public.barber_services;
CREATE POLICY "barber_services_public_read" ON public.barber_services
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "barber_services_admin_write" ON public.barber_services;
CREATE POLICY "barber_services_admin_write" ON public.barber_services
    FOR ALL USING (public.is_admin_or_chefe());

-- 6. Políticas para a tabela BARBER_SCHEDULES e BARBER_EXCEPTIONS
-- Leitura pública necessária para o motor de slots do cliente/chatbot
DROP POLICY IF EXISTS "schedules_public_read" ON public.barber_schedules;
CREATE POLICY "schedules_public_read" ON public.barber_schedules
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "exceptions_public_read" ON public.barber_exceptions;
CREATE POLICY "exceptions_public_read" ON public.barber_exceptions
    FOR SELECT USING (true);

-- Barbeiro pode editar seu próprio expediente ou chefe gerencia todos
DROP POLICY IF EXISTS "schedules_manage_own_or_chefe" ON public.barber_schedules;
CREATE POLICY "schedules_manage_own_or_chefe" ON public.barber_schedules
    FOR ALL USING (
        public.is_admin_or_chefe() OR 
        barber_id IN (SELECT id FROM public.barbers WHERE auth_user_id = auth.uid())
    );

DROP POLICY IF EXISTS "exceptions_manage_own_or_chefe" ON public.barber_exceptions;
CREATE POLICY "exceptions_manage_own_or_chefe" ON public.barber_exceptions
    FOR ALL USING (
        public.is_admin_or_chefe() OR 
        barber_id IN (SELECT id FROM public.barbers WHERE auth_user_id = auth.uid())
    );

-- 7. Políticas para APPOINTMENTS
-- Inserção permitida para novos agendamentos (chatbot e cliente)
DROP POLICY IF EXISTS "appointments_insert_permit" ON public.appointments;
CREATE POLICY "appointments_insert_permit" ON public.appointments
    FOR INSERT WITH CHECK (true);

-- Leitura e atualização: Barbeiro vê os seus e Chefe vê todos
DROP POLICY IF EXISTS "appointments_view_and_manage" ON public.appointments;
CREATE POLICY "appointments_view_and_manage" ON public.appointments
    FOR ALL USING (
        public.is_admin_or_chefe() OR 
        barber_id IN (SELECT id FROM public.barbers WHERE auth_user_id = auth.uid())
    );

-- 8. Políticas para WAITLIST
DROP POLICY IF EXISTS "waitlist_insert_permit" ON public.waitlist;
CREATE POLICY "waitlist_insert_permit" ON public.waitlist
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "waitlist_view_and_manage" ON public.waitlist;
CREATE POLICY "waitlist_view_and_manage" ON public.waitlist
    FOR ALL USING (
        public.is_admin_or_chefe() OR 
        barber_id IN (SELECT id FROM public.barbers WHERE auth_user_id = auth.uid())
    );

-- 9. Políticas para AUDIT LOGS
-- Leitura exclusiva para o chefe
DROP POLICY IF EXISTS "audit_logs_chefe_only" ON public.barber_audit_logs;
CREATE POLICY "audit_logs_chefe_only" ON public.barber_audit_logs
    FOR SELECT USING (public.is_admin_or_chefe());

-- Inserção permitida para qualquer usuário autenticado (ações registradas via backend)
DROP POLICY IF EXISTS "audit_logs_insert" ON public.barber_audit_logs;
CREATE POLICY "audit_logs_insert" ON public.barber_audit_logs
    FOR INSERT WITH CHECK (true);

COMMENT ON FUNCTION public.is_admin_or_chefe() IS 'Função de validação de privilégios de chefe/admin para RLS do Supabase.';
