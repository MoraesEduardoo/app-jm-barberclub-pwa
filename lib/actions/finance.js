'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';

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
  const supabase = getSupabaseServerClient();
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

  // Comissão: só faz sentido calcular quando o resumo está restrito a UM
  // barbeiro (scopeBarberId informado) e ele tem um percentual configurado
  // pelo chefe. Comissão incide sobre o valor já PAGO no período.
  let comissao = null;
  if (scopeBarberId && pagos.length > 0) {
    const percent = Number(pagos[0].barbers?.commission_percent || 0);
    if (percent > 0) {
      comissao = {
        percent,
        valor: Number((totalFaturado * (percent / 100)).toFixed(2)),
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
  const supabase = getSupabaseServerClient();
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
export async function createExpense({ barber_id, amount, description, category, occurred_at }) {
  const supabase = getSupabaseServerClient();

  const { error } = await supabase.from('cash_flow').insert({
    barber_id,
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
  const supabase = getSupabaseServerClient();
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
  const supabase = getSupabaseServerClient();
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
  const [receita, despesas] = await Promise.all([
    getFinanceSummary({ from, to, scopeBarberId: null }),
    listExpenses({ from, to }),
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
