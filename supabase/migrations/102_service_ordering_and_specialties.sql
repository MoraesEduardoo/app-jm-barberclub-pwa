-- ==============================================================================
-- MIGRAÇÃO 102: ORDENAÇÃO DE SERVIÇOS, CATEGORIAS E ESPECIALIDADES DA EQUIPE
-- Sistema: JM Barberclub (Painel do Barbeiro)
-- Arquivo: supabase/migrations/102_service_ordering_and_specialties.sql
-- ==============================================================================

-- 1. Tabela de Serviços (services)
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
    default_duration_minutes INT NOT NULL DEFAULT 30 CHECK (default_duration_minutes > 0),
    active BOOLEAN NOT NULL DEFAULT true,
    display_order INT NOT NULL DEFAULT 0,
    category TEXT DEFAULT 'cabelo' CHECK (category IN ('cabelo', 'barba', 'combo', 'quimica', 'estetica', 'outros')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Assegurar colunas em caso de migração incremental
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'cabelo';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS default_duration_minutes INT DEFAULT 30;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now());

-- 3. Índices para ordenação e consulta rápida no catálogo
CREATE INDEX IF NOT EXISTS idx_services_active_display ON public.services(active, display_order, name);
CREATE INDEX IF NOT EXISTS idx_services_category ON public.services(category, display_order);

-- 4. Tabela Relacional de Especialidades dos Barbeiros (barber_services)
-- Define quais serviços cada barbeiro executa (permite filtrar a grade por especialidade)
CREATE TABLE IF NOT EXISTS public.barber_services (
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
    custom_duration_minutes INT, -- Sobrescreve duração padrão se o profissional for mais ágil/lento
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (barber_id, service_id)
);

-- 5. Índices de junção e pesquisa
CREATE INDEX IF NOT EXISTS idx_barber_services_service_id ON public.barber_services(service_id);
CREATE INDEX IF NOT EXISTS idx_barber_services_barber_id ON public.barber_services(barber_id);

-- 6. Trigger para atualização de updated_at em services
DROP TRIGGER IF EXISTS trg_services_updated_at ON public.services;
CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON public.services
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at_timestamp();

COMMENT ON TABLE public.services IS 'Catálogo oficial de serviços e procedimentos da barbearia.';
COMMENT ON COLUMN public.services.display_order IS 'Posição de ordenação do serviço na listagem administrativa e no chatbot.';
COMMENT ON TABLE public.barber_services IS 'Tabela associativa de especialidades dos barbeiros. ON DELETE RESTRICT em services protege o histórico.';
