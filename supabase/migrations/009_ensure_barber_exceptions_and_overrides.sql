-- ==============================================================================
-- MIGRAÇÃO 009: GARANTIA DE BARBER_EXCEPTIONS E COMPATIBILIDADE COM OVERRIDES
-- Sistema: JM Barberclub (Painel do Barbeiro e Gestão de Barbearia)
-- Arquivo: supabase/migrations/009_ensure_barber_exceptions_and_overrides.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA PRINCIPAL DE FOLGAS E BLOQUEIOS: barber_exceptions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.barber_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barber_id UUID NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
    exception_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    is_available BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Adiciona colunas se a tabela foi criada anteriormente de forma simplificada
ALTER TABLE public.barber_exceptions ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.barber_exceptions ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE public.barber_exceptions ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE public.barber_exceptions ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.barber_exceptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Garante constraint UNIQUE (barber_id, exception_date) para permitir upserts atômicos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'barber_exceptions_barber_date_unique' 
          AND table_name = 'barber_exceptions'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'barber_exceptions_barber_id_exception_date_key' 
          AND table_name = 'barber_exceptions'
    ) THEN
        ALTER TABLE public.barber_exceptions 
            ADD CONSTRAINT barber_exceptions_barber_date_unique UNIQUE (barber_id, exception_date);
    END IF;
END $$;

-- Índices de consulta rápida de datas bloqueadas por barbeiro
CREATE INDEX IF NOT EXISTS idx_barber_exceptions_lookup 
    ON public.barber_exceptions(barber_id, exception_date);

-- Políticas RLS: Acesso total para o sistema
ALTER TABLE public.barber_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permissao total barber_exceptions" ON public.barber_exceptions;
CREATE POLICY "Permissao total barber_exceptions" 
    ON public.barber_exceptions FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 2. VIEW DE COMPATIBILIDADE: barber_schedule_overrides
-- Elimina de forma definitiva o erro "Could not find table 'barber_schedule_overrides' in schema cache"
-- e roteia transparentemente qualquer leitura/escrita para 'barber_exceptions'.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.barber_schedule_overrides AS
SELECT 
    id,
    barber_id,
    exception_date AS override_date,
    (NOT is_available) AS is_day_off,
    start_time,
    end_time,
    reason,
    created_at
FROM public.barber_exceptions;

-- Função de gatilho INSTEAD OF para permitir INSERT, UPDATE e DELETE na View
CREATE OR REPLACE FUNCTION public.trg_fn_barber_schedule_overrides_io()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        DELETE FROM public.barber_exceptions WHERE id = OLD.id;
        RETURN OLD;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO public.barber_exceptions (
            id,
            barber_id,
            exception_date,
            start_time,
            end_time,
            is_available,
            reason
        ) VALUES (
            COALESCE(NEW.id, gen_random_uuid()),
            NEW.barber_id,
            COALESCE(NEW.override_date, CURRENT_DATE),
            NEW.start_time,
            NEW.end_time,
            NOT COALESCE(NEW.is_day_off, TRUE),
            NEW.reason
        )
        ON CONFLICT (barber_id, exception_date) 
        DO UPDATE SET 
            is_available = EXCLUDED.is_available,
            reason = EXCLUDED.reason,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time;
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        UPDATE public.barber_exceptions
        SET 
            exception_date = COALESCE(NEW.override_date, exception_date),
            start_time = NEW.start_time,
            end_time = NEW.end_time,
            is_available = NOT COALESCE(NEW.is_day_off, TRUE),
            reason = NEW.reason
        WHERE id = OLD.id;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_barber_schedule_overrides_io ON public.barber_schedule_overrides;
CREATE TRIGGER trg_barber_schedule_overrides_io
    INSTEAD OF INSERT OR UPDATE OR DELETE ON public.barber_schedule_overrides
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_barber_schedule_overrides_io();

COMMENT ON TABLE public.barber_exceptions IS 'Bloqueios pontuais, folgas e feriados por barbeiro.';
COMMENT ON VIEW public.barber_schedule_overrides IS 'View de compatibilidade legada apontando para barber_exceptions.';
