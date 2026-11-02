'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Plus,
  Lock,
  TrendingUp,
  TrendingDown,
  Scale,
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Receipt,
} from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import {
  financeRange,
  currentMonthInShop,
  shiftMonth,
  formatMonthYearPT,
  listSelectableMonths,
} from '@/lib/dates';
import { getFullFinanceOverview } from '@/lib/actions/finance';
import ExpenseRow from '@/components/admin/ExpenseRow';
import ExpenseFormSheet from '@/components/admin/ExpenseFormSheet';

const RANGES = [
  { key: 'mes', label: 'Por Mês' },
  { key: 'semana', label: 'Semana' },
  { key: 'hoje', label: 'Hoje' },
];

function formatBRL(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

const CATEGORY_LABEL = {
  aluguel: 'Aluguel',
  produtos: 'Produtos & Estoque',
  contas: 'Contas',
  manutencao: 'Manutenção',
  salarios: 'Salários',
  marketing: 'Marketing',
  outros: 'Outros',
};

/**
 * Tela exclusiva do chefe (Matheus): Livro de Despesas & Resultado Mensal,
 * separado do caixa/faturamento padrão em /admin/financeiro.
 * Permite selecionar qualquer mês/ano para inspecionar detalhadamente todas as
 * despesas lançadas em `cash_flow`, faturamento bruto e saldo líquido.
 */
export default function FinanceiroCompletoPage() {
  const { isChefe, barber } = useBarber();

  const currentMonth = useMemo(() => currentMonthInShop(), []);
  const [range, setRange] = useState('mes');
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [categoryFilter, setCategoryFilter] = useState('todas');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const monthOptions = useMemo(() => {
    const base = listSelectableMonths(new Date(), 24, 3);
    if (!base.some((m) => m.value === selectedMonth)) {
      return [
        {
          value: selectedMonth,
          label: formatMonthYearPT(selectedMonth),
          isCurrent: selectedMonth === currentMonth,
        },
        ...base,
      ].sort((a, b) => b.value.localeCompare(a.value));
    }
    return base;
  }, [selectedMonth, currentMonth]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = financeRange(range, new Date(), selectedMonth);
      const data = await getFullFinanceOverview({ from, to });
      setOverview(data);
    } catch (err) {
      console.error('[FinanceiroCompletoPage] Erro ao carregar visão financeira:', err);
    } finally {
      setLoading(false);
    }
  }, [range, selectedMonth]);

  useEffect(() => {
    if (isChefe) load();
  }, [isChefe, load]);

  function handleSelectMonth(newMonth) {
    setSelectedMonth(newMonth);
    setCategoryFilter('todas');
    if (range !== 'mes') {
      setRange('mes');
    }
  }

  function handleStepMonth(delta) {
    const next = shiftMonth(selectedMonth, delta);
    handleSelectMonth(next);
  }

  function handleSheetClose() {
    setSheetOpen(false);
    setEditing(null);
    load();
  }

  const filteredExpenses = useMemo(() => {
    const list = overview?.despesas || [];
    if (categoryFilter === 'todas') return list;
    return list.filter((e) => (e.category || 'outros') === categoryFilter);
  }, [overview, categoryFilter]);

  const filteredTotal = useMemo(() => {
    return filteredExpenses.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  }, [filteredExpenses]);

  const periodSubtitle = useMemo(() => {
    if (range === 'mes') return formatMonthYearPT(selectedMonth);
    if (range === 'semana') return 'Semana atual';
    return 'Hoje';
  }, [range, selectedMonth]);

  if (!isChefe) {
    return (
      <div className="flex flex-col items-center justify-center px-8 pt-24 text-center gap-3">
        <Lock className="text-zinc-600" size={28} />
        <p className="text-zinc-500 text-sm">
          Essa área é exclusiva do barbeiro chefe. Fale com o Matheus se precisar de algo daqui.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-10">
      <div className="flex items-center justify-between mb-3">
        <Link
          href="/admin/financeiro"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={14} /> Voltar para Caixa & Faturamento
        </Link>
        <span className="text-[11px] text-zinc-400 font-semibold tracking-wide uppercase">
          Livro de Despesas
        </span>
      </div>

      {/* Alternador de modo de período */}
      <div className="flex gap-2 mb-3">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              setRange(r.key);
              setCategoryFilter('todas');
            }}
            className={`flex-1 h-9 rounded-lg text-xs font-semibold border transition-all touch-manipulation select-none active:scale-95 ${
              range === r.key
                ? 'bg-accent border-accent text-white shadow-sm'
                : 'bg-surface border-zinc-800 text-zinc-400 active:bg-zinc-900'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Seletor Interativo de Mês / Ano */}
      {range === 'mes' && (
        <div className="bg-surface border border-zinc-800 rounded-xl p-2.5 mb-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => handleStepMonth(-1)}
            aria-label="Mês anterior"
            className="h-10 w-10 rounded-lg bg-elevated border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 active:bg-zinc-800 transition-all touch-manipulation shrink-0"
          >
            <ChevronLeft size={17} />
          </button>

          <div className="relative flex-1 min-w-0">
            <div className="flex items-center justify-center gap-2 pointer-events-none">
              <Calendar size={15} className="text-blue-400 shrink-0" />
              <span className="text-white font-bold text-sm truncate">
                {formatMonthYearPT(selectedMonth)}
              </span>
            </div>
            <select
              aria-label="Selecionar mês de referência"
              value={selectedMonth}
              onChange={(e) => handleSelectMonth(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value} className="bg-zinc-950 text-white">
                  {m.label}
                  {m.isCurrent ? ' (Mês atual)' : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-500 text-center mt-0.5 pointer-events-none">
              Toque para escolher outro mês
            </p>
          </div>

          <button
            type="button"
            onClick={() => handleStepMonth(1)}
            aria-label="Próximo mês"
            className="h-10 w-10 rounded-lg bg-elevated border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 active:bg-zinc-800 transition-all touch-manipulation shrink-0"
          >
            <ChevronRight size={17} />
          </button>

          {selectedMonth !== currentMonth && (
            <button
              type="button"
              onClick={() => handleSelectMonth(currentMonth)}
              className="h-10 px-2.5 rounded-lg bg-blue-950/60 border border-blue-500/30 text-blue-300 text-[11px] font-semibold whitespace-nowrap active:scale-95 transition-all touch-manipulation shrink-0"
            >
              Mês atual
            </button>
          )}
        </div>
      )}

      {loading || !overview ? (
        <div className="space-y-2.5 mb-4">
          <div className="h-24 rounded-xl bg-surface animate-pulse" />
          <div className="h-16 rounded-xl bg-surface animate-pulse" />
        </div>
      ) : (
        <>
          {/* Cards de Resumo Dinâmico do Mês / Período */}
          <div className="grid grid-cols-2 gap-2.5 mb-2.5">
            <div className="bg-surface border border-zinc-800 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-white text-xs font-medium mb-1">
                <TrendingUp size={13} className="text-blue-400" /> Total Faturado
              </div>
              <p className="text-white font-bold text-lg">{formatBRL(overview.totalFaturado)}</p>
              <p className="text-zinc-500 text-[10px] mt-0.5">{periodSubtitle}</p>
            </div>
            <div className="bg-surface border border-zinc-800 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-accent-light text-xs font-medium mb-1">
                <TrendingDown size={13} /> Total Despesas
              </div>
              <p className="text-white font-bold text-lg">{formatBRL(overview.totalDespesas)}</p>
              <p className="text-zinc-500 text-[10px] mt-0.5">
                {overview.despesas.length} lançamento{overview.despesas.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          <div
            className={`bg-surface border rounded-xl p-3.5 mb-4 flex items-center justify-between gap-3 ${
              overview.saldoLiquido >= 0 ? 'border-blue-500/35' : 'border-accent/40'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${
                  overview.saldoLiquido >= 0
                    ? 'bg-blue-950/60 border-blue-500/30'
                    : 'bg-accent/15 border-accent/30'
                }`}
              >
                <Scale
                  size={17}
                  className={overview.saldoLiquido >= 0 ? 'text-blue-400' : 'text-accent-light'}
                />
              </div>
              <div className="min-w-0">
                <p className="text-zinc-400 text-xs truncate">
                  Saldo líquido · {periodSubtitle}
                </p>
                <p
                  className={`font-bold text-lg leading-tight mt-0.5 ${
                    overview.saldoLiquido >= 0 ? 'text-white' : 'text-accent-light'
                  }`}
                >
                  {formatBRL(overview.saldoLiquido)}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] text-zinc-500 block uppercase font-semibold">
                Resultado
              </span>
              <span
                className={`text-xs font-bold ${
                  overview.saldoLiquido >= 0 ? 'text-blue-400' : 'text-accent-light'
                }`}
              >
                {overview.saldoLiquido >= 0 ? 'Positivo' : 'Negativo'}
              </span>
            </div>
          </div>

          {/* Filtro Interativo por Categoria de Despesa do Mês */}
          {Object.keys(overview.porCategoria).length > 0 && (
            <div className="flex gap-2 mb-4 overflow-x-auto -mx-1 px-1 pb-1 scroll-touch no-scrollbar">
              <button
                type="button"
                onClick={() => setCategoryFilter('todas')}
                className={`shrink-0 rounded-xl px-3 py-2 text-left border transition-all touch-manipulation select-none min-w-[96px] ${
                  categoryFilter === 'todas'
                    ? 'bg-blue-950/60 border-blue-500/50 text-white'
                    : 'bg-elevated border-zinc-800 text-zinc-400'
                }`}
              >
                <p className="text-white text-xs font-bold">{formatBRL(overview.totalDespesas)}</p>
                <p className="text-zinc-400 text-[10px]">Todas ({overview.despesas.length})</p>
              </button>
              {Object.entries(overview.porCategoria).map(([cat, total]) => {
                const isSelectedCat = categoryFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(isSelectedCat ? 'todas' : cat)}
                    className={`shrink-0 rounded-xl px-3 py-2 text-left border transition-all touch-manipulation select-none min-w-[96px] ${
                      isSelectedCat
                        ? 'bg-accent/20 border-accent text-white'
                        : 'bg-elevated border-zinc-800 text-zinc-400'
                    }`}
                  >
                    <p className="text-white text-xs font-bold">{formatBRL(total)}</p>
                    <p className="text-zinc-400 text-[10px]">{CATEGORY_LABEL[cat] || cat}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* Cabeçalho da Lista de Despesas do Mês */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-white text-xs font-semibold flex items-center gap-1.5">
                <Receipt size={13} className="text-accent-light" />
                <span>
                  Despesas de {periodSubtitle}
                  {categoryFilter !== 'todas'
                    ? ` · ${CATEGORY_LABEL[categoryFilter] || categoryFilter}`
                    : ''}
                </span>
              </p>
              <p className="text-zinc-500 text-[11px] mt-0.5">
                {filteredExpenses.length} despesa{filteredExpenses.length !== 1 ? 's' : ''} listada
                {filteredExpenses.length !== 1 ? 's' : ''} ({formatBRL(filteredTotal)})
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setSheetOpen(true);
              }}
              className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-xl px-3.5 py-2 active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none shrink-0"
            >
              <Plus size={14} /> Nova despesa
            </button>
          </div>

          <div className="space-y-2">
            {filteredExpenses.length === 0 ? (
              <div className="bg-surface border border-zinc-800/80 rounded-xl p-6 text-center mt-2">
                <p className="text-zinc-400 text-sm font-medium">
                  Nenhuma despesa registada em {periodSubtitle}.
                </p>
                <p className="text-zinc-600 text-xs mt-1">
                  Toque em &quot;Nova despesa&quot; para lançar um custo operacional neste período.
                </p>
              </div>
            ) : (
              filteredExpenses.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  onClick={() => {
                    setEditing(expense);
                    setSheetOpen(true);
                  }}
                />
              ))
            )}
          </div>
        </>
      )}

      <ExpenseFormSheet
        key={editing?.id || (sheetOpen ? `new-expense-${selectedMonth}` : 'none')}
        open={sheetOpen}
        onClose={handleSheetClose}
        expense={editing}
        chefeId={barber.id}
        defaultDate={
          range === 'mes' && selectedMonth !== currentMonth
            ? `${selectedMonth}-01`
            : undefined
        }
      />
    </div>
  );
}
