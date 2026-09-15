-- OPCIONAL — só aplique se os agendamentos do site/chat público forem
-- gravados direto no Supabase, sem passar por este painel.
--
-- Cria um gatilho que, a cada INSERT em "appointments", chama
-- POST /api/push/appointment-created no painel, que por sua vez dispara o
-- push para o barbeiro e para o chefe.
--
-- Se o app público já chama a rota por conta própria (fetch com o header
-- x-push-secret), NÃO aplique este arquivo — senão o disparo acontece duas
-- vezes (a "tag" evita a notificação duplicada na tela, mas é envio à toa).
--
-- ANTES DE RODAR, troque:
--   <SUA-URL>     -> domínio do painel, ex.: https://berclub.vercel.app
--   <SEU-SEGREDO> -> o mesmo valor de PUSH_WEBHOOK_SECRET no .env / Vercel

create extension if not exists pg_net with schema extensions;

create or replace function notify_new_appointment_push()
returns trigger
language plpgsql
security definer
as $$
begin
  perform extensions.http_post(
    url := '<SUA-URL>/api/push/appointment-created',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', '<SEU-SEGREDO>'
    ),
    body := jsonb_build_object('appointmentId', new.id)
  );
  return new;
end;
$$;

drop trigger if exists appointments_push_on_insert on appointments;
create trigger appointments_push_on_insert
  after insert on appointments
  for each row
  execute function notify_new_appointment_push();

-- Alternativa sem SQL: Dashboard do Supabase > Database > Webhooks >
-- "Create a new hook", tabela "appointments", evento INSERT, method POST,
-- URL <SUA-URL>/api/push/appointment-created e header x-push-secret.
-- A rota já entende o formato de payload do webhook ({ type, record }).
