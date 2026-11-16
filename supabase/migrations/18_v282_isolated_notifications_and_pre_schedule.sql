-- =============================================================================
-- 18_v282_isolated_notifications_and_pre_schedule.sql
-- Isolamento de notificações por barbeiro (barber_id) e suporte a pré-agendamentos
-- =============================================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS barber_id UUID REFERENCES public.barbers(id) ON DELETE CASCADE;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_pre_schedule BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "notifications_isolated_by_barber" ON public.notifications;
CREATE POLICY "notifications_isolated_by_barber" ON public.notifications
  FOR SELECT TO authenticated
  USING (
    barber_id IN (
      SELECT id FROM public.barbers WHERE user_id = auth.uid()
    )
  );
