-- Códigos de recuperação de senha (auto-atendimento do barbeiro).
-- Guardamos só o HASH (HMAC-SHA256) de cada código; o texto puro é mostrado uma única vez.
-- barber_id é text de propósito: funciona com barbers.id uuid ou bigint.

create table if not exists public.barber_recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  barber_id   text        not null,
  code_hash   text        not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (barber_id, code_hash)
);
create index if not exists barber_recovery_codes_barber_idx
  on public.barber_recovery_codes (barber_id) where used_at is null;

-- Controle de tentativas erradas (bloqueio temporário por barbeiro).
create table if not exists public.barber_recovery_state (
  barber_id        text primary key,
  failed_attempts  int         not null default 0,
  locked_until     timestamptz
);

-- RLS ligado e SEM policies + sem grants: só a service role (servidor) acessa.
alter table public.barber_recovery_codes enable row level security;
alter table public.barber_recovery_state enable row level security;
revoke all on public.barber_recovery_codes from anon, authenticated;
revoke all on public.barber_recovery_state from anon, authenticated;
