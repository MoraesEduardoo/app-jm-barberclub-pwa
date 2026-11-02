// Datas no fuso da barbearia (Campina Grande, PB = UTC-3).
// O Brasil não tem horário de verão desde 2019, então o offset fixo é seguro.
//
// Por que existe: `new Date("2026-09-30T00:00:00")` usa o fuso da MÁQUINA. No servidor
// (Vercel = UTC) isso é 21:00 do dia 29 no Brasil, e `new Date().toISOString()` devolve
// a data em UTC — depois das 21:00 "hoje" vira "amanhã". Aqui tudo é explícito em UTC-3,
// igual no navegador, no servidor e no `npm run dev`.
export const SHOP_UTC_OFFSET = "-03:00";
const OFFSET_MS = 3 * 60 * 60 * 1000;

/** "YYYY-MM-DD" do dia de hoje no Brasil. */
export function todayInShop(now = new Date()) {
  return new Date(now.getTime() - OFFSET_MS).toISOString().slice(0, 10);
}

/** Soma dias a uma data "YYYY-MM-DD" (sem depender do fuso da máquina). */
export function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Início do dia (00:00 no Brasil) como ISO UTC, pronto para comparar com timestamptz. */
export function dayStartISO(dateStr) {
  return new Date(`${dateStr}T00:00:00${SHOP_UTC_OFFSET}`).toISOString();
}

/**
 * Intervalo semiaberto [start, end) cobrindo de `from` até `to` (inclusive).
 * Use com .gte(start) e .lt(end): não perde nada no último segundo do dia.
 */
export function shopRange(from, to = from) {
  return { start: dayStartISO(from), end: dayStartISO(addDaysStr(to, 1)) };
}

const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** "YYYY-MM" do mês atual no fuso da barbearia. */
export function currentMonthInShop(now = new Date()) {
  return todayInShop(now).slice(0, 7);
}

/** Retorna { from: "YYYY-MM-01", to: "YYYY-MM-DD" } para um mês "YYYY-MM". */
export function monthRange(yearMonth) {
  const [yStr, mStr] = String(yearMonth || "").split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!y || !m || m < 1 || m > 12) {
    const fallback = currentMonthInShop();
    return monthRange(fallback);
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

/** Soma/subtrai meses de uma string "YYYY-MM" e devolve "YYYY-MM". */
export function shiftMonth(yearMonth, deltaMonths) {
  const [y, m] = String(yearMonth).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  const ny = d.getUTCFullYear();
  const nm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${ny}-${nm}`;
}

/** "2026-11" -> "Novembro de 2026" */
export function formatMonthYearPT(yearMonth) {
  const [y, m] = String(yearMonth || "").split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return String(yearMonth || "");
  return `${MONTH_NAMES_PT[m - 1]} de ${y}`;
}

/** Gera lista de meses selecionáveis para o filtro mensal de Despesas/Financeiro. */
export function listSelectableMonths(now = new Date(), pastMonths = 18, futureMonths = 2) {
  const current = currentMonthInShop(now);
  const items = [];
  for (let offset = futureMonths; offset >= -pastMonths; offset--) {
    const ym = shiftMonth(current, offset);
    items.push({
      value: ym,
      label: formatMonthYearPT(ym),
      isCurrent: offset === 0,
    });
  }
  return items;
}

/**
 * Períodos do Financeiro:
 *  hoje   = hoje
 *  semana = semana atual, segunda a domingo
 *  mes    = mês completo (dia 1 ao último dia; aceita `customMonth` "YYYY-MM")
 * Inclui dias futuros do período, então agendamentos já marcados aparecem em "A receber".
 */
export function financeRange(rangeKey, now = new Date(), customMonth = null) {
  const today = todayInShop(now);

  if (rangeKey === "semana") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const from = addDaysStr(today, -((dow + 6) % 7)); // volta até a segunda
    return { from, to: addDaysStr(from, 6) };
  }

  if (rangeKey === "mes") {
    if (customMonth && /^\d{4}-\d{2}$/.test(customMonth)) {
      return monthRange(customMonth);
    }
    return monthRange(today.slice(0, 7));
  }

  return { from: today, to: today };
}

/**
 * Intervalos específicos para Acerto de Comissões e Fechamento de Caixa:
 * - semana_atual: segunda desta semana até hoje
 * - semana_passada: segunda a domingo da semana anterior (fechamento semanal clássico)
 * - mes_atual: dia 1 do mês até hoje
 * - mes_passado: mês anterior completo
 */
export function settlementRange(rangeKey, now = new Date()) {
  const today = todayInShop(now);

  if (rangeKey === "semana_atual") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const from = addDaysStr(today, -((dow + 6) % 7)); // volta até a segunda
    return { from, to: today, label: "Esta Semana (até hoje)" };
  }

  if (rangeKey === "semana_passada") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const thisMonday = addDaysStr(today, -((dow + 6) % 7));
    const lastMonday = addDaysStr(thisMonday, -7);
    const lastSunday = addDaysStr(thisMonday, -1);
    return { from: lastMonday, to: lastSunday, label: "Semana Passada (Seg a Dom)" };
  }

  if (rangeKey === "mes_atual") {
    const [y, m] = today.split("-").map(Number);
    const mm = String(m).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: today, label: "Este Mês (até hoje)" };
  }

  if (rangeKey === "mes_passado") {
    const [y, m] = today.split("-").map(Number);
    const prevMonthDate = new Date(Date.UTC(y, m - 2, 1));
    const prevY = prevMonthDate.getUTCFullYear();
    const prevM = prevMonthDate.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
    const pm = String(prevM).padStart(2, "0");
    return {
      from: `${prevY}-${pm}-01`,
      to: `${prevY}-${pm}-${String(lastDay).padStart(2, "0")}`,
      label: "Mês Anterior Completo",
    };
  }

  return { from: today, to: today, label: "Hoje" };
}
