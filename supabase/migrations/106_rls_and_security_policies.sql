-- ==============================================================================
-- MIGRAÇÃO 106: ROW LEVEL SECURITY (RLS) E POLÍTICAS DE ACESSO DO PAINEL
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestor)
-- Arquivo: supabase/migrations/106_rls_and_security_policies.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FUNÇÕES AUXILIARES DE SEGURANÇA (SECURITY DEFINER)
-- Permitem checagem rápida do perfil autenticado sem expor a tabela auth.users.
-- ------------------------------------------------------------------------------

-- Verifica se o usuário autenticado atual é um barbeiro ativo no sistema
CREATE OR REPLACE FUNCTION is_active_barber()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM barbers 
        WHERE auth_user_id = auth.uid() 
          AND active = TRUE
    );
END;
$$;

-- Verifica se o usuário autenticado atual possui privilégio de gestor/admin (Chefe)
CREATE OR REPLACE FUNCTION is_admin_chefe()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM barbers 
        WHERE auth_user_id = auth.uid() 
          AND role = 'admin' 
          AND active = TRUE
    );
END;
$$;

-- Retorna o ID interno do barbeiro autenticado
CREATE OR REPLACE FUNCTION current_barber_id()
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    v_id UUID;
BEGIN
    SELECT id INTO v_id 
    FROM barbers 
    WHERE auth_user_id = auth.uid() 
      AND active = TRUE
    LIMIT 1;
    RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. HABILITAÇÃO DE ROW LEVEL SECURITY EM TODAS AS TABELAS
-- ------------------------------------------------------------------------------
ALTER TABLE barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_recovery_state ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. POLÍTICAS: BARBERS
-- Público lê barbeiros ativos. Modificação apenas por Admins ou pelo próprio perfil.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "barbers_select_policy" ON barbers;
CREATE POLICY "barbers_select_policy" ON barbers
    FOR SELECT USING (active = TRUE OR is_active_barber());

DROP POLICY IF EXISTS "barbers_insert_policy" ON barbers;
CREATE POLICY "barbers_insert_policy" ON barbers
    FOR INSERT WITH CHECK (is_admin_chefe());

DROP POLICY IF EXISTS "barbers_update_policy" ON barbers;
CREATE POLICY "barbers_update_policy" ON barbers
    FOR UPDATE USING (is_admin_chefe() OR auth_user_id = auth.uid());

DROP POLICY IF EXISTS "barbers_delete_policy" ON barbers;
CREATE POLICY "barbers_delete_policy" ON barbers
    FOR DELETE USING (is_admin_chefe());

-- ------------------------------------------------------------------------------
-- 4. POLÍTICAS: SERVICES E ESPECIALIDADES
-- Leitura pública para agendamento. Modificação restrita a Admins.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "services_select_policy" ON services;
CREATE POLICY "services_select_policy" ON services
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "services_modify_policy" ON services;
CREATE POLICY "services_modify_policy" ON services
    FOR ALL USING (is_admin_chefe());

DROP POLICY IF EXISTS "barber_services_select_policy" ON barber_services;
CREATE POLICY "barber_services_select_policy" ON barber_services
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "barber_services_modify_policy" ON barber_services;
CREATE POLICY "barber_services_modify_policy" ON barber_services
    FOR ALL USING (is_admin_chefe() OR barber_id = current_barber_id());

-- ------------------------------------------------------------------------------
-- 5. POLÍTICAS: EXPEDIENTE E EXCEÇÕES (SCHEDULES)
-- Leitura pública para o motor de busca de horários livres.
-- Modificação por Administrador ou pelo próprio Barbeiro.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "schedules_select_policy" ON barber_schedules;
CREATE POLICY "schedules_select_policy" ON barber_schedules
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "schedules_modify_policy" ON barber_schedules;
CREATE POLICY "schedules_modify_policy" ON barber_schedules
    FOR ALL USING (is_admin_chefe() OR barber_id = current_barber_id());

DROP POLICY IF EXISTS "overrides_select_policy" ON barber_schedule_overrides;
CREATE POLICY "overrides_select_policy" ON barber_schedule_overrides
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "overrides_modify_policy" ON barber_schedule_overrides;
CREATE POLICY "overrides_modify_policy" ON barber_schedule_overrides
    FOR ALL USING (is_admin_chefe() OR barber_id = current_barber_id());

-- ------------------------------------------------------------------------------
-- 6. POLÍTICAS: AGENDAMENTOS (APPOINTMENTS)
-- Inserção permitida para agendamentos de clientes.
-- Barbeiro enxerga e edita seus próprios agendamentos; Admin tem visão irrestrita.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "appointments_select_policy" ON appointments;
CREATE POLICY "appointments_select_policy" ON appointments
    FOR SELECT USING (
        is_admin_chefe() 
        OR barber_id = current_barber_id()
        OR auth.role() = 'service_role'
        OR auth.role() = 'anon' -- Anon pode verificar disponibilidade de slots
    );

DROP POLICY IF EXISTS "appointments_insert_policy" ON appointments;
CREATE POLICY "appointments_insert_policy" ON appointments
    FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "appointments_update_policy" ON appointments;
CREATE POLICY "appointments_update_policy" ON appointments
    FOR UPDATE USING (
        is_admin_chefe() 
        OR barber_id = current_barber_id()
        OR auth.role() = 'service_role'
    );

DROP POLICY IF EXISTS "appointments_delete_policy" ON appointments;
CREATE POLICY "appointments_delete_policy" ON appointments
    FOR DELETE USING (is_admin_chefe());

-- ------------------------------------------------------------------------------
-- 7. POLÍTICAS: LISTA DE ESPERA (WAITLIST)
-- Leitura e gestão por barbeiros e gestor. Inserção aberta para interessados.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "waitlist_select_policy" ON waitlist;
CREATE POLICY "waitlist_select_policy" ON waitlist
    FOR SELECT USING (is_active_barber() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "waitlist_insert_policy" ON waitlist;
CREATE POLICY "waitlist_insert_policy" ON waitlist
    FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "waitlist_update_policy" ON waitlist;
CREATE POLICY "waitlist_update_policy" ON waitlist
    FOR UPDATE USING (is_active_barber() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "waitlist_delete_policy" ON waitlist;
CREATE POLICY "waitlist_delete_policy" ON waitlist
    FOR DELETE USING (is_active_barber() OR auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 8. POLÍTICAS: FLUXO DE CAIXA E DESPESAS (CASH_FLOW)
-- Acesso estrito e exclusivo do Chefe (Admin) e service_role. Barbeiros comuns não acessam.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "cash_flow_admin_policy" ON cash_flow;
CREATE POLICY "cash_flow_admin_policy" ON cash_flow
    FOR ALL USING (is_admin_chefe() OR auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 9. POLÍTICAS: CONFIGURAÇÕES E FEEDBACKS
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "business_settings_select_policy" ON business_settings;
CREATE POLICY "business_settings_select_policy" ON business_settings
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "business_settings_modify_policy" ON business_settings;
CREATE POLICY "business_settings_modify_policy" ON business_settings
    FOR ALL USING (is_admin_chefe() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "client_feedbacks_select_policy" ON client_feedbacks;
CREATE POLICY "client_feedbacks_select_policy" ON client_feedbacks
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "client_feedbacks_insert_policy" ON client_feedbacks;
CREATE POLICY "client_feedbacks_insert_policy" ON client_feedbacks
    FOR INSERT WITH CHECK (TRUE);

DROP POLICY IF EXISTS "client_feedbacks_delete_policy" ON client_feedbacks;
CREATE POLICY "client_feedbacks_delete_policy" ON client_feedbacks
    FOR DELETE USING (is_admin_chefe() OR auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- 10. POLÍTICAS: WEB PUSH E RECUPERAÇÃO DE ACESSO
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "push_subscriptions_policy" ON push_subscriptions;
CREATE POLICY "push_subscriptions_policy" ON push_subscriptions
    FOR ALL USING (
        barber_id = current_barber_id() 
        OR is_admin_chefe() 
        OR auth.role() = 'service_role'
    );

-- Códigos de recuperação e rate limit: restritos estritamente ao service_role
-- para que nenhum cliente HTTP anônimo consiga injetar ou ler hashes de senha
DROP POLICY IF EXISTS "recovery_codes_service_policy" ON barber_recovery_codes;
CREATE POLICY "recovery_codes_service_policy" ON barber_recovery_codes
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "recovery_state_service_policy" ON barber_recovery_state;
CREATE POLICY "recovery_state_service_policy" ON barber_recovery_state
    FOR ALL USING (auth.role() = 'service_role');
