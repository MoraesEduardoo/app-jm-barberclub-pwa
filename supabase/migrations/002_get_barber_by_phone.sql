-- Função de apoio ao login do painel: compara o telefone digitado com o
-- que está salvo em barbers.phone ignorando qualquer formatação
-- ((83) 99664-6306, 83 99664-6306, 83996646306 etc. todos batem).
--
-- SECURITY DEFINER: a função roda com o dono do banco, então continua
-- funcionando mesmo que a tabela "barbers" tenha RLS restrito pro público
-- (recomendado). Ela só devolve o único barbeiro que bate com o telefone
-- informado — nunca expõe a tabela inteira.
create or replace function get_barber_by_phone(phone_input text)
returns setof barbers
language sql
stable
security definer
set search_path = public
as $$
  select *
  from barbers
  where regexp_replace(phone, '\D', '', 'g') = regexp_replace(phone_input, '\D', '', 'g')
    and active = true
  limit 1;
$$;

-- Libera a execução da função para o cliente anônimo (o painel chama isso
-- antes de qualquer autenticação, na tela de login por telefone).
grant execute on function get_barber_by_phone(text) to anon, authenticated;
