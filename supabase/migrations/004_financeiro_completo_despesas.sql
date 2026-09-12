-- Migração aditiva: suporte a despesas no financeiro completo do chefe.
-- cash_flow já era usado só para lançar ENTRADAS (type = 'income', vinculadas
-- a um appointment). Agora reaproveitamos a mesma tabela para lançar SAÍDAS
-- (type = 'expense'), sem appointment_id, com categoria e data própria do
-- gasto — não recria nem remove nenhuma tabela existente.

-- 1) Categoria da despesa (aluguel, produtos, contas, manutenção, etc.).
--    Nula para linhas antigas de 'income', que não têm categoria.
alter table cash_flow add column if not exists category text;

-- 2) Data em que a despesa efetivamente ocorreu — separada de created_at
--    (quando o registro foi lançado no sistema), pra permitir lançar uma
--    despesa em atraso sem distorcer o histórico de auditoria.
alter table cash_flow add column if not exists occurred_at timestamptz not null default now();

-- 3) appointment_id só existe para 'income'; garante que despesas (sem
--    agendamento associado) podem ser inseridas normalmente.
alter table cash_flow alter column appointment_id drop not null;

-- 4) Índice para listar despesas por período rapidamente na tela exclusiva
--    do chefe (/admin/financeiro/completo).
create index if not exists cash_flow_type_occurred_at_idx on cash_flow (type, occurred_at desc);
