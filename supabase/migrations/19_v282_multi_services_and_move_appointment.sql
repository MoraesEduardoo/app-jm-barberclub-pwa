-- =============================================================================
-- 19_v282_multi_services_and_move_appointment.sql
-- Suporte a múltiplos serviços (service_ids) e movimentação flexível na timeline
-- =============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS service_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time TIME,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30;
