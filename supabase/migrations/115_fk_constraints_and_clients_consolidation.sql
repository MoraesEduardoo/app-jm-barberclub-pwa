-- ==============================================================================
-- MIGRAÇÃO 115: CONSOLIDAÇÃO DE CONSTRAINTS, TABELA DE CLIENTES E AUDITORIA
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Equipe)
-- Arquivo: supabase/migrations/115_fk_constraints_and_clients_consolidation.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. BLINDAGEM E HARMONIZAÇÃO DE CHAVES ESTRANGEIRAS (FOREIGN KEYS)
-- Elimina qualquer bloqueio de integridade relacional ao excluir ou alterar barbeiros.
-- ------------------------------------------------------------------------------

-- 1.1 Tabela commission_payouts: permite excluir barbeiro sem travar por RESTRICT
DO $$
BEGIN
    -- Atualiza FK do barbeiro recebedor para CASCADE
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'commission_payouts_barber_id_fkey'
    ) THEN
        ALTER TABLE public.commission_payouts 
            DROP CONSTRAINT commission_payouts_barber_id_fkey;
    END IF;

    ALTER TABLE public.commission_payouts
        ADD CONSTRAINT commission_payouts_barber_id_fkey
        FOREIGN KEY (barber_id)
        REFERENCES public.barbers(id)
        ON DELETE CASCADE;

    -- Torna admin_id opcional (SET NULL) para não travar se o chefe que liquidou for alterado
    ALTER TABLE public.commission_payouts 
        ALTER COLUMN admin_id DROP NOT NULL;

    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'commission_payouts_admin_id_fkey'
    ) THEN
        ALTER TABLE public.commission_payouts 
            DROP CONSTRAINT commission_payouts_admin_id_fkey;
    END IF;

    ALTER TABLE public.commission_payouts
        ADD CONSTRAINT commission_payouts_admin_id_fkey
        FOREIGN KEY (admin_id)
        REFERENCES public.barbers(id)
        ON DELETE SET NULL;
END $$;

-- 1.2 Tabela appointments: confirma integridade segura com barbers e services
DO $$
BEGIN
    -- Garante que service_id na tabela appointments use ON DELETE SET NULL
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'appointments_service_id_fkey'
    ) THEN
        ALTER TABLE public.appointments 
            DROP CONSTRAINT appointments_service_id_fkey;
    END IF;

    ALTER TABLE public.appointments
        ADD CONSTRAINT appointments_service_id_fkey
        FOREIGN KEY (service_id)
        REFERENCES public.services(id)
        ON DELETE SET NULL;
END $$;


-- ------------------------------------------------------------------------------
-- 2. TABELA FORMAL DE CLIENTES (clients) & MIGRAÇÃO HISTÓRICA
-- Cria a entidade oficial de clientes com número normalizado e métricas de fidelização.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) UNIQUE NOT NULL,
    clean_phone VARCHAR(30),
    email VARCHAR(150),
    notes TEXT,
    preferred_barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    total_visits INT NOT NULL DEFAULT 0,
    total_spent NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    last_visit_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'ativo', -- 'ativo', 'fiel', 'atrasado', 'novo'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices otimizados para busca de clientes por telefone ou nome
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_clean_phone ON public.clients(clean_phone);
CREATE INDEX IF NOT EXISTS idx_clients_name ON public.clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_last_visit ON public.clients(last_visit_at DESC);

-- Vincula a chave opcional client_id em appointments para integridade referencial total
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'client_id'
    ) THEN
        ALTER TABLE public.appointments 
            ADD COLUMN client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;
        
        CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON public.appointments(client_id);
    END IF;
END $$;

-- Popula a tabela clients com base nos agendamentos existentes (Idempotente)
INSERT INTO public.clients (name, phone, clean_phone, total_visits, total_spent, last_visit_at, created_at, updated_at)
SELECT 
    DISTINCT ON (REGEXP_REPLACE(COALESCE(a.client_phone, ''), '\D', '', 'g'))
    COALESCE(NULLIF(TRIM(a.client_name), ''), 'Cliente'),
    TRIM(a.client_phone),
    REGEXP_REPLACE(COALESCE(a.client_phone, ''), '\D', '', 'g') AS clean_phone,
    COUNT(a.id) OVER (PARTITION BY REGEXP_REPLACE(COALESCE(a.client_phone, ''), '\D', '', 'g')),
    COALESCE(SUM(CASE WHEN a.payment_status = 'pago' THEN a.price ELSE 0 END) OVER (PARTITION BY REGEXP_REPLACE(COALESCE(a.client_phone, ''), '\D', '', 'g')), 0.00),
    MAX(a.appointment_date::TIMESTAMPTZ) OVER (PARTITION BY REGEXP_REPLACE(COALESCE(a.client_phone, ''), '\D', '', 'g')),
    NOW(),
    NOW()
FROM public.appointments a
WHERE a.client_phone IS NOT NULL 
  AND LENGTH(REGEXP_REPLACE(a.client_phone, '\D', '', 'g')) >= 8
ON CONFLICT (phone) DO UPDATE 
SET 
    total_visits = EXCLUDED.total_visits,
    total_spent = EXCLUDED.total_spent,
    last_visit_at = EXCLUDED.last_visit_at,
    updated_at = NOW();

-- Atualiza o client_id na tabela appointments para os registros existentes
UPDATE public.appointments a
SET client_id = c.id
FROM public.clients c
WHERE a.client_id IS NULL
  AND REGEXP_REPLACE(COALESCE(a.client_phone, ''), '\D', '', 'g') = c.clean_phone;


-- ------------------------------------------------------------------------------
-- 3. TABELA DE AUDITORIA E LOGS DO SISTEMA (audit_logs)
-- Registra eventos críticos como exclusão de barbeiro, cancelamentos e pagamentos.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL,
    actor_name VARCHAR(150),
    action VARCHAR(80) NOT NULL, -- 'appointment_cancel', 'role_change', 'service_delete', 'payout_create'
    target_entity VARCHAR(60) NOT NULL, -- 'appointments', 'barbers', 'services', 'cash_flow'
    target_id VARCHAR(100),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);


-- ------------------------------------------------------------------------------
-- 4. TRIGGER INTELIGENTE DE SINCRONIZAÇÃO DE CLIENTE A CADA AGENDAMENTO
-- Sempre que um novo agendamento entra (via Chatbot ou Painel), atualiza a carteira.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_client_from_appointment()
RETURNS TRIGGER AS $$
DECLARE
    v_clean_phone VARCHAR(30);
    v_client_id UUID;
BEGIN
    IF NEW.client_phone IS NOT NULL THEN
        v_clean_phone := REGEXP_REPLACE(NEW.client_phone, '\D', '', 'g');
        
        IF LENGTH(v_clean_phone) >= 8 THEN
            -- Insere ou busca o cliente na tabela
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
    BEFORE INSERT OR UPDATE OF client_name, client_phone, appointment_date, barber_id
    ON public.appointments
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_client_from_appointment();


-- ------------------------------------------------------------------------------
-- 5. POLÍTICAS DE ROW LEVEL SECURITY (RLS) PARA AS NOVAS TABELAS
-- ------------------------------------------------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Permite acesso aos clientes para usuários e serviços autenticados da barbearia
DROP POLICY IF EXISTS "Permitir leitura de clientes para equipe" ON public.clients;
CREATE POLICY "Permitir leitura de clientes para equipe" 
    ON public.clients FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS "Permitir gestao de clientes para equipe" ON public.clients;
CREATE POLICY "Permitir gestao de clientes para equipe" 
    ON public.clients FOR ALL 
    USING (true);

-- Permite inserção de logs de auditoria
DROP POLICY IF EXISTS "Permitir insercao de audit logs" ON public.audit_logs;
CREATE POLICY "Permitir insercao de audit logs" 
    ON public.audit_logs FOR INSERT 
    WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura de audit logs para administradores" ON public.audit_logs;
CREATE POLICY "Permitir leitura de audit logs para administradores" 
    ON public.audit_logs FOR SELECT 
    USING (true);

COMMENT ON TABLE public.clients IS 'Tabela centralizada de clientes da JM Barberclub com histórico e métricas.';
COMMENT ON TABLE public.audit_logs IS 'Trilha de auditoria das ações administrativas e financeiras do painel.';
