'use server';

import { revalidatePath } from 'next/cache';
import { requireBarber, requirePermission } from '@/lib/auth-server';
import { hasPermission, PERMISSION_KEYS } from '@/lib/auth';
import { shopRange, settlementRange, todayInShop } from '@/lib/dates';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  calculateAppointmentFinance,
  getBarberCommissionRates,
} from '@/lib/commission';

function authError(ctx) {
  return new Error(ctx.error === 'FORBIDDEN' ? 'Sem permissão para esta ação.' : 'AUTH_EXPIRED');
}

/**
 * Visualização e cálculo prévio de acertos para todos os colaboradores no período.
 * Exclusivo para o Chefe / Administrador.
 * Regras:
 * - Colaboradores: 50% sobre serviços + 10% sobre produtos.
 * - Exceção do Dono (Matheus): 100% integral sobre serviços e produtos.
 */
export async function getCommissionSettlementPreview({
  periodKey = 'semana_passada',
  customFrom = null,
  customTo = null,
}) {
  const ctx = await requirePermission(PERMISSION_KEYS.VIEW_GLOBAL_FINANCE);
  if (ctx.error) throw authError(ctx);
  const supabase = ctx.supabase;

  // 1. Determina intervalo de datas
  let range;
  if (customFrom && customTo) {
    range = { from: customFrom, to: customTo, label: `${customFrom} a ${customTo}` };
  } else {
    range = settlementRange(periodKey);
  }

  const { start, end } = shopRange(range.from, range.to);

  // 2. Busca lista de barbeiros e catálogo de produtos (para blindar classificação entre Produto vs. Conveniência)
  const [barbersRes, productsRes] = await Promise.all([
    supabase.from('barbers').select('*').order('name', { ascending: true }),
    supabase
      .from('products')
      .select('id, name, category, is_convenience, description')
      .then((r) => r)
      .catch(() => ({ data: [] })),
  ]);

  const barbers = barbersRes?.data;
  const barbersErr = barbersRes?.error;
  if (barbersErr) throw new Error(`Erro ao buscar equipe: ${barbersErr.message}`);

  const convenienceProductIds = new Set(
    (productsRes?.data || [])
      .filter(
        (p) =>
          p?.is_convenience === true ||
          String(p?.category || '').toLowerCase().trim() === 'conveniencia' ||
          String(p?.category || '').toLowerCase().trim() === 'conveniência' ||
          String(p?.description || '').trim().startsWith('[CONVENIENCIA]')
      )
      .map((p) => String(p.id))
  );

  // 3. Busca agendamentos concluídos/pagos do período (excluindo cancelados, pré-agendamentos e fiados em aberto)
  const { data: rawAppointments, error: aptErr } = await supabase
    .from('appointments')
    .select(`
      id, appointment_date, appointment_time, status, payment_method, payment_status, is_barter, price, total_price, tip_amount, barber_commission_amount,
      barber_id, client_name, client_phone, service, notes,
      services ( id, name, price ),
      barbers ( id, name, phone, role, commission_percent, commission_rate, product_commission_percent, permissions )
    `)
    .gte('appointment_date', start)
    .lt('appointment_date', end)
    .or('status.is.null,status.neq.cancelado')
    .order('appointment_date', { ascending: true });

  if (aptErr) throw new Error(`Erro ao buscar agendamentos do período: ${aptErr.message}`);

  // Filtra estritamente atendimentos efetivamente pagos (exclui cancelados, fiados pendentes e permutas)
  const appointments = (rawAppointments || []).filter((a) => {
    if (a?.is_barter === true || a?.payment_status === 'permuta') return false;
    const st = String(a?.status || '').toLowerCase().trim();
    if (st === 'cancelado' || st === 'canceled' || st === 'cancelled') return false;
    const paySt = String(a?.payment_status || '').toLowerCase().trim();
    return paySt === 'pago' || paySt === 'paid';
  });

  // Normaliza linhas de notes caso algum item de conveniência tenha sido gravado com prefixo [PRODUTO:...]
  const normalizeNotesConvenienceTags = (notes) => {
    if (!notes || convenienceProductIds.size === 0) return notes;
    return String(notes)
      .split('\n')
      .map((line) => {
        const match = line.trim().match(/^\[PRODUTO:([^:]+):(.*)$/);
        if (match && convenienceProductIds.has(String(match[1]))) {
          return line.replace(/^\[PRODUTO:/, '[CONVENIENCIA:');
        }
        return line;
      })
      .join('\n');
  };

  // 4. Busca histórico de acertos já realizados neste intervalo
  let existingPayouts = [];
  try {
    const { data: payouts } = await supabase
      .from('commission_payouts')
      .select('*')
      .or(`and(period_start.gte.${range.from},period_start.lte.${range.to}),and(period_end.gte.${range.from},period_end.lte.${range.to})`);
    existingPayouts = payouts || [];
  } catch {
    // Tabela ainda pode estar pendente de criação no Supabase
  }

  // 5. Agrupa por colaborador aplicando estritamente:
  //    Comissão do Acerto = Comissão de Serviços + Comissão de Produtos (Conveniência 100% excluída)
  const previewByBarber = (barbers || []).map((b) => {
    const bAppointments = appointments.filter((a) => a.barber_id === b.id);
    const rates = getBarberCommissionRates(b);

    const completedCuts = bAppointments.map((a) => {
      const normalizedAppt = {
        ...a,
        notes: normalizeNotesConvenienceTags(a.notes),
      };
      const fin = calculateAppointmentFinance(normalizedAppt, b);
      const commissionablePrice = Number((fin.serviceAmount + fin.productsAmount).toFixed(2));
      const strictCommission = Number((fin.serviceCommission + fin.productCommission).toFixed(2));

      return {
        id: a.id,
        clientName: a.client_name || 'Cliente Avulso',
        date: a.appointment_date,
        time: (a.appointment_time || '').slice(0, 5),
        serviceName: a.service || a.services?.name || 'Corte',
        price: commissionablePrice,
        grossTotalWithConvenience: fin.totalAmount,
        serviceAmount: fin.serviceAmount,
        productsAmount: fin.productsAmount,
        convenienceExcludedAmount: fin.convenienceAmount,
        tipAmount: fin.tipAmount,
        commission: strictCommission,
        serviceCommission: fin.serviceCommission,
        productCommission: fin.productCommission,
        totalPayoutWithTip: fin.barberTotalPayout,
        isOwner: fin.isOwner,
        ruleLabel: fin.ruleLabel,
        shortLabel: fin.shortLabel,
        paymentStatus: a.payment_status || 'pago',
        paymentMethod: a.payment_method || 'não informado',
        status: a.status || 'concluido',
      };
    });

    const serviceRevenue = Number(
      completedCuts.reduce((acc, c) => acc + c.serviceAmount, 0).toFixed(2)
    );
    const productsRevenue = Number(
      completedCuts.reduce((acc, c) => acc + c.productsAmount, 0).toFixed(2)
    );
    const convenienceExcludedRevenue = Number(
      completedCuts.reduce((acc, c) => acc + (c.convenienceExcludedAmount || 0), 0).toFixed(2)
    );
    // Total de gorjetas 100% repassadas integralmente ao barbeiro executor
    const totalTips = Number(
      completedCuts.reduce((acc, c) => acc + (c.tipAmount || 0), 0).toFixed(2)
    );
    // Base comissionável estrita (Serviços + Produtos, sem Conveniência e sem Gorjeta)
    const totalRevenue = Number((serviceRevenue + productsRevenue).toFixed(2));

    const serviceCommissionTotal = Number(
      completedCuts.reduce((acc, c) => acc + c.serviceCommission, 0).toFixed(2)
    );
    const productCommissionTotal = Number(
      completedCuts.reduce((acc, c) => acc + c.productCommission, 0).toFixed(2)
    );
    const totalCommissionDue = Number(
      (serviceCommissionTotal + productCommissionTotal).toFixed(2)
    );
    // Total líquido a receber pelo colaborador = Comissões sobre serviços/produtos + 100% das Gorjetas
    const totalNetDue = Number((totalCommissionDue + totalTips).toFixed(2));

    // Acertos já efetuados para este barbeiro neste período
    const bPayouts = existingPayouts.filter(
      (p) => p.barber_id === b.id && (p.status === 'paid' || !p.status)
    );
    const alreadyPaidAmount = Number(
      bPayouts.reduce((acc, p) => acc + Number(p.commission_amount || 0), 0).toFixed(2)
    );
    const balancePending = Math.max(0, Number((totalNetDue - alreadyPaidAmount).toFixed(2)));

    return {
      barberId: b.id,
      barberName: b.name,
      barberPhone: b.phone,
      barberPixKey: b.pix_key || b.permissions?.pix_key || b.phone || null,
      barberRole: b.role,
      isOwner: rates.isOwner,
      commissionPercent: rates.servicePercent,
      productCommissionPercent: rates.productPercent,
      ruleLabel: rates.ruleLabel,
      shortLabel: rates.shortLabel,
      appointmentsCount: completedCuts.length,
      totalRevenue,
      serviceRevenue,
      productsRevenue,
      convenienceExcludedRevenue,
      totalTips,
      totalCommissionDue,
      totalNetDue,
      serviceCommissionTotal,
      productCommissionTotal,
      alreadyPaidAmount,
      balancePending,
      isFullySettled: alreadyPaidAmount >= totalNetDue && totalNetDue > 0,
      cuts: completedCuts,
      payoutsHistory: bPayouts,
    };
  });

  const totals = previewByBarber.reduce(
    (acc, b) => ({
      revenue: acc.revenue + b.totalRevenue,
      serviceRevenue: acc.serviceRevenue + b.serviceRevenue,
      productsRevenue: acc.productsRevenue + b.productsRevenue,
      convenienceExcludedRevenue: acc.convenienceExcludedRevenue + b.convenienceExcludedRevenue,
      tipsTotal: acc.tipsTotal + b.totalTips,
      commissionDue: acc.commissionDue + b.totalCommissionDue,
      netDue: acc.netDue + b.totalNetDue,
      serviceCommissionDue: acc.serviceCommissionDue + b.serviceCommissionTotal,
      productCommissionDue: acc.productCommissionDue + b.productCommissionTotal,
      alreadyPaid: acc.alreadyPaid + b.alreadyPaidAmount,
      balancePending: acc.balancePending + b.balancePending,
      cutsCount: acc.cutsCount + b.appointmentsCount,
    }),
    {
      revenue: 0,
      serviceRevenue: 0,
      productsRevenue: 0,
      convenienceExcludedRevenue: 0,
      tipsTotal: 0,
      commissionDue: 0,
      netDue: 0,
      serviceCommissionDue: 0,
      productCommissionDue: 0,
      alreadyPaid: 0,
      balancePending: 0,
      cutsCount: 0,
    }
  );

  return {
    period: range,
    previewByBarber,
    totals: {
      revenue: Number(totals.revenue.toFixed(2)),
      serviceRevenue: Number(totals.serviceRevenue.toFixed(2)),
      productsRevenue: Number(totals.productsRevenue.toFixed(2)),
      convenienceExcludedRevenue: Number(totals.convenienceExcludedRevenue.toFixed(2)),
      tipsTotal: Number(totals.tipsTotal.toFixed(2)),
      commissionDue: Number(totals.commissionDue.toFixed(2)),
      netDue: Number(totals.netDue.toFixed(2)),
      serviceCommissionDue: Number(totals.serviceCommissionDue.toFixed(2)),
      productCommissionDue: Number(totals.productCommissionDue.toFixed(2)),
      alreadyPaid: Number(totals.alreadyPaid.toFixed(2)),
      balancePending: Number(totals.balancePending.toFixed(2)),
      cutsCount: totals.cutsCount,
    },
  };
}

/**
 * Executa o Fechamento de Acerto de Comissão de um Colaborador.
 * Registra o recibo auditável e lança automaticamente no fluxo de caixa da barbearia.
 */
export async function executeCommissionSettlement({
  barberId,
  periodStart,
  periodEnd,
  periodLabel,
  totalRevenue,
  serviceRevenue = 0,
  productsRevenue = 0,
  totalTips = 0,
  commissionAmount,
  serviceCommissionTotal = 0,
  productCommissionTotal = 0,
  commissionPercent = 50,
  productCommissionPercent = 10,
  appointmentsCount = 0,
  appointmentIds = [],
  paymentMethod = 'pix',
  notes = '',
}) {
  const ctx = await requirePermission(PERMISSION_KEYS.VIEW_GLOBAL_FINANCE);
  if (ctx.error) throw authError(ctx);
  const admin = createAdminClient();

  if (!barberId) throw new Error('Colaborador não identificado.');
  if (Number(commissionAmount) <= 0) {
    throw new Error('O valor de comissão a acertar deve ser maior que zero.');
  }

  // 1. Busca dados do barbeiro e do chefe responsável (incluindo pix_key)
  const { data: barber, error: bErr } = await admin
    .from('barbers')
    .select('*')
    .eq('id', barberId)
    .single();

  if (bErr || !barber) throw new Error('Colaborador não encontrado.');

  const adminName = ctx.barber.name || 'Chefe';
  const cleanAmount = Number(Number(commissionAmount).toFixed(2));
  const cleanRevenue = Number(Number(totalRevenue || 0).toFixed(2));
  const cleanTips = Number(Number(totalTips || 0).toFixed(2));
  const barberPixKey = barber.pix_key || barber.permissions?.pix_key || barber.phone || null;

  // 2. Gera código único do recibo de pagamento
  const dateStr = todayInShop().replace(/-/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  const receiptCode = `JM-REC-${dateStr}-${randomSuffix}`;

  const basePayoutPayload = {
    receipt_code: receiptCode,
    barber_id: barberId,
    admin_id: ctx.barber.id,
    period_start: periodStart,
    period_end: periodEnd,
    period_label: periodLabel || `${periodStart} a ${periodEnd}`,
    total_revenue: cleanRevenue,
    commission_amount: cleanAmount,
    commission_percent: Number(commissionPercent || 50),
    appointments_count: Number(appointmentsCount || 0),
    total_tips: cleanTips,
    payment_method: paymentMethod || 'pix',
    status: 'paid',
    notes: notes?.trim() || null,
    appointment_ids: appointmentIds,
    paid_at: new Date().toISOString(),
  };

  const extendedPayoutPayload = {
    ...basePayoutPayload,
    service_revenue: Number(Number(serviceRevenue || cleanRevenue).toFixed(2)),
    product_revenue: Number(Number(productsRevenue || 0).toFixed(2)),
    service_commission_amount: Number(Number(serviceCommissionTotal || cleanAmount).toFixed(2)),
    product_commission_amount: Number(Number(productCommissionTotal || 0).toFixed(2)),
    product_commission_percent: Number(productCommissionPercent ?? 10),
    total_tips: cleanTips,
    pix_key_snapshot: barberPixKey,
  };

  let savedPayout = null;

  // 3. Tenta salvar na tabela dedicada commission_payouts (com fallback caso colunas novas ainda não existam)
  try {
    const { data: inserted, error: insertErr } = await admin
      .from('commission_payouts')
      .insert(extendedPayoutPayload)
      .select('*')
      .single();

    if (!insertErr && inserted) {
      savedPayout = inserted;
    } else if (insertErr) {
      const { data: fallbackInserted } = await admin
        .from('commission_payouts')
        .insert(basePayoutPayload)
        .select('*')
        .single();
      if (fallbackInserted) savedPayout = fallbackInserted;
    }
  } catch (err) {
    console.warn('[executeCommissionSettlement] Tabela commission_payouts não encontrada ou pendente de migração:', err?.message);
  }

  // 4. Integração Financeira: Lança saída no livro de caixa da barbearia (cash_flow)
  // Garante que o DRE e os relatórios de faturamento líquido deduzam automaticamente o acerto pago
  try {
    await admin.from('cash_flow').insert({
      barber_id: ctx.barber.id,
      type: 'expense',
      category: 'salarios',
      amount: cleanAmount,
      description: `Acerto de Comissão - ${barber.name} (${extendedPayoutPayload.period_label}) [${receiptCode}]`,
      occurred_at: new Date().toISOString(),
    });
  } catch (cfErr) {
    console.warn('[executeCommissionSettlement] Erro ao registrar no cash_flow:', cfErr?.message);
  }

  // 5. Se houver coluna commission_payout_id em appointments, vincula os cortes e marca commission_paid = true
  if (savedPayout?.id && Array.isArray(appointmentIds) && appointmentIds.length > 0) {
    try {
      await admin
        .from('appointments')
        .update({ commission_payout_id: savedPayout.id, commission_paid: true })
        .in('id', appointmentIds);
    } catch {
      // Ignora caso a coluna não exista no banco
    }
  }

  // Se a tabela commission_payouts ainda não tiver sido criada no Supabase, monta objeto virtual
  if (!savedPayout) {
    savedPayout = {
      id: `virtual-${Date.now()}`,
      ...extendedPayoutPayload,
      created_at: new Date().toISOString(),
    };
  }

  revalidatePath('/admin/financeiro');
  revalidatePath('/admin/financeiro/completo');
  revalidatePath('/admin/equipe');

  return {
    success: true,
    payout: {
      ...savedPayout,
      barber_name: barber.name,
      barber_phone: barber.phone,
      barber_pix_key: barberPixKey,
      admin_name: adminName,
    },
  };
}

/**
 * Consulta a lista de acertos de comissões passados.
 */
export async function listCommissionPayouts({ barberId = null, limit = 20 } = {}) {
  const ctx = await requireBarber();
  if (ctx.error) throw authError(ctx);
  const supabase = ctx.supabase;

  // Sem permissão de faturamento global, força consulta estrita aos próprios recibos
  const canGlobalFinance = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_GLOBAL_FINANCE);
  const effectiveBarberId = canGlobalFinance ? barberId : ctx.barber.id;

  try {
    let query = supabase
      .from('commission_payouts')
      .select(`
        *,
        barber:barbers!commission_payouts_barber_id_fkey ( id, name, phone ),
        admin:barbers!commission_payouts_admin_id_fkey ( id, name )
      `)
      .order('paid_at', { ascending: false })
      .limit(limit);

    if (effectiveBarberId) {
      query = query.eq('barber_id', effectiveBarberId);
    }

    const { data, error } = await query;
    if (error) {
      // Fallback sem joins caso as foreign keys usem outro nome
      const { data: simpleData } = await supabase
        .from('commission_payouts')
        .select('*')
        .order('paid_at', { ascending: false })
        .limit(limit);
      return simpleData || [];
    }
    return data || [];
  } catch (err) {
    console.warn('[listCommissionPayouts] Tabela commission_payouts não disponível:', err?.message);
    return [];
  }
}

