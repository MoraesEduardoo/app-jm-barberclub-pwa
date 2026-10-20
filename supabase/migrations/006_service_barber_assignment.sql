-- ==============================================================================
-- MIGRAÇÃO 006: ATRIBUIÇÃO DE SERVIÇOS POR BARBEIRO (GERAL OU ESPECÍFICO)
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Barbearia)
-- Arquivo: supabase/migrations/006_service_barber_assignment.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ADICIONAR COLUNA barber_id NA TABELA services
-- Permite que um serviço seja exclusivo de um barbeiro ou executado por todos (NULL)
-- ------------------------------------------------------------------------------
ALTER TABLE public.services 
    ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES public.barbers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.services.barber_id IS 
    'ID do barbeiro específico exclusivo deste serviço. Se NULL, o serviço pode ser executado por todos os barbeiros da equipe.';

CREATE INDEX IF NOT EXISTS idx_services_barber_id 
    ON public.services(barber_id);

-- ------------------------------------------------------------------------------
-- 2. GARANTIR INTEGRIDADE REFERENCIAL NA TABELA ASSOCIATIVA barber_services
-- Permite controle detalhado N:N caso barbeiros tenham preços ou durações customizadas
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    -- Atualizar Foreign Key com Barbers
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'barber_services_barber_id_fkey' 
          AND table_name = 'barber_services'
    ) THEN
        ALTER TABLE public.barber_services 
            DROP CONSTRAINT barber_services_barber_id_fkey;
    END IF;
    
    ALTER TABLE public.barber_services 
        ADD CONSTRAINT barber_services_barber_id_fkey 
        FOREIGN KEY (barber_id) REFERENCES public.barbers(id) 
        ON DELETE CASCADE;

    -- Atualizar Foreign Key com Services
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'barber_services_service_id_fkey' 
          AND table_name = 'barber_services'
    ) THEN
        ALTER TABLE public.barber_services 
            DROP CONSTRAINT barber_services_service_id_fkey;
    END IF;
    
    ALTER TABLE public.barber_services 
        ADD CONSTRAINT barber_services_service_id_fkey 
        FOREIGN KEY (service_id) REFERENCES public.services(id) 
        ON DELETE CASCADE;
END $$;

-- ------------------------------------------------------------------------------
-- 3. PERMISSÕES RLS DEFENSIVAS
-- Garante que o painel e o chatbot consigam ler serviços e tabelas associativas
-- ------------------------------------------------------------------------------
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir leitura publica de servicos" ON public.services;
CREATE POLICY "Permitir leitura publica de servicos" 
    ON public.services FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS "Permitir escrita de servicos para autenticados" ON public.services;
CREATE POLICY "Permitir escrita de servicos para autenticados" 
    ON public.services FOR ALL 
    TO authenticated 
    USING (true) 
    WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura publica de barber_services" ON public.barber_services;
CREATE POLICY "Permitir leitura publica de barber_services" 
    ON public.barber_services FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS "Permitir escrita de barber_services para autenticados" ON public.barber_services;
CREATE POLICY "Permitir escrita de barber_services para autenticados" 
    ON public.barber_services FOR ALL 
    TO authenticated 
    USING (true) 
    WITH CHECK (true);
