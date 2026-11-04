"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  QrCode,
  CreditCard,
  Banknote,
  TrendingUp,
  AlertCircle,
  Percent,
  Wallet,
  ChevronRight,
  ChevronLeft,
  Calendar,
} from "lucide-react";
import { useBarber } from "@/lib/barber-context";
import { endSession } from "@/lib/session";
import {
  financeRange,
  currentMonthInShop,
  shiftMonth,
  formatMonthYearPT,
  listSelectableMonths,
} from "@/lib/dates";
import { PERMISSION_KEYS } from "@/lib/auth";
import { getFinanceSummary } from "@/lib/actions/finance";
import { cacheKeys, getCache, setCache } from "@/lib/admin-cache";
import FinanceRow from "@/components/admin/FinanceRow";
import CommissionSettlementSheet from "@/components/admin/CommissionSettlementSheet";

const RANGES = [
  { key: "hoje", label: "Hoje" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
];

const METHOD_ICON = { pix: QrCode, cartao: CreditCard, dinheiro: Banknote };
const METHOD_LABEL = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };

function formatBRL(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

export default function FinanceiroPage() {
  const { barber, can, isChefe, selectedBarberId, selectBarber, team } = useBarber();
  const canManageFinance = can(PERMISSION_KEYS.MANAGE_FINANCE);

  const currentMonth = useMemo(() => currentMonthInShop(), []);
  const [range, setRange] = useState("hoje");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [tab, setTab] = useState("pagos");

  const [localScope, setLocalScope] = useState(
    canManageFinance ? "todos" : barber.id
  );
  const scopeId = isChefe ? (selectedBarberId ?? "todos") : localScope;
  const effectiveScope = canManageFinance
    ? scopeId === "todos"
      ? null
      : scopeId
    : barber.id;

  const { from: initialFrom, to: initialTo } = useMemo(
    () => financeRange(range, new Date(), selectedMonth),
    [range, selectedMonth]
  );
  const financeCacheKey = cacheKeys.finance(initialFrom, initialTo, effectiveScope);

  const [summary, setSummary] = useState(() => getCache(financeCacheKey) || null);
  const [loading, setLoading] = useState(() => !getCache(financeCacheKey));
  const [settlementOpen, setSettlementOpen] = useState(false);
  const requestIdRef = useRef(0);

  const monthOptions = useMemo(() => listSelectableMonths(new Date(), 24, 3), []);

  function changeScope(id) {
    if (isChefe) selectBarber(id === "todos" ? null : id);
    else setLocalScope(id);
  }

  const load = useCallback(
    async ({ silent = false } = {}) => {
      const requestId = ++requestIdRef.current;
      const { from, to } = financeRange(range, new Date(), selectedMonth);
      const currentKey = cacheKeys.finance(from, to, effectiveScope);
      const cached = getCache(currentKey);

      if (cached) {
        setSummary(cached);
        setLoading(false);
      } else if (!silent) {
        setLoading(true);
      }

      try {
        const data = await getFinanceSummary({ from, to, scopeBarberId: effectiveScope });
        if (requestId !== requestIdRef.current) return;
        setCache(currentKey, data);
        setSummary(data);
        setLoading(false);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        if (String(error?.message).includes("AUTH_EXPIRED")) {
          endSession();
          return;
        }
        setLoading(false);
      }
    },
    [range, selectedMonth, effectiveScope]
  );

  useEffect(() => {
    const cached = getCache(financeCacheKey);
    if (cached) {
      setSummary(cached);
      setLoading(false);
      load({ silent: true });
    } else {
      load({ silent: false });
    }
  }, [financeCacheKey, load]);

  return (
    <div className="px-4 pt-4">
      {canManageFinance && team.length > 0 && (
        <div className="mb-3 -mx-1 flex gap-2 overflow-x-auto pb-1 scroll-touch no-scrollbar">
          <button
            onClick={() => changeScope("todos")}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-all touch-manipulation select-none active:scale-95 ${
              scopeId === "todos"
                ? "bg-accent border-accent text-white"
                : "border-zinc-700 text-zinc-400 active:bg-zinc-800"
            }`}
          >
            Todos
          </button>
          {team.map((member) => (
            <button
              key={member.id}
              onClick={() => changeScope(member.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-all touch-manipulation select-none active:scale-95 ${
                scopeId === member.id
                  ? "bg-accent border-accent text-white"
                  : "border-zinc-700 text-zinc-400 active:bg-zinc-800"
              }`}
            >
              {member.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-3">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-all touch-manipulation select-none active:scale-95 ${
              range === r.key
                ? "bg-accent border-accent text-white"
                : "border-zinc-700 text-zinc-400 active:bg-zinc-800"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === "mes" && (
        <div className="bg-surface border border-zinc-800 rounded-xl p-2 mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSelectedMonth((prev) => shiftMonth(prev, -1))}
            aria-label="Mês anterior"
            className="h-9 w-9 rounded-lg bg-elevated border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 transition-all touch-manipulation shrink-0"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="relative flex-1 min-w-0">
            <div className="flex items-center justify-center gap-2 pointer-events-none">
              <Calendar size={14} className="text-blue-400 shrink-0" />
              <span className="text-white font-bold text-xs truncate">
                {formatMonthYearPT(selectedMonth)}
              </span>
            </div>
            <select
              aria-label="Selecionar mês"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value} className="bg-zinc-950 text-white">
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setSelectedMonth((prev) => shiftMonth(prev, 1))}
            aria-label="Próximo mês"
            className="h-9 w-9 rounded-lg bg-elevated border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 transition-all touch-manipulation shrink-0"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="h-24 rounded-xl bg-surface animate-pulse mb-4" />
      ) : !summary ? (
        <div className="bg-surface border border-zinc-800 rounded-xl p-5 text-center space-y-3 mb-4">
          <p className="text-zinc-300 text-xs font-medium">
            Não foi possível carregar o resumo financeiro deste período.
          </p>
          <button
            type="button"
            onClick={() => load({ silent: false })}
            className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-all"
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <div className="bg-surface border border-zinc-800 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium mb-1">
                <TrendingUp size={13} /> Faturado
              </div>
              <p className="text-white font-bold text-lg">
                {formatBRL(summary.totalFaturado)}
              </p>
              <p className="text-zinc-500 text-[11px]">
                {summary.pagos.length} pagamento(s)
              </p>
            </div>
            <div className="bg-surface border border-zinc-800 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-accent-light text-xs font-medium mb-1">
                <AlertCircle size={13} /> A receber
              </div>
              <p className="text-white font-bold text-lg">
                {formatBRL(summary.totalPendente)}
              </p>
              <p className="text-zinc-500 text-[11px]">
                {summary.pendentes.length} pendente(s)
              </p>
            </div>
          </div>

          {summary.comissao && (
            <div className="bg-surface border border-accent/30 rounded-xl p-3.5 mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                  <Percent size={16} className="text-accent-light" />
                </div>
                <div className="min-w-0">
                  <p className="text-zinc-400 text-xs truncate">
                    Comissão ({summary.comissao.ruleLabel || (typeof summary.comissao.percent === "number" ? `${summary.comissao.percent}% do faturado` : "50% serv. + 10% prod.")})
                  </p>
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <p className="text-white font-bold text-base">
                      {formatBRL(summary.comissao.valor)}
                    </p>
                    <span className="text-[11px] text-amber-400 font-medium">
                      A receber: {formatBRL(summary.comissao.aReceber ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              {isChefe && (
                <button
                  type="button"
                  onClick={() => setSettlementOpen(true)}
                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-3 py-1.5 active:scale-95 transition-all shadow-sm"
                >
                  <Wallet size={12} />
                  <span>Acertar</span>
                  <ChevronRight size={12} />
                </button>
              )}
            </div>
          )}

          {Object.keys(summary.porMetodo).length > 0 && (
            <div className="flex gap-2 mb-5">
              {Object.entries(summary.porMetodo).map(([method, total]) => {
                const Icon = METHOD_ICON[method] || Banknote;
                return (
                  <div
                    key={method}
                    className="flex-1 bg-elevated border border-zinc-800 rounded-lg px-3 py-2.5 text-center"
                  >
                    <Icon size={15} className="mx-auto text-zinc-400 mb-1" />
                    <p className="text-white text-xs font-semibold">
                      {formatBRL(total)}
                    </p>
                    <p className="text-zinc-500 text-[10px]">
                      {METHOD_LABEL[method] || method}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex border-b border-zinc-800 mb-3">
            <button
              onClick={() => setTab("pagos")}
              className={`flex-1 pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === "pagos"
                  ? "border-accent text-white"
                  : "border-transparent text-zinc-500"
              }`}
            >
              Quem pagou ({summary.pagos.length})
            </button>
            <button
              onClick={() => setTab("pendentes")}
              className={`flex-1 pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === "pendentes"
                  ? "border-accent text-white"
                  : "border-transparent text-zinc-500"
              }`}
            >
              Quem não pagou ({summary.pendentes.length})
            </button>
          </div>

          <div className="space-y-2">
            {(tab === "pagos" ? summary.pagos : summary.pendentes).length ===
            0 ? (
              <p className="text-zinc-600 text-sm text-center mt-10">
                {tab === "pagos"
                  ? "Nenhum pagamento registrado."
                  : "Ninguém pendente."}
              </p>
            ) : (
              (tab === "pagos" ? summary.pagos : summary.pendentes).map(
                (appointment) => (
                  <FinanceRow
                    key={appointment.id}
                    appointment={appointment}
                    variant={tab === "pagos" ? "paid" : "pending"}
                  />
                )
              )
            )}
          </div>
        </>
      )}

      {isChefe && (
        <CommissionSettlementSheet
          open={settlementOpen}
          onClose={() => {
            setSettlementOpen(false);
            load({ silent: true });
          }}
        />
      )}
    </div>
  );
}
