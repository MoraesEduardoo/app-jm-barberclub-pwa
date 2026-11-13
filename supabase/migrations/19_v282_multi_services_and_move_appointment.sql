-- ==============================================================================
-- MIGRATION 19: MÚLTIPLA SELEÇÃO DE SERVIÇOS E REPOSICIONAMENTO DE HORÁRIOS (v2.8.2)
-- ==============================================================================
-- 1. Adiciona coluna `service_ids` (uuid[]) em `public.appointments` para persistir
--    múltiplos serviços selecionados num único atendimento (ex: Corte + Barba + Sobrancelha).
-- 2. Garante índice GIN para consultas rápidas por serviços contidos no agendamento.
-- ==============================================================================

DO $$ BEGIN
    ALTER TABLE public.appointments
    ADD COLUMN IF NOT EXISTS service_ids uuid[] DEFAULT NULL;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_service_ids_gin
ON public.appointments USING gin (service_ids)
WHERE service_ids IS NOT NULL;

-- Backfill seguro: preenche `service_ids` com `[service_id]` nos registos existentes que ainda estão nulos
UPDATE public.appointments
SET service_ids = ARRAY[service_id]
WHERE service_ids IS NULL AND service_id IS NOT NULL;
