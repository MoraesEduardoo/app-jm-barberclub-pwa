-- ==============================================================================
-- MIGRAÇÃO 03: ÍNDICES DE ALTA PERFORMANCE (< 5MS)
-- Sistema: JM BarberClub (Next.js PWA + Chatbot + Painel do Barbeiro)
-- Arquivo: supabase/migrations/03_indexes.sql
-- ==============================================================================

-- 1. Índices de Agendamentos (Lookup instantâneo de agenda, colisões e cliente)
CREATE INDEX IF NOT EXISTS idx_appointments_lookup_active
ON public.appointments (barber_id, appointment_date, status, appointment_time);

CREATE INDEX IF NOT EXISTS idx_appointments_phone
ON public.appointments (client_phone, status);

CREATE INDEX IF NOT EXISTS idx_appointments_commission_payout
ON public.appointments (commission_payout_id);

CREATE INDEX IF NOT EXISTS idx_appointments_reference_photo
ON public.appointments (reference_photo_id);

-- 2. Índices de Escalas, Bloqueios, Folgas e Exceções
CREATE INDEX IF NOT EXISTS idx_barber_schedules_day
ON public.barber_schedules (barber_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_blocked_dates_date
ON public.blocked_dates (barber_id, date);

CREATE INDEX IF NOT EXISTS idx_barber_leaves_range
ON public.barber_leaves (barber_id, date, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_barber_exceptions_date
ON public.barber_exceptions (barber_id, exception_date);

-- 3. Índices de Catálogo, Equipe e Galeria
CREATE INDEX IF NOT EXISTS idx_services_display_order
ON public.services (display_order ASC, name ASC);

CREATE INDEX IF NOT EXISTS idx_gallery_active_category
ON public.haircut_gallery (is_active, category, display_order);

-- 4. Índices Financeiros e de Fechamento de Comissões
CREATE INDEX IF NOT EXISTS idx_commission_payouts_barber
ON public.commission_payouts (barber_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_commission_payouts_period
ON public.commission_payouts (period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_cash_flow_period
ON public.cash_flow (type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_flow_barber
ON public.cash_flow (barber_id);

-- 5. Índices de Sessões e Mensagens do Chatbot
CREATE INDEX IF NOT EXISTS idx_chat_sessions_phone
ON public.chat_sessions (phone, last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
ON public.chat_messages (session_id, created_at ASC);

-- 6. Índices de Push Notifications e Auditoria
CREATE INDEX IF NOT EXISTS idx_push_barber
ON public.push_subscriptions (barber_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created
ON public.audit_logs (created_at DESC);
