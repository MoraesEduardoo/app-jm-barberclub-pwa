-- Migração aditiva: Web Push (Disparo de Notificações Push).
--
-- Esta era a peça que faltava no banco: as rotas /api/push/subscribe e
-- /api/push/send já existiam no código e faziam upsert/select em
-- "push_subscriptions", mas a tabela nunca foi criada — então todo
-- salvamento de inscrição falhava silenciosamente e nunca havia
-- destinatário na hora de disparar.
--
-- Não altera nenhuma tabela existente.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references barbers (id) on delete cascade,

  -- endpoint é a chave natural de uma inscrição push (uma por
  -- navegador/dispositivo). Único para permitir o upsert
  -- onConflict: 'endpoint' feito em /api/push/subscribe — reinscrever o
  -- mesmo aparelho atualiza a linha em vez de duplicar.
  endpoint text not null unique,

  -- Chaves de criptografia geradas pelo navegador (subscription.keys).
  p256dh text not null,
  auth text not null,

  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Busca mais frequente: "todas as inscrições do barbeiro X" na hora de
-- disparar a notificação de novo agendamento.
create index if not exists push_subscriptions_barber_id_idx
  on push_subscriptions (barber_id);

-- Mantém updated_at coerente quando o mesmo endpoint é reinscrito.
create or replace function set_push_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists push_subscriptions_set_updated_at on push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on push_subscriptions
  for each row
  execute function set_push_subscriptions_updated_at();

-- RLS ligada e SEM policy para anon/authenticated de propósito: as
-- inscrições só são lidas e gravadas pelo servidor (service role, que
-- ignora RLS). Nada no navegador precisa tocar nesta tabela — o browser
-- fala com /api/push/subscribe, não com o Supabase direto.
alter table push_subscriptions enable row level security;
