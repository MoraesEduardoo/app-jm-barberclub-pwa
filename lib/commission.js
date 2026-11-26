/**
 * Motor Central de Regras de Comissionamento, Rateio Proporcional de Descontos e CMV — JM Barberclub (v2.8.2)
 *
 * Regras de Negócio:
 * 1. Proprietário / Barbeiro Chefe (Admin / Matheus):
 *    - Retém 100% de Serviços, 100% de Produtos e 100% de Conveniência (Retenção da barbearia = R$ 0,00).
 * 2. Colaboradores (ex: William e demais barbeiros):
 *    - Recebem alíquota configurável sobre Serviços (padrão 50%).
 *    - Recebem alíquota configurável sobre Produtos de barbearia (padrão 10%).
 *    - Recebem 0% de comissão sobre Conveniência (100% retido no Caixa Geral).
 * 3. Separação Faturamento Bruto vs. Custo (CMV):
 *    - O Faturamento Bruto do Caixa soma sempre o Preço de Venda cheio (price).
 *    - O Preço de Custo (cost_price) é apurado separadamente para cálculo de CMV e Lucro Líquido no DRE.
 */

export const DEFAULT_COLLABORATOR_SERVICE_RATE = 50;
export const DEFAULT_COLLABORATOR_PRODUCT_RATE = 10;
export const OWNER_SERVICE_RATE = 100;
export const OWNER_PRODUCT_RATE = 100;
export const COLLABORATOR_CONVENIENCE_RATE = 0;
export const OWNER_CONVENIENCE_RATE = 100;

/**
 * Identifica se um produto pertence ao módulo de Conveniência (bebidas, snacks, etc.).
 */
export function isConvenienceProduct(product) {
  if (!product) return false;
  if (product.is_convenience === true) return true;
  const cat = String(product.category || product.item_type || '').toLowerCase().trim();
  if (cat === 'conveniencia' || cat === 'conveniência' || cat === 'convenience') return true;
  const desc = String(product.description || '').trim();
  if (desc.startsWith('[CONVENIENCIA]') || desc.startsWith('[CONVENIÊNCIA]')) return true;
  return false;
}

/**
 * Identifica se o profissional é o Barbeiro Chefe / Proprietário (Admin / Matheus).
 */
export function isOwnerBarber(barber) {
  if (!barber) return false;
  if (barber.role === 'admin' || barber.is_owner === true) return true;
  const cleanName = String(barber.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return cleanName.includes('matheus');
}

/**
 * Extrai e soma os produtos e itens de conveniência vinculados nas notas do agendamento:
 * Suporta tanto o formato com custo `[PRODUTO:<id>:<qty>:<unitPrice>:<costPrice>] <label>`
 * quanto o formato `[PRODUTO:<id>:<qty>:<unitPrice>] <label>`.
 */
export function parseAttachedProductsSummary(notes) {
  if (!notes) {
    return {
      productsSubtotal: 0,
      regularProductsSubtotal: 0,
      convenienceSubtotal: 0,
      regularProductsCostTotal: 0,
      convenienceCostTotal: 0,
      totalCost: 0,
      itemsCount: 0,
      regularItemsCount: 0,
      convenienceItemsCount: 0,
      items: [],
    };
  }

  const lines = String(notes).split('\n');
  let regularProductsSubtotal = 0;
  let convenienceSubtotal = 0;
  let regularProductsCostTotal = 0;
  let convenienceCostTotal = 0;
  let regularItemsCount = 0;
  let convenienceItemsCount = 0;
  const items = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const match = trimmed.match(
      /^\[(PRODUTO|CONVENIENCIA):([^:]+):(\d+):([0-9.]+)(?::([0-9.]+))?\]\s*(.*)$/
    );
    if (match) {
      const tagType = match[1];
      const isConvenience = tagType === 'CONVENIENCIA';
      const productId = match[2];
      const quantity = parseInt(match[3], 10) || 1;
      const unitPrice = parseFloat(match[4]) || 0;
      const unitCostPrice = match[5] !== undefined ? parseFloat(match[5]) || 0 : 0;
      const labelText = match[6] || `${quantity}x ${isConvenience ? 'Conveniência' : 'Produto'}`;

      const subtotal = Number((quantity * unitPrice).toFixed(2));
      const totalCost = Number((quantity * unitCostPrice).toFixed(2));

      if (isConvenience) {
        convenienceSubtotal += subtotal;
        convenienceCostTotal += totalCost;
        convenienceItemsCount += quantity;
      } else {
        regularProductsSubtotal += subtotal;
        regularProductsCostTotal += totalCost;
        regularItemsCount += quantity;
      }

      items.push({
        key: `${productId}-${idx}`,
        rawLine: trimmed,
        productId,
        quantity,
        unitPrice,
        unitCostPrice,
        subtotal,
        totalCost,
        grossProfit: Number((subtotal - totalCost).toFixed(2)),
        isConvenience,
        category: isConvenience ? 'conveniencia' : 'barbearia',
        label: labelText,
      });
    }
  });

  const totalExtra = Number((regularProductsSubtotal + convenienceSubtotal).toFixed(2));
  const totalCost = Number((regularProductsCostTotal + convenienceCostTotal).toFixed(2));

  return {
    productsSubtotal: totalExtra,
    regularProductsSubtotal: Number(regularProductsSubtotal.toFixed(2)),
    convenienceSubtotal: Number(convenienceSubtotal.toFixed(2)),
    regularProductsCostTotal: Number(regularProductsCostTotal.toFixed(2)),
    convenienceCostTotal: Number(convenienceCostTotal.toFixed(2)),
    totalCost,
    itemsCount: regularItemsCount + convenienceItemsCount,
    regularItemsCount,
    convenienceItemsCount,
    items,
  };
}

/**
 * Alias exportado para compatibilidade direta com componentes de detalhes e pendências.
 */
export function extractProductsFromNotes(notes) {
  return parseAttachedProductsSummary(notes);
}

/**
 * Soma todos os produtos e itens de conveniência vinculados nas notas do agendamento.
 */
export function sumAttachedProductsFromNotes(notes) {
  return parseAttachedProductsSummary(notes).productsSubtotal;
}

/**
 * Retorna os percentuais de comissão de serviço, produto e conveniência para o barbeiro.
 */
export function getBarberCommissionRates(barber) {
  if (isOwnerBarber(barber)) {
    return {
      isOwner: true,
      serviceRate: OWNER_SERVICE_RATE,
      productRate: OWNER_PRODUCT_RATE,
      convenienceRate: 0,
      servicePercent: OWNER_SERVICE_RATE,
      productPercent: OWNER_PRODUCT_RATE,
      conveniencePercent: 0,
      ruleLabel: '100% Serviços • 100% Produtos (Conveniência excluída)',
      shortLabel: '100% Serv. + Prod.',
    };
  }

  const rawRate = Number(barber?.commission_percent ?? barber?.commission_rate);
  const serviceRate =
    Number.isFinite(rawRate) && rawRate > 0 && rawRate <= 100
      ? rawRate
      : DEFAULT_COLLABORATOR_SERVICE_RATE;

  const rawProdRate = Number(barber?.product_commission_percent);
  const productRate =
    Number.isFinite(rawProdRate) && rawProdRate >= 0 && rawProdRate <= 100
      ? rawProdRate
      : DEFAULT_COLLABORATOR_PRODUCT_RATE;

  return {
    isOwner: false,
    serviceRate,
    productRate,
    convenienceRate: COLLABORATOR_CONVENIENCE_RATE,
    servicePercent: serviceRate,
    productPercent: productRate,
    conveniencePercent: COLLABORATOR_CONVENIENCE_RATE,
    ruleLabel: `${serviceRate}% Serviços • ${productRate}% Produtos • 0% Conveniência`,
    shortLabel: `${serviceRate}% Serv. / ${productRate}% Prod.`,
  };
}

/**
 * Distribuí proporcionalmente um desconto em reais (R$) entre Serviços, Produtos e Conveniência,
 * protegendo a base de cálculo das comissões.
 */
export function allocateProportionalDiscount({
  grossServiceAmount = 0,
  grossProductsAmount = 0,
  grossConvenienceAmount = 0,
  discountAmount = 0,
}) {
  const sGross = Math.max(0, Number(grossServiceAmount || 0));
  const pGross = Math.max(0, Number(grossProductsAmount || 0));
  const cGross = Math.max(0, Number(grossConvenienceAmount || 0));
  const totalGross = Number((sGross + pGross + cGross).toFixed(2));
  const validDiscount = Math.min(totalGross, Math.max(0, Number(discountAmount || 0)));

  if (totalGross <= 0 || validDiscount <= 0) {
    return {
      grossTotal: totalGross,
      discountAmount: 0,
      netTotal: totalGross,
      serviceAmount: sGross,
      productsAmount: pGross,
      convenienceAmount: cGross,
      serviceDiscount: 0,
      productsDiscount: 0,
      convenienceDiscount: 0,
    };
  }

  const netTotal = Number((totalGross - validDiscount).toFixed(2));
  const sDiscount = Number(((validDiscount * sGross) / totalGross).toFixed(2));
  const pDiscount = Number(((validDiscount * pGross) / totalGross).toFixed(2));
  const cDiscount = Math.max(0, Number((validDiscount - sDiscount - pDiscount).toFixed(2)));

  const serviceAmount = Math.max(0, Number((sGross - sDiscount).toFixed(2)));
  const productsAmount = Math.max(0, Number((pGross - pDiscount).toFixed(2)));
  const convenienceAmount = Math.max(
    0,
    Number((netTotal - serviceAmount - productsAmount).toFixed(2))
  );

  return {
    grossTotal: totalGross,
    discountAmount: validDiscount,
    netTotal,
    serviceAmount,
    productsAmount,
    convenienceAmount,
    serviceDiscount: sDiscount,
    productsDiscount: pDiscount,
    convenienceDiscount: cDiscount,
  };
}

/**
 * Calcula o detalhamento financeiro completo de um atendimento:
 * - Base de Comissão Operacional (Acerto): EXCLUSIVAMENTE Serviços + Produtos de Barbearia.
 * - Exclusão Obrigatória: Itens de Conveniência (convenienceAmount) possuem 0% de comissão operacional
 *   e ficam 100% retidos no caixa da barbearia.
 */
export function calculateAppointmentFinance(appointment, barberInput = null) {
  const barber = barberInput || appointment?.barbers || null;
  const {
    isOwner,
    serviceRate,
    productRate,
    convenienceRate,
    ruleLabel,
    shortLabel,
  } = getBarberCommissionRates(barber);

  const {
    regularProductsSubtotal,
    convenienceSubtotal,
    regularProductsCostTotal,
    convenienceCostTotal,
    totalCost,
    itemsCount,
    regularItemsCount,
    convenienceItemsCount,
    items,
  } = parseAttachedProductsSummary(appointment?.notes);

  const rawTotal = Number(
    appointment?.total_price ?? appointment?.price ?? appointment?.services?.price ?? 0
  );
  const safeTotal = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 0;
  const explicitDiscount = Math.max(0, Number(appointment?.discount_amount || 0));

  // Gorjeta (tip_amount): 100% líquida do profissional executor. Nunca compõe base comissionável nem retenção da barbearia.
  const tipAmount = Math.max(0, Number(appointment?.tip_amount || 0));

  const extraTotal = Number((regularProductsSubtotal + convenienceSubtotal).toFixed(2));

  let grossServiceAmount = Math.max(
    0,
    Number(((safeTotal + explicitDiscount) - extraTotal).toFixed(2))
  );
  if (safeTotal + explicitDiscount < extraTotal && appointment?.services?.price) {
    grossServiceAmount = Math.max(0, Number(appointment.services.price || 0));
  }

  const grossTotal = Number((grossServiceAmount + extraTotal).toFixed(2));
  const inferredDiscount =
    explicitDiscount > 0
      ? explicitDiscount
      : grossTotal > safeTotal && safeTotal > 0
      ? Number((grossTotal - safeTotal).toFixed(2))
      : 0;

  const allocated = allocateProportionalDiscount({
    grossServiceAmount,
    grossProductsAmount: regularProductsSubtotal,
    grossConvenienceAmount: convenienceSubtotal,
    discountAmount: inferredDiscount,
  });

  const serviceAmount = allocated.serviceAmount;
  const productsAmount = allocated.productsAmount;
  const convenienceAmount = allocated.convenienceAmount;
  const commissionableAmount = Number((serviceAmount + productsAmount).toFixed(2));
  const totalAmount = allocated.netTotal;

  // Regra estrita de Acerto: apenas Serviços e Produtos geram comissão operacional; Conveniência = 0
  const serviceCommission = Number(((serviceAmount * serviceRate) / 100).toFixed(2));
  const productCommission = Number(((productsAmount * productRate) / 100).toFixed(2));
  const convenienceCommission = 0;

  const commissionAmount = Number(
    (serviceCommission + productCommission).toFixed(2)
  );
  // Total a receber pelo barbeiro inclui a comissão de serviços/produtos + 100% integral da gorjeta
  const barberTotalPayout = Number((commissionAmount + tipAmount).toFixed(2));
  const shopRetentionAmount = Math.max(
    0,
    Number((totalAmount - commissionAmount).toFixed(2))
  );

  return {
    isOwner,
    serviceRate,
    productRate,
    convenienceRate,
    servicePercent: serviceRate,
    productPercent: productRate,
    conveniencePercent: 0,
    grossServiceAmount,
    grossProductsAmount: regularProductsSubtotal,
    grossConvenienceAmount: convenienceSubtotal,
    grossTotal,
    discountAmount: allocated.discountAmount,
    serviceAmount,
    productsAmount,
    convenienceAmount,
    tipAmount,
    commissionableAmount,
    totalAmount,
    regularProductsCostTotal,
    convenienceCostTotal,
    totalCost,
    serviceCommission,
    productCommission,
    convenienceCommission,
    commissionAmount,
    barberTotalPayout,
    shopRetentionAmount,
    productUnits: itemsCount,
    productItems: items,
    productsItemsCount: itemsCount,
    regularItemsCount,
    convenienceItemsCount,
    attachedProducts: items,
    ruleLabel,
    shortLabel,
  };
}

/**
 * Agrega uma lista de agendamentos pagos/pendentes usando as regras de comissionamento do BarberFlows.
 */
export function summarizeAppointmentsFinance(appointments = [], barberFallback = null) {
  return appointments.reduce(
    (acc, appt) => {
      const fin = calculateAppointmentFinance(appt, appt?.barbers || barberFallback);
      const isPaid = appt?.payment_status === 'pago' || appt?.payment_status === 'paid';
      const isCancelled =
        appt?.status === 'cancelado' ||
        appt?.status === 'cancelled' ||
        appt?.status === 'canceled';

      if (isCancelled) return acc;

      if (isPaid) {
        acc.paidCount += 1;
        acc.grossRevenue = Number((acc.grossRevenue + fin.totalAmount).toFixed(2));
        acc.servicesRevenue = Number((acc.servicesRevenue + fin.serviceAmount).toFixed(2));
        acc.productsRevenue = Number((acc.productsRevenue + fin.productsAmount).toFixed(2));
        acc.convenienceRevenue = Number(
          (acc.convenienceRevenue + fin.convenienceAmount).toFixed(2)
        );
        acc.tipsRevenue = Number(((acc.tipsRevenue || 0) + fin.tipAmount).toFixed(2));
        acc.productsCost = Number(
          (acc.productsCost + fin.regularProductsCostTotal).toFixed(2)
        );
        acc.convenienceCost = Number(
          (acc.convenienceCost + fin.convenienceCostTotal).toFixed(2)
        );
        acc.barberCommission = Number((acc.barberCommission + fin.commissionAmount).toFixed(2));
        acc.barberTotalPayout = Number(((acc.barberTotalPayout || 0) + fin.barberTotalPayout).toFixed(2));
        acc.serviceCommission = Number(
          (acc.serviceCommission + fin.serviceCommission).toFixed(2)
        );
        acc.productCommission = Number(
          (acc.productCommission + fin.productCommission).toFixed(2)
        );
        acc.convenienceCommission = Number(
          (acc.convenienceCommission + fin.convenienceCommission).toFixed(2)
        );
        acc.shopRetention = Number((acc.shopRetention + fin.shopRetentionAmount).toFixed(2));
      } else {
        acc.pendingCount += 1;
        acc.pendingRevenue = Number((acc.pendingRevenue + fin.totalAmount).toFixed(2));
        acc.pendingCommission = Number(
          (acc.pendingCommission + fin.commissionAmount).toFixed(2)
        );
        acc.pendingTips = Number(((acc.pendingTips || 0) + fin.tipAmount).toFixed(2));
        acc.pendingTotalPayout = Number(
          ((acc.pendingTotalPayout || 0) + fin.barberTotalPayout).toFixed(2)
        );
      }

      return acc;
    },
    {
      paidCount: 0,
      pendingCount: 0,
      grossRevenue: 0,
      servicesRevenue: 0,
      productsRevenue: 0,
      convenienceRevenue: 0,
      tipsRevenue: 0,
      productsCost: 0,
      convenienceCost: 0,
      barberCommission: 0,
      barberTotalPayout: 0,
      serviceCommission: 0,
      productCommission: 0,
      convenienceCommission: 0,
      shopRetention: 0,
      pendingRevenue: 0,
      pendingCommission: 0,
      pendingTips: 0,
      pendingTotalPayout: 0,
    }
  );
}
