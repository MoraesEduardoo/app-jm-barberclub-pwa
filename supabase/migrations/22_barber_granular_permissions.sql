-- =============================================================================
-- 22_barber_granular_permissions.sql
-- Permissões granulares por membro da equipe em public.barbers (JSONB)
-- Mantém compatibilidade total com chaves legadas e com a regra de caixa individual.
-- =============================================================================

-- 1. Garante que a coluna `permissions` (JSONB) exista na tabela `public.barbers`
--    com valores padrão seguros (todos os privilégios administrativos desativados).
ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{
    "view_all_schedules": false,
    "view_global_finance": false,
    "manage_services": false,
    "manage_schedule_blocks": false,
    "manage_crowded_mode": false,
    "manage_team": false,
    "view_all_appointments": false,
    "manage_finance": false,
    "manage_schedule_others": false
  }'::jsonb;

-- Atualiza o DEFAULT da coluna para novos registros
ALTER TABLE public.barbers
  ALTER COLUMN permissions SET DEFAULT '{
    "view_all_schedules": false,
    "view_global_finance": false,
    "manage_services": false,
    "manage_schedule_blocks": false,
    "manage_crowded_mode": false,
    "manage_team": false,
    "view_all_appointments": false,
    "manage_finance": false,
    "manage_schedule_others": false
  }'::jsonb;

-- 2. Backfill idempotente dos membros já cadastrados preservando metadados
--    existentes (como specialties, service_commission_percent, product_commission_percent, pix_key)
--    e respeitando valores booleanos já configurados manualmente.

-- 2a) Chefe / Admin: recebe todas as permissões ativas por padrão (mantendo customizações existentes)
UPDATE public.barbers
SET permissions =
  COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'view_all_schedules', COALESCE((permissions->>'view_all_schedules')::boolean, (permissions->>'view_all_appointments')::boolean, true),
    'view_global_finance', COALESCE((permissions->>'view_global_finance')::boolean, (permissions->>'manage_finance')::boolean, true),
    'manage_services', COALESCE((permissions->>'manage_services')::boolean, true),
    'manage_schedule_blocks', COALESCE((permissions->>'manage_schedule_blocks')::boolean, (permissions->>'manage_schedule_others')::boolean, true),
    'manage_crowded_mode', COALESCE((permissions->>'manage_crowded_mode')::boolean, true),
    'manage_team', COALESCE((permissions->>'manage_team')::boolean, true),
    'view_all_appointments', COALESCE((permissions->>'view_all_schedules')::boolean, (permissions->>'view_all_appointments')::boolean, true),
    'manage_finance', COALESCE((permissions->>'view_global_finance')::boolean, (permissions->>'manage_finance')::boolean, true),
    'manage_schedule_others', COALESCE((permissions->>'manage_schedule_blocks')::boolean, (permissions->>'manage_schedule_others')::boolean, true)
  ),
  updated_at = now()
WHERE role = 'admin';

-- 2b) Gerente: visão da agenda da equipe, serviços, expediente/bloqueios e Modo Lotado ativos;
--     faturamento global (view_global_finance) e gestão de equipe (manage_team) desativados por padrão.
UPDATE public.barbers
SET permissions =
  COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'view_all_schedules', COALESCE((permissions->>'view_all_schedules')::boolean, (permissions->>'view_all_appointments')::boolean, true),
    'view_global_finance', COALESCE((permissions->>'view_global_finance')::boolean, (permissions->>'manage_finance')::boolean, false),
    'manage_services', COALESCE((permissions->>'manage_services')::boolean, true),
    'manage_schedule_blocks', COALESCE((permissions->>'manage_schedule_blocks')::boolean, (permissions->>'manage_schedule_others')::boolean, true),
    'manage_crowded_mode', COALESCE((permissions->>'manage_crowded_mode')::boolean, true),
    'manage_team', COALESCE((permissions->>'manage_team')::boolean, false),
    'view_all_appointments', COALESCE((permissions->>'view_all_schedules')::boolean, (permissions->>'view_all_appointments')::boolean, true),
    'manage_finance', COALESCE((permissions->>'view_global_finance')::boolean, (permissions->>'manage_finance')::boolean, false),
    'manage_schedule_others', COALESCE((permissions->>'manage_schedule_blocks')::boolean, (permissions->>'manage_schedule_others')::boolean, true)
  ),
  updated_at = now()
WHERE role = 'manager';

-- 2c) Barbeiro padrão: agenda própria e caixa individual preservados; permissões elevadas em false por padrão.
UPDATE public.barbers
SET permissions =
  COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'view_all_schedules', COALESCE((permissions->>'view_all_schedules')::boolean, (permissions->>'view_all_appointments')::boolean, false),
    'view_global_finance', COALESCE((permissions->>'view_global_finance')::boolean, (permissions->>'manage_finance')::boolean, false),
    'manage_services', COALESCE((permissions->>'manage_services')::boolean, false),
    'manage_schedule_blocks', COALESCE((permissions->>'manage_schedule_blocks')::boolean, (permissions->>'manage_schedule_others')::boolean, false),
    'manage_crowded_mode', COALESCE((permissions->>'manage_crowded_mode')::boolean, false),
    'manage_team', COALESCE((permissions->>'manage_team')::boolean, false),
    'view_all_appointments', COALESCE((permissions->>'view_all_schedules')::boolean, (permissions->>'view_all_appointments')::boolean, false),
    'manage_finance', COALESCE((permissions->>'view_global_finance')::boolean, (permissions->>'manage_finance')::boolean, false),
    'manage_schedule_others', COALESCE((permissions->>'manage_schedule_blocks')::boolean, (permissions->>'manage_schedule_others')::boolean, false)
  ),
  updated_at = now()
WHERE role NOT IN ('admin', 'manager') OR role IS NULL;
