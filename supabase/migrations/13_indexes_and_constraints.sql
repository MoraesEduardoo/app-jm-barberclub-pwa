-- =============================================================================
-- 13_indexes_and_constraints.sql
-- Índices de performance e prevenção de conflito de horário (anti-double booking)
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_no_double_booking
  ON public.appointments (barber_id, appointment_date, appointment_time)
  WHERE status NOT IN ('cancelado', 'canceled')
    AND COALESCE(is_pre_schedule, false) = false;

CREATE INDEX IF NOT EXISTS idx_appointments_date_barber
  ON public.appointments (appointment_date, barber_id);
