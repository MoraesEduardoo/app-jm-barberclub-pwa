'use server'

import { revalidatePath } from 'next/cache';
import { requireBarber, requireChefe } from '@/lib/auth-server';
import { hasPermission, PERMISSION_KEYS } from '@/lib/auth';
import { shopRange } from '@/lib/dates';
import {
  calculateAppointmentFinance,
  getBarberCommissionRates,
} from '@/lib/commission';

function authError(ctx) {
  return new Error(ctx.error === 'FORBIDDEN' ? 'Sem permissão para esta ação.' : 'AUTH_EXPIRED');
}

// Intervalo [start, end) no fuso da barbearia (UTC-3). Use com .gte(start) e .lt(end).
function dayRange(from, to) {
  return shopRange(from, to);
}

/**
 * Monta o resumo financeiro de um intervalo de datas.
 * Separa "quem pagou" (payment_status = 'pago') de "quem não pagou"
 * (qualquer outro status, exceto cancelado), calculando dinamicamente:
 * - Colaboradores: 50% sobre serviços + 10% sobre produtos (no faturado e no "A Receber").
 * - Exceção do Dono (Matheus): 100% integral sobre todo o atendimento.
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
  let query = supabase
    .from('appointments')
    .select(`
      id, barber_id, client_id, client_name, client_phone, service, appointment_date, appointment_time, status, payment_method, payment_status, price, total_price, barber_commission_amount,
      notes,
      services ( id, name, price ),
      barbers ( id, name, phone, role, commission_percent, commission_rate, permissions )
    `)
    .gte('appointment_date', from)
    .lte('appointment_date', to)
    // neq sozinho descarta linhas com status NULL; assim só saem os cancelados
    .or('status.is.null,status.neq.cancelado')
    .order('appointment_date', { ascending: false });

  if (scopeBarberId) {
    query = query.eq('barber_id', scopeBarberId);
  }

  const [apptsRes, scopedBarberRes] = await Promise.all([
    query,
    scopeBarberId
      ? supabase
          .from('barbers')
          .select('id, name, phone, role, commission_percent, commission_rate, permissions')
          .eq('id', scopeBarberId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let data = apptsRes?.data;
  let error = apptsRes?.error;

  // Fallback seguro caso alguma coluna opcional não esteja disponível no schema
  if (error) {
    let fallbackQuery = supabase
      .from('appointments')
      .select(`
        id, barber_id, appointment_date, appointment_time, status, payment_method, payment_status, price, total_price, barber_commission_amount,
        client_name, notes,
        services ( id, name, price ),
        barbers ( id, name, phone, role, commission_percent, commission_rate, permissions )
      `)
      .gte('appointment_date', from)
      .lte('appointment_date', to)
      .or('status.is.null,status.neq.cancelado')
      .order('appointment_date', { ascending: false });

    if (scopeBarberId) {
      fallbackQuery = fallbackQuery.eq('barber_id', scopeBarberId);
    }
    const fallbackRes = await fallbackQuery;
    data = fallbackRes.data;
    error = fallbackRes.error;
  }

  if (error) throw new Error(`Não foi possível carregar o faturamento: ${error.message}`);

  const scopedBarber = scopedBarberRes?.data || null;

  const withAmount = (data || []).map((a) => {
    const fin = calculateAppointmentFinance(a, a.barbers || scopedBarber);
    const effectiveServiceName = a.service || a.services?.name || 'Serviço';
    return {
      ...a,
      service: effectiveServiceName,
      services: a.services
        ? { ...a.services, name: effectiveServiceName }
        : { id: a.service_id || null, name: effectiveServiceName, price: fin.serviceAmount },
      amount: fin.totalAmount,
      service_amount: fin.serviceAmount,
      products_amount: fin.productsAmount,
      product_units: fin.productUnits,
      product_items: fin.productItems,
      barber_commission_amount: fin.commissionAmount,
      commission_amount: fin.commissionAmount,
      service_commission: fin.serviceCommission,
      product_commission: fin.productCommission,
      is_owner_barber: fin.isOwner,
      commission_rule_label: fin.ruleLabel,
      commission_short_label: fin.shortLabel,
    };
  });

  const pagos = withAmount.filter((a) => a.payment_status === 'pago');
  const pendentes = withAmount.filter((a) => a.payment_status !== 'pago');

  const totalFaturado = Number(pagos.reduce((sum, a) => sum + a.amount, 0).toFixed(2));
  const totalPendente = Number(pendentes.reduce((sum, a) => sum + a.amount, 0).toFixed(2));

  const servicosFaturadoBruto = Number(pagos.reduce((sum, a) => sum + a.service_amount, 0).toFixed(2));
  const produtosFaturadoBruto = Number(pagos.reduce((sum, a) => sum + a.products_amount, 0).toFixed(2));
  const servicosPendenteBruto = Number(pendentes.reduce((sum, a) => sum + a.service_amount, 0).toFixed(2));
  const produtosPendenteBruto = Number(pendentes.reduce((sum, a) => sum + a.products_amount, 0).toFixed(2));

  const porMetodo = pagos.reduce((acc, a) => {
    const key = a.payment_method || 'não informado';
    acc[key] = Number(((acc[key] || 0) + a.amount).toFixed(2));
    return acc;
  }, {});

  // Soma dinâmica de comissões (Matheus = 100% integral; Colaboradores = 50% serviços + 10% produtos)
  const comissaoFaturada = Number(
    pagos.reduce((sum, a) => sum + a.commission_amount, 0).toFixed(2)
  );
  const comissaoAReceber = Number(
    pendentes.reduce((sum, a) => sum + a.commission_amount, 0).toFixed(2)
  );
  const comissaoServicosFaturada = Number(
    pagos.reduce((sum, a) => sum + a.service_commission, 0).toFixed(2)
  );
  const comissaoProdutosFaturada = Number(
    pagos.reduce((sum, a) => sum + a.product_commission, 0).toFixed(2)
  );
  const comissaoServicosAReceber = Number(
    pendentes.reduce((sum, a) => sum + a.service_commission, 0).toFixed(2)
  );
  const comissaoProdutosAReceber = Number(
    pendentes.reduce((sum, a) => sum + a.product_commission, 0).toFixed(2)
  );

  let comissao = null;
  if (scopeBarberId) {
    const barberRef = scopedBarber || withAmount[0]?.barbers || { id: scopeBarberId };
    const rates = getBarberCommissionRates(barberRef);
    comissao = {
      isOwner: rates.isOwner,
      percent: rates.servicePercent,
      productPercent: rates.productPercent,
      ruleLabel: rates.ruleLabel,
      shortLabel: rates.shortLabel,
      valor: comissaoFaturada,
      aReceber: comissaoAReceber,
      totalPrevisto: Number((comissaoFaturada + comissaoAReceber).toFixed(2)),
      servicosFaturado: comissaoServicosFaturada,
      produtosFaturado: comissaoProdutosFaturada,
      servicosAReceber: comissaoServicosAReceber,
      produtosAReceber: comissaoProdutosAReceber,
    };
  } else if (withAmount.length > 0) {
    comissao = {
      isOwner: false,
      percent: '50% Serv. + 10% Prod.',
      productPercent: 10,
      ruleLabel: 'Matheus 100% · Equipe 50% Serv. + 10% Prod.',
      shortLabel: '100% Dono · 50%/10% Equipe',
      valor: comissaoFaturada,
      aReceber: comissaoAReceber,
      totalPrevisto: Number((comissaoFaturada + comissaoAReceber).toFixed(2)),
      servicosFaturado: comissaoServicosFaturada,
      produtosFaturado: comissaoProdutosFaturada,
      servicosAReceber: comissaoServicosAReceber,
      produtosAReceber: comissaoProdutosAReceber,
    };
  }

  return {
    pagos,
    pendentes,
    totalFaturado,
    totalPendente,
    servicosFaturadoBruto,
    produtosFaturadoBruto,
    servicosPendenteBruto,
    produtosPendenteBruto,
    porMetodo,
    comissao,
  };
}

/**
 * Lista as despesas (cash_flow.type IN ('expense', 'saida')) lançadas pelo chefe num
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
    .select('id, amount, description, category, occurred_at, payment_method, created_at, barbers ( id, name )')
    .in('type', ['expense', 'saida'])
    .gte('occurred_at', start)
    .lt('occurred_at', end)
    .order('occurred_at', { ascending: false });

  if (error) throw new Error(`Não foi possível carregar as despesas: ${error.message}`);
  return data || [];
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

  const { error } = await supabase.from('cash_flow').update(payload).eq('id', id).in('type', ['expense', 'saida']);
  if (error) throw new Error(`Não foi possível atualizar a despesa: ${error.message}`);
  revalidatePath('/admin/financeiro/completo');
}

export async function deleteExpense(id) {
  const ctx = await requireChefe();
  if (ctx.error) throw authError(ctx);
  const supabase = ctx.supabase;
  const { error } = await supabase.from('cash_flow').delete().eq('id', id).in('type', ['expense', 'saida']);
  if (error) throw new Error(`Não foi possível remover a despesa: ${error.message}`);
  revalidatePath('/admin/financeiro/completo');
}

/**
 * Visão financeira completa e exclusiva do chefe: faturamento (toda a
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
    pagosCount: receita.pagos.length,
    despesas,
    totalDespesas,
    porCategoria,
    saldoLiquido,
  };
}

/**
 * Consulta a vista unificada de DRE mensal (view_monthly_cash_flow)
 * no Supabase para análise histórica de receitas, despesas e lucro líquido.
 */
export async function getMonthlyCashFlowView() {
  const ctx = await requireChefe();
  if (ctx.error) throw authError(ctx);

  try {
    const { data, error } = await ctx.supabase
      .from("view_monthly_cash_flow")
      .select("*")
      .order("month_ref", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[getMonthlyCashFlowView] Erro ao consultar view_monthly_cash_flow:", err?.message);
    }
    return [];
  }
}