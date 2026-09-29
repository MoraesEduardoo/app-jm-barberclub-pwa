'use server'

import { revalidatePath } from 'next/cache';
import { requireBarber, requireChefe } from '@/lib/auth-server';
import { hasPermission, PERMISSION_KEYS } from '@/lib/auth';

function authError(ctx) {
  return new Error(ctx.error === 'FORBIDDEN' ? 'Sem permissão para esta ação.' : 'AUTH_EXPIRED');
}

// EXPENSE_CATEGORIES foi movida pra lib/constants/finance.js: um arquivo
// 'use server' só pode exportar funções assíncronas — exportar um array
// daqui não quebra o build, mas chega undefined no client em runtime.

function dayRange(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Monta o resumo financeiro de um intervalo de datas.
 * Separa "quem pagou" (payment_status = 'pago') de "quem não pagou"
 * (qualquer outro status, exceto cancelado), usando o preço do serviço
 * (services.price) como valor de referência.
 */
export async function getFinanceSummary({ from, to, scopeBarberId = null }) {
  const ctx = await requireBarber();
  if (ctx.error) throw authError(ctx);

  // O servidor decide o escopo: sem MANAGE_FINANCE só se vê o próprio caixa,
  // mesmo que o cliente envie o id de outro profissional.
  const canManage = hasPermission(ctx.barber, PERMISSION_KEYS.MANAGE_FINANCE);
  const effectiveScope = canManage ? scopeBarberId : ctx.barber.id;

  return buildFinanceSummary(ctx.supabase, { from, to, scopeBarberId: effectiveScope });
}

async function buildFinanceSummary(supabase, { from, to, scopeBarberId = null }) {
  const { start, end } = dayRange(from, to);

  let query = supabase
    .from('appointments')
    .select(`
      id, appointment_date, status, payment_method, payment_status,
      client_name,
      services ( id, name, price ),
      barbers ( id, name, commission_percent )
    `)
    .gte('appointment_date', start)
    .lt('appointment_date', end)
    .neq('status', 'cancelado')
    .order('appointment_date', { ascending: false });

  if (scopeBarberId) {
    query = query.eq('barber_id', scopeBarberId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Não foi possível carregar o faturamento: ${error.message}`);

  const withAmount = data.map((a) => ({ ...a, amount: Number(a.services?.price || 0) }));

  const pagos = withAmount.filter((a) => a.payment_status === 'pago');
  const pendentes = withAmount.filter((a) => a.payment_status !== 'pago');

  const totalFaturado = pagos.reduce((sum, a) => sum + a.amount, 0);
  const totalPendente = pendentes.reduce((sum, a) => sum + a.amount, 0);

  const porMetodo = pagos.reduce((acc, a) => {
    const key = a.payment_method || 'não informado';
    acc[key] = (acc[key] || 0) + a.amount;
    return acc;
  }, {});

  // Comissão calculada estritamente sobre o que cada profissional produziu,
  // suportando taxas decimais guardadas na BD (ex: 0.50 para 50%, 0.25 para 25%, 1.00 para 100%):
  let comissao = null;
  if (scopeBarberId && pagos.length > 0) {
    const rawRate = Number(pagos[0].barbers?.commission_percent || 0);
    const multiplier = rawRate > 1 ? rawRate / 100 : rawRate;

    if (multiplier > 0) {
      comissao = {
        percent: Math.round(multiplier * 100),
        valor: Number((totalFaturado * multiplier).toFixed(2)),
      };
    }
  } else if (!scopeBarberId && pagos.length > 0) {
    const comissaoTotalCalculada = pagos.reduce((sum, a) => {
      const rawRate = Number(a.barbers?.commission_percent || 0);
      const multiplier = rawRate > 1 ? rawRate / 100 : rawRate;
      return sum + (a.amount * multiplier);
    }, 0);

    if (comissaoTotalCalculada > 0) {
      comissao = {
        percent: 'Mista',
        valor: Number(comissaoTotalCalculada.toFixed(2)),
      };
    }
  }

  return { pagos, pendentes, totalFaturado, totalPendente, porMetodo, comissao };
}

/**
 * Lista as despesas (cash_flow.type = 'expense') lançadas pelo chefe num
 * intervalo, ordenadas da mais recente pra mais antiga. Usado exclusivamente
 * pela tela /admin/financeiro/completo.
 */
export async function listExpenses({ from, to }) {
  const ctx = await requireChefe();
  if (ctx.error) throw authError(ctx);
  return queryExpenses(ctx.supabase, { from, to });
}

async function queryExpenses(supabase, { from, to }) {
  const { start, end } = dayRange(from, to);

  const { data, error } = await supabase
    .from('cash_flow')
    .select('id, amount, description, category, occurred_at, created_at, barbers ( id, name )')
    .eq('type', 'expense')
    .gte('occurred_at', start)
    .lt('occurred_at', end)
    .order('occurred_at', { ascending: false });

  if (error) throw new Error(`Não foi possível carregar as despesas: ${error.message}`);
  return data;
}

/**
 * Lança uma nova despesa da barbearia (aluguel, produtos, contas, etc.).
 * barber_id fica registrado como quem lançou o gasto — sempre o chefe,
 * já que essa ação só fica disponível na tela exclusiva dele.
 */
export async function createExpense({ amount, description, category, occurred_at }) {
  const ctx = await requireChefe();
  if (ctx.error) throw authError(ctx);
  const supabase = ctx.supabase;

  const { error } = await supabase.from('cash_flow').insert({
    barber_id: ctx.barber.id, // quem lançou = o Chefe logado (não vem do cliente)
    type: 'expense',
    amount,
    description: description?.trim() || null,
    category: category || 'outros',
    occurred_at: occurred_at ? new Date(`${occurred_at}T12:00:00`).toISOString() : new Date().toISOString(),
  });

  if (error) throw new Error(`Não foi possível lançar a despesa: ${error.message}`);
  revalidatePath('/admin/financeiro/completo');
}

export async function updateExpense(id, { amount, description, category, occurred_at }) {
  const ctx = await requireChefe();
  if (ctx.error) throw authError(ctx);
  const supabase = ctx.supabase;
  const payload = {};
  if (amount !== undefined) payload.amount = amount;
  if (description !== undefined) payload.description = description?.trim() || null;
  if (category !== undefined) payload.category = category;
  if (occurred_at !== undefined) payload.occurred_at = new Date(`${occurred_at}T12:00:00`).toISOString();

  const { error } = await supabase.from('cash_flow').update(payload).eq('id', id).eq('type', 'expense');
  if (error) throw new Error(`Não foi possível atualizar a despesa: ${error.message}`);
  revalidatePath('/admin/financeiro/completo');
}

export async function deleteExpense(id) {
  const ctx = await requireChefe();
  if (ctx.error) throw authError(ctx);
  const supabase = ctx.supabase;
  const { error } = await supabase.from('cash_flow').delete().eq('id', id).eq('type', 'expense');
  if (error) throw new Error(`Não foi possível remover a despesa: ${error.message}`);
  revalidatePath('/admin/financeiro/completo');
}

/**
 * Visão financeira completa e exclusiva do chefe: faturamento (todas as
 * barbearia, sem recorte por barbeiro), despesas lançadas no período e o
 * saldo líquido resultante. É o que abastece /admin/financeiro/completo,
 * separado do caixa/faturamento padrão (getFinanceSummary).
 */
export async function getFullFinanceOverview({ from, to }) {
  const ctx = await requireChefe();
  if (ctx.error) throw authError(ctx);

  const [receita, despesas] = await Promise.all([
    buildFinanceSummary(ctx.supabase, { from, to, scopeBarberId: null }),
    queryExpenses(ctx.supabase, { from, to }),
  ]);

  const totalDespesas = despesas.reduce((sum, d) => sum + Number(d.amount || 0), 0);

  const porCategoria = despesas.reduce((acc, d) => {
    const key = d.category || 'outros';
    acc[key] = (acc[key] || 0) + Number(d.amount || 0);
    return acc;
  }, {});

  const saldoLiquido = receita.totalFaturado - totalDespesas;

  return {
    totalFaturado: receita.totalFaturado,
    totalPendente: receita.totalPendente,
    despesas,
    totalDespesas,
    porCategoria,
    saldoLiquido,
  };
}