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

/**
 * Períodos do Financeiro:
 *  hoje   = hoje
 *  semana = semana atual, segunda a domingo
 *  mes    = mês atual completo (dia 1 ao último dia)
 * Inclui dias futuros do período, então agendamentos já marcados aparecem em "A receber".
 */
export function financeRange(rangeKey, now = new Date()) {
  const today = todayInShop(now);

  if (rangeKey === "semana") {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const from = addDaysStr(today, -((dow + 6) % 7)); // volta até a segunda
    return { from, to: addDaysStr(from, 6) };
  }

  if (rangeKey === "mes") {
    const [y, m] = today.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }

  return { from: today, to: today };
}
