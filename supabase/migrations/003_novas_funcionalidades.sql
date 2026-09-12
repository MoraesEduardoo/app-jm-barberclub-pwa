-- Migração aditiva: horário de almoço, comissão por barbeiro, foto de
-- perfil e agendamento walk-in. Não recria nem remove nenhuma tabela
-- existente — só adiciona colunas novas (todas com default seguro, então
-- não quebra nenhuma linha já gravada).

-- 1) barber_schedules: intervalo de almoço opcional por dia da semana.
--    has_lunch_break = false não bloqueia nada; quando true, o intervalo
--    [lunch_start, lunch_end) fica indisponível na agenda desse dia.
alter table barber_schedules add column if not exists has_lunch_break boolean not null default false;
alter table barber_schedules add column if not exists lunch_start time;
alter table barber_schedules add column if not exists lunch_end time;

-- 2) barbers: percentual de comissão (0 a 100) usado no painel financeiro.
--    Fica em 0 por padrão — só quem o chefe configurar terá cálculo de
--    comissão exibido.
alter table barbers add column if not exists commission_percent numeric(5,2) not null default 0
  check (commission_percent >= 0 and commission_percent <= 100);

-- 3) barbers: foto de perfil (URL pública do bucket "avatars").
alter table barbers add column if not exists avatar_url text;

-- 4) appointments: garante que a coluna usada pelo painel (is_walk_in)
--    realmente existe — cria só se ainda não tiver sido criada manualmente.
alter table appointments add column if not exists is_walk_in boolean not null default false;

-- 5) Bucket de storage para as fotos de perfil dos barbeiros.
--    Público para leitura (foto aparece no app sem autenticação);
--    escrita só é feita pelo servidor (service role), então não precisa
--    de policy de insert/update para anon/authenticated.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- 6) Notificações em tempo real (painel escuta INSERT/UPDATE em
--    "appointments" pelo Supabase Realtime, direto do navegador com a
--    chave anônima). Duas coisas são necessárias:
--
--    a) a tabela precisa estar na publicação "supabase_realtime";
--    b) se a tabela tiver RLS ativado, o Realtime só entrega a linha se a
--       policy de SELECT liberar o role "anon" — como o login do painel é
--       por telefone (não usa supabase auth), o navegador sempre se
--       conecta como anon. Se "appointments" já não tiver RLS ativado,
--       este bloco não muda nada na prática além de ligar o Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'appointments'
  ) then
    alter publication supabase_realtime add table appointments;
  end if;
end $$;

alter table appointments enable row level security;

drop policy if exists "appointments_read_for_notifications" on appointments;
create policy "appointments_read_for_notifications"
  on appointments for select
  to anon, authenticated
  using (true);
