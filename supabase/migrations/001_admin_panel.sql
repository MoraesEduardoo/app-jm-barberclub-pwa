-- Migração aditiva para o Painel do Barbeiro (JM Barberclub)
-- Baseada no schema real já em uso (barbers, services, appointments,
-- barber_schedules, barber_exceptions, cash_flow, barber_services,
-- clients, client_feedbacks). NÃO recria nenhuma tabela existente.
--
-- A única coisa que faltava no banco para o painel funcionar é a coluna
-- de permissões por barbeiro (a hierarquia chefe/equipe usa role + active,
-- que já existem — só as permissões granulares são novas).

-- 1) barbers: permissões concedidas pelo chefe a cada barbeiro da equipe
alter table barbers add column if not exists permissions jsonb not null default '{}'::jsonb;

-- 2) barber_schedules: upsert por dia da semana precisa de uma linha única
--    por barbeiro/dia (day_of_week é texto — ex.: 'segunda', 'terca'...).
create unique index if not exists barber_schedules_barber_day_unique
  on barber_schedules (barber_id, day_of_week);

-- Nada mais precisa ser alterado: appointments já tem payment_method e
-- payment_status; cash_flow já tem appointment_id, amount, payment_method
-- e type; barber_exceptions já tem exception_date e reason; services já
-- tem default_duration_minutes e active.
