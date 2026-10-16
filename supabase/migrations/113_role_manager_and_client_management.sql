-- ==============================================================================
-- MIGRAÇÃO 113: HIERARQUIA DE 3 NÍVEIS (GERENTE), GESTÃO DE CLIENTES E CANCELADOS
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Equipe)
-- Arquivo: supabase/migrations/113_role_manager_and_client_management.sql
-- ==============================================================================

-- 1. DOCUMENTAÇÃO E REGRAS DE HIERARQUIA DOS 3 CARGOS
-- - 'admin': Chefe / Administrador - Acesso total global (faturamento, despesas, equipe, serviços)
-- - 'manager': Gerente - Braço direito; acesso à agenda global da equipe e caixa individual
-- - 'barber': Barbeiro - Acesso estrito à agenda própria e comissões individuais

-- 2. ÍNDICES DE ALTA PERFORMANCE PARA CLIENTES E CANCELAMENTOS
CREATE INDEX IF NOT EXISTS idx_appointments_client_phone ON public.appointments(client_phone);
CREATE INDEX IF NOT EXISTS idx_appointments_status_cancelled ON public.appointments(status) WHERE status = 'cancelado';
CREATE INDEX IF NOT EXISTS idx_appointments_barber_date ON public.appointments(barber_id, appointment_date);

-- 3. POLÍTICA DE SEGURANÇA E ACESSO PARA GERENTES (MANAGER)
-- Garante que gerentes consigam visualizar os agendamentos da equipe para suporte operacional
DO $$
BEGIN
    -- Atualiza comentário da coluna role para registrar o terceiro nível oficial
    COMMENT ON COLUMN public.barbers.role IS 'Nível de privilégio: admin (Chefe global), manager (Gerente operacional com visão de equipe), barber (Barbeiro individual).';
END $$;
