/**
 * Motor Central de Regras de Comissionamento — JM BarberClub (v2.8.2)
 *
 * Regras de Negócio:
 * 1. Matheus (Barbeiro Chefe / Dono / Admin):
 *    - Retém 100% do valor dos serviços, 100% do valor dos produtos e 100% dos itens de Conveniência que ele realizar/vender.
 * 2. Outros Barbeiros (ex: William e demais colaboradores):
 *    - Recebem 50% de comissão sobre o valor de cada serviço realizado (ou a taxa configurada no cadastro, padrão 50%).
 *    - Recebem 10% de comissão sobre o valor de cada produto de barbearia vendido no atendimento.
 *    - Recebem 0% de comissão sobre itens de Conveniência (100% retido no caixa geral da barbearia).
 *    - Os 50% restantes dos serviços, 90% restantes dos produtos e 100% da Conveniência ficam retidos para a barbearia (Matheus).
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
  const cat = String(product.category || '').toLowerCase().trim();
  if (cat === 'conveniencia' || cat === 'conveniência' || cat === 'convenience') return true;
  const desc = String(product.description || '').trim();
  if (desc.startsWith('[CONVENIENCIA]') || desc.startsWith('[CONVENIÊNCIA]')) return true;
  return false;
}

/**
 * Identifica se o profissional é o Barbeiro Chefe / Dono (Matheus).
 * Verifica tanto o `role === 'admin'` quanto o nome "Matheus".
 */
export function isOwnerBarber(barber) {
  if (!barber) return false;
  if (barber.role === 'admin') return true;
  const cleanName = String(barber.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return cleanName.includes('matheus');
}

/**
 * Extrai e soma os produtos vinculados nas notas do agendamento:
 * - Produtos de Barbearia: `[PRODUTO:<productId>:<qty>:<unitPrice>] <qty>x <Nome> (R$ <subtotal>)`
 * - Itens de Conveniência: `[CONVENIENCIA:<productId>:<qty>:<unitPrice>] <qty>x <Nome> (R$ <subtotal>)`
 */
export function parseAttachedProductsSummary(notes) {
  if (!notes) {
    return {
      productsSubtotal: 0,
      regularProductsSubtotal: 0,
      convenienceSubtotal: 0,
      itemsCount: 0,
      regularItemsCount: 0,
      convenienceItemsCount: 0,
      items: [],
    };
  }

  const lines = String(notes).split('\n');
  let regularProductsSubtotal = 0;
  let convenienceSubtotal = 0;
  let regularItemsCount = 0;
  let convenienceItemsCount = 0;
  const items = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[(PRODUTO|CONVENIENCIA):([^:]+):(\d+):([0-9.]+)\]\s*(.*)$/);
    if (match) {
      const tagType = match[1];
      const isConvenience = tagType === 'CONVENIENCIA';
      const productId = match[2];
      const quantity = parseInt(match[3], 10) || 1;
      const unitPrice = parseFloat(match[4]) || 0;
      const subtotal = Number((quantity * unitPrice).toFixed(2));

      if (isConvenience) {
        convenienceSubtotal += subtotal;
        convenienceItemsCount += quantity;
      } else {
        regularProductsSubtotal += subtotal;
        regularItemsCount += quantity;
      }

      items.push({
        productId,
        quantity,
        unitPrice,
        subtotal,
        isConvenience,
        category: isConvenience ? 'conveniencia' : 'barbearia',
        label: match[5] || `${quantity}x ${isConvenience ? 'Conveniência' : 'Produto'}`,
      });
    }
  }

  const totalExtra = Number((regularProductsSubtotal + convenienceSubtotal).toFixed(2));

  return {
    productsSubtotal: totalExtra,
    regularProductsSubtotal: Number(regularProductsSubtotal.toFixed(2)),
    convenienceSubtotal: Number(convenienceSubtotal.toFixed(2)),
    itemsCount: regularItemsCount + convenienceItemsCount,
    regularItemsCount,
    convenienceItemsCount,
    items,
  };
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
      convenienceRate: OWNER_CONVENIENCE_RATE,
    };
  }

  const rawRate = Number(barber?.commission_percent ?? barber?.commission_rate);
  const serviceRate =
    Number.isFinite(rawRate) && rawRate > 0 && rawRate < 100
      ? rawRate
      : DEFAULT_COLLABORATOR_SERVICE_RATE;

  return {
    isOwner: false,
    serviceRate,
    productRate: DEFAULT_COLLABORATOR_PRODUCT_RATE,
    convenienceRate: COLLABORATOR_CONVENIENCE_RATE,
  };
}

/**
 * Calcula o detalhamento financeiro completo de um atendimento:
 * - Valor do serviço (`serviceAmount`)
 * - Valor dos produtos de barbearia (`productsAmount`)
 * - Valor dos itens de conveniência (`convenienceAmount`)
 * - Valor total da conta (`totalAmount`)
 * - Comissão do barbeiro sobre o serviço (`serviceCommission`)
 * - Comissão do barbeiro sobre os produtos (`productCommission`)
 * - Comissão sobre conveniência (`convenienceCommission` — 0% para colaboradores, 100% no caixa geral)
 * - Comissão total do barbeiro (`commissionAmount`)
 * - Valor retido pela barbearia / caixa geral (`shopRetentionAmount`)
 */
export function calculateAppointmentFinance(appointment, barberInput = null) {
  const barber = barberInput || appointment?.barbers || null;
  const { isOwner, serviceRate, productRate, convenienceRate } = getBarberCommissionRates(barber);

  const {
    regularProductsSubtotal,
    convenienceSubtotal,
    itemsCount,
    regularItemsCount,
    convenienceItemsCount,
    items,
  } = parseAttachedProductsSummary(appointment?.notes);

  const rawTotal = Number(
    appointment?.total_price ?? appointment?.price ?? appointment?.services?.price ?? 0
  );
  const safeTotal = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 0;

  const extraTotal = Number((regularProductsSubtotal + convenienceSubtotal).toFixed(2));

  // Se o total salvo no agendamento for menor que a soma de produtos + conveniência (ex: legado),
  // preserva o preço base do catálogo de serviços.
  let serviceAmount = Math.max(0, Number((safeTotal - extraTotal).toFixed(2)));
  if (safeTotal < extraTotal && appointment?.services?.price) {
    serviceAmount = Math.max(0, Number(appointment.services.price || 0));
  }

  const productsAmount = Number(regularProductsSubtotal.toFixed(2));
  const convenienceAmount = Number(convenienceSubtotal.toFixed(2));
  const totalAmount = Number((serviceAmount + productsAmount + convenienceAmount).toFixed(2));

  const serviceCommission = Number(((serviceAmount * serviceRate) / 100).toFixed(2));
  const productCommission = Number(((productsAmount * productRate) / 100).toFixed(2));
  // Conveniência: 0% para colaboradores (100% retido no caixa geral da barbearia)
  const convenienceCommission = isOwner
    ? Number(((convenienceAmount * convenienceRate) / 100).toFixed(2))
    : 0;

  const commissionAmount = Number(
    (serviceCommission + productCommission + convenienceCommission).toFixed(2)
  );
  const shopRetentionAmount = Math.max(
    0,
    Number((totalAmount - commissionAmount).toFixed(2))
  );

  return {
    isOwner,
    serviceRate,
    productRate,
    convenienceRate,
    serviceAmount,
    productsAmount,
    convenienceAmount,
    totalAmount,
    serviceCommission,
    productCommission,
    convenienceCommission,
    commissionAmount,
    shopRetentionAmount,
    productsItemsCount: itemsCount,
    regularItemsCount,
    convenienceItemsCount,
    attachedProducts: items,
    ruleLabel: isOwner
      ? '100% Serviços • 100% Produtos • 100% Conveniência (Dono)'
      : `${serviceRate}% Serviços • ${productRate}% Produtos • 0% Conveniência`,
  };
}

/**
 * Agrega uma lista de agendamentos pagos/pendentes usando as regras de comissionamento v2.8.2.
 */
export function summarizeAppointmentsFinance(appointments = [], barberFallback = null) {
  return appointments.reduce(
    (acc, appt) => {
      const fin = calculateAppointmentFinance(appt, appt?.barbers || barberFallback);
      const isPaid = appt?.payment_status === 'pago';
      const isCancelled = appt?.status === 'cancelado' || appt?.status === 'cancelled';

      if (isCancelled) return acc;

      if (isPaid) {
        acc.paidCount += 1;
        acc.grossRevenue = Number((acc.grossRevenue + fin.totalAmount).toFixed(2));
        acc.servicesRevenue = Number((acc.servicesRevenue + fin.serviceAmount).toFixed(2));
        acc.productsRevenue = Number((acc.productsRevenue + fin.productsAmount).toFixed(2));
        acc.convenienceRevenue = Number(
          (acc.convenienceRevenue + fin.convenienceAmount).toFixed(2)
        );
        acc.barberCommission = Number((acc.barberCommission + fin.commissionAmount).toFixed(2));
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
      barberCommission: 0,
      serviceCommission: 0,
      productCommission: 0,
      convenienceCommission: 0,
      shopRetention: 0,
      pendingRevenue: 0,
      pendingCommission: 0,
    }
  );
}
