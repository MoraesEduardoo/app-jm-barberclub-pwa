# Painel do Barbeiro — JM Barberclub

Painel administrativo mobile-first (PWA), separado da parte pública de
agendamento, para a equipe da Barbearia do Matheus gerenciar o dia a dia.

Construído em cima do banco de dados **já existente** (tabelas `barbers`,
`services`, `appointments`, `barber_schedules`, `barber_exceptions`,
`barber_services`, `clients`, `client_feedbacks`, `cash_flow`) — sem recriar
nenhuma tabela.

## Como plugar no projeto existente

1. Copie as pastas `app/admin`, `components/admin` e `lib/` para o seu
   projeto Next.js (mesclando `lib/` se você já tiver arquivos lá).
2. Rode as migrações em `supabase/migrations/`, na ordem:
   - `001_admin_panel.sql` — adiciona a coluna `permissions` (jsonb) em
     `barbers` e um índice único em `barber_schedules`.
   - `002_get_barber_by_phone.sql` — cria a função `get_barber_by_phone`,
     usada no login: compara os dígitos do telefone digitado com os de
     `barbers.phone`, ignorando formatação (funciona com o telefone salvo
     como `"(83) 99664-6306"` ou só números).
3. Preencha `.env.local` com base no `.env.example`.
4. O login usa o **mesmo telefone** do fluxo público de agendamento. O
   painel agora tem sua própria tela de login por telefone
   (`components/admin/LoginScreen.jsx`): a pessoa digita o número, o painel
   busca em `barbers.phone` e libera o acesso se encontrar um registro ativo.

## ⚠️ Confirme o formato de `day_of_week`

A coluna `barber_schedules.day_of_week` é **texto**, não um número. Eu
assumi os valores `domingo, segunda, terca, quarta, quinta, sexta, sabado`
(minúsculo, sem acento) em `lib/actions/schedule.js` (array `WEEKDAYS`).
Se os dados já gravados no seu banco usarem outro formato (ex.: `"monday"`
ou `"1"`), é só trocar o campo `value` de cada item desse array — o resto
do código de Expediente não precisa mudar.

## Estrutura das telas (bottom nav)

- **Agenda** — lista os agendamentos do dia (filtra por `appointment_date`),
  confirma/cancela (`status`) e abre o registro de pagamento.
- **Serviços** — cria, edita preço/duração (`default_duration_minutes`) ou
  remove serviços.
- **Expediente** — liga/desliga cada dia da semana com horário
  (`barber_schedules.is_working`), e bloqueia datas pontuais em
  `barber_exceptions` (folgas, feriados).
- **Financeiro** — separa "quem pagou" de "quem não pagou" usando
  `appointments.payment_status`, com totais por período e por
  `payment_method` (Pix, cartão, dinheiro).
- **Equipe** — visível **apenas para o barbeiro chefe** (`role = 'admin'`):
  adicionar/remover barbeiros e ligar/desligar permissões individuais.

## Fluxo de pagamento

Ao confirmar um pagamento na Agenda, o painel faz duas coisas:

1. Atualiza `appointments.payment_status = 'pago'` e `payment_method`.
2. Insere uma linha em `cash_flow` (`type = 'entrada'`, `amount`,
   `payment_method`, `appointment_id`, `barber_id`) — esse valor é o que
   realmente foi cobrado (permite ajustar um desconto na hora, sem alterar
   o preço de tabela do serviço).

A tela Financeiro usa `services.price` como valor de referência de cada
agendamento (não existe uma coluna de "preço congelado" em `appointments`).

## Modelo de permissões

O barbeiro chefe (`role = 'admin'`) sempre tem acesso irrestrito. Os demais
barbeiros usam `role = 'barber'`. Para os
demais, o chefe concede, por barbeiro, quatro permissões independentes
(coluna nova `barbers.permissions`, jsonb):

| Chave                     | O que libera                                   |
|---------------------------|-------------------------------------------------|
| `manage_services`         | Editar serviços, preços e duração                |
| `manage_schedule_others`  | Editar o expediente de outros barbeiros          |
| `view_all_appointments`   | Ver a agenda de toda a equipe (não só a própria) |
| `manage_finance`          | Ver caixa e faturamento de todos, não só o seu   |

Por padrão, um barbeiro novo só vê e edita a própria agenda/expediente.

## Decisões e suposições assumidas

- `barbers.permissions` é a única coluna nova no banco; `role` (valores
  reais: `admin` para o chefe, `barber` para os demais) e `active` já
  existiam e foram reaproveitados como estavam.
- `appointments` não tem `client_id` — o nome/telefone do cliente vêm
  denormalizados em `client_name`/`client_phone`, como já estava modelado.
- Estilo aplicado exatamente como pedido: fundo `#000000`, cards
  `#09090b`/`#18181b`, texto branco e destaque em vermelho escarlate
  `#dc2626`, com bottom nav fixa e áreas de toque generosas (mín. 56px).
