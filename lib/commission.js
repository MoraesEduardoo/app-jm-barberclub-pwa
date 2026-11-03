/**
 * Motor Centralizado de Cálculo de Faturamento e Comissões — JM Barberclub
 *
 * Regras de Negócio Oficiais:
 * 1. Colaboradores (Padrão):
 *    - Serviços: 50% sobre o valor total dos serviços realizados.
 *    - Produtos: 10% sobre o valor total dos produtos consumidos/levados pelo cliente.
 *    - Comissão Total por Atendimento = (50% dos Serviços) + (10% dos Produtos).
 * 2. Exceção do Proprietário / Dono (Matheus):
 *    - Comissão estritamente de 100% sobre o valor integral do atendimento
 *      (100% dos serviços + 100% dos produtos, sem aplicar divisão de 50%/10%).
 */

export const MATHEUS_OWNER_ID = "b949db29-efb1-4131-8234-873195068328";
export const DEFAULT_COLLABORATOR_SERVICE_PERCENT = 50;
export const DEFAULT_COLLABORATOR_PRODUCT_PERCENT = 10;
export const OWNER_COMMISSION_PERCENT = 100;

/**
 * Identifica se o profissional é o proprietário (Matheus), que possui 100% de comissão integral.
 */
export function isOwnerBarber(barber) {
  if (!barber) return false;

  const id = String(barber.id || barber.barber_id || "").trim();
  if (id && id === MATHEUS_OWNER_ID) return true;

  const name = String(barber.name || barber.barber_name || "")
    .trim()
    .toLowerCase();
  if (name === "matheus" || name.startsWith("matheus ")) return true;

  const phone = String(barber.phone || barber.barber_phone || "").replace(/\D/g, "");
  if (phone && phone.endsWith("996646306")) return true;

  const role = String(barber.role || barber.barber_role || "")
    .trim()
    .toLowerCase();
  if (role === "admin" || role === "owner") return true;

  const rawComm = barber.commission_percent ?? barber.commission_rate;
  if (rawComm !== null && rawComm !== undefined && String(rawComm).trim() !== "") {
    const num = Number(rawComm);
    if (num === 100) return true;
    // Caso estivesse salvo em decimal 1.0 sem commission_percent inteiro definido
    if (barber.commission_percent == null && num === 1) return true;
  }

  return false;
}

/**
 * Retorna as taxas percentuais e multiplicadores de comissão (Serviços e Produtos) para um profissional.
 * - Matheus (Dono): 100% serviços / 100% produtos
 * - Colaboradores: 50% serviços / 10% produtos
 */
export function getBarberCommissionRates(barber) {
  if (isOwnerBarber(barber)) {
    return {
      isOwner: true,
      servicePercent: OWNER_COMMISSION_PERCENT,
      productPercent: OWNER_COMMISSION_PERCENT,
      serviceRate: 1.0,
      productRate: 1.0,
      ruleLabel: "100% (Proprietário)",
      shortLabel: "100%",
    };
  }

  // Regra padrão dos colaboradores: 50% em serviços e 10% em produtos
  return {
    isOwner: false,
    servicePercent: DEFAULT_COLLABORATOR_SERVICE_PERCENT,
    productPercent: DEFAULT_COLLABORATOR_PRODUCT_PERCENT,
    serviceRate: DEFAULT_COLLABORATOR_SERVICE_PERCENT / 100,
    productRate: DEFAULT_COLLABORATOR_PRODUCT_PERCENT / 100,
    ruleLabel: "50% serviços + 10% produtos",
    shortLabel: "50% serv. + 10% prod.",
  };
}

/**
 * Extrai todos os produtos vinculados nas notas do agendamento
 * Formato gravado: [PRODUTO:<productId>:<qty>:<unitPrice>] <qty>x <productName> (R$ <subtotal>)
 */
export function extractProductsFromNotes(notes) {
  if (!notes) {
    return { items: [], productsTotal: 0, totalUnits: 0 };
  }

  const lines = String(notes).split("\n");
  const items = [];
  let sum = 0;
  let totalUnits = 0;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[PRODUTO:([^:]+):(\d+):([0-9.]+)\]\s*(.*)$/);
    if (match) {
      const productId = match[1];
      const quantity = Math.max(1, parseInt(match[2], 10) || 1);
      const unitPrice = Math.max(0, parseFloat(match[3]) || 0);
      const subtotal = Number((quantity * unitPrice).toFixed(2));
      const label = match[4] || `${quantity}x Produto`;

      sum += subtotal;
      totalUnits += quantity;

      items.push({
        key: `${productId}-${idx}`,
        rawLine: trimmed,
        productId,
        quantity,
        unitPrice,
        subtotal,
        label,
      });
    }
  });

  return {
    items,
    productsTotal: Number(sum.toFixed(2)),
    totalUnits,
  };
}

/**
 * Soma apenas o valor monetário total dos produtos vinculados nas notas do agendamento.
 */
export function sumAttachedProductsFromNotes(notes) {
  return extractProductsFromNotes(notes).productsTotal;
}

/**
 * Calcula de forma determinística e sincronizada todos os valores financeiros e de comissão
 * de um agendamento individual (faturado ou a receber).
 */
export function calculateAppointmentFinance(appointment, barberOverride = null) {
  if (!appointment) {
    return {
      totalAmount: 0,
      serviceAmount: 0,
      productsAmount: 0,
      productUnits: 0,
      productItems: [],
      serviceCommission: 0,
      productCommission: 0,
      commissionAmount: 0,
      isOwner: false,
      servicePercent: DEFAULT_COLLABORATOR_SERVICE_PERCENT,
      productPercent: DEFAULT_COLLABORATOR_PRODUCT_PERCENT,
      ruleLabel: "50% serviços + 10% produtos",
      shortLabel: "50% serv. + 10% prod.",
    };
  }

  const barber =
    barberOverride ||
    appointment.barbers ||
    appointment.barber || {
      id: appointment.barber_id,
      name: appointment.barber_name,
      role: appointment.barber_role,
      commission_percent: appointment.commission_percent,
      commission_rate: appointment.commission_rate,
    };

  const rates = getBarberCommissionRates(barber);
  const { items: productItems, productsTotal, totalUnits: productUnits } =
    extractProductsFromNotes(appointment.notes);

  const productsAmount = Number(productsTotal.toFixed(2));
  const fallbackServicePrice = Number(appointment.services?.price ?? 0);

  let totalAmount = 0;
  let serviceAmount = 0;

  if (appointment.total_price != null || appointment.price != null) {
    const rawStoredTotal = Number(appointment.total_price ?? appointment.price ?? 0);
    if (rawStoredTotal >= productsAmount) {
      totalAmount = Number(rawStoredTotal.toFixed(2));
      serviceAmount = Number(Math.max(0, totalAmount - productsAmount).toFixed(2));
    } else {
      // Caso o campo price contivesse apenas o valor do serviço sem os produtos somados
      serviceAmount = Number(Math.max(0, rawStoredTotal).toFixed(2));
      totalAmount = Number((serviceAmount + productsAmount).toFixed(2));
    }
  } else {
    serviceAmount = Number(Math.max(0, fallbackServicePrice).toFixed(2));
    totalAmount = Number((serviceAmount + productsAmount).toFixed(2));
  }

  let serviceCommission = 0;
  let productCommission = 0;
  let commissionAmount = 0;

  if (rates.isOwner) {
    // Exceção do Dono (Matheus): 100% integral sobre serviços e produtos
    serviceCommission = Number(serviceAmount.toFixed(2));
    productCommission = Number(productsAmount.toFixed(2));
    commissionAmount = Number(totalAmount.toFixed(2));
  } else {
    // Colaboradores: 50% sobre serviços + 10% sobre produtos
    serviceCommission = Number((serviceAmount * rates.serviceRate).toFixed(2));
    productCommission = Number((productsAmount * rates.productRate).toFixed(2));
    commissionAmount = Number((serviceCommission + productCommission).toFixed(2));
  }

  return {
    totalAmount,
    serviceAmount,
    productsAmount,
    productUnits,
    productItems,
    serviceCommission,
    productCommission,
    commissionAmount,
    isOwner: rates.isOwner,
    servicePercent: rates.servicePercent,
    productPercent: rates.productPercent,
    ruleLabel: rates.ruleLabel,
    shortLabel: rates.shortLabel,
  };
}
