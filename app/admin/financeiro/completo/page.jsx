'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Lock, TrendingUp, TrendingDown, Scale } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import { getFullFinanceOverview } from '@/lib/actions/finance';
import ExpenseRow from '@/components/admin/ExpenseRow';
import ExpenseFormSheet from '@/components/admin/ExpenseFormSheet';

const RANGES = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mês' },
];

function getRangeDates(rangeKey) {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today);

  if (rangeKey === 'semana') from.setDate(from.getDate() - 6);
  if (rangeKey === 'mes') from.setDate(from.getDate() - 29);

  return { from: from.toISOString().slice(0, 10), to };
}

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
 * Tela exclusiva do chefe (Matheus): controle financeiro real da barbearia,
 * separado do caixa/faturamento padrão em /admin/financeiro. Aqui ele lança,
 * visualiza e gerencia as despesas, e vê o saldo líquido (faturado - gasto).
 */
export default function FinanceiroCompletoPage() {
  const { isChefe, barber } = useBarber();

  const [range, setRange] = useState('mes');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = getRangeDates(range);
    const data = await getFullFinanceOverview({ from, to });
    setOverview(data);
    setLoading(false);
  }, [range]);

  useEffect(() => {
    if (isChefe) load();
  }, [isChefe, load]);

  function handleSheetClose() {
    setSheetOpen(false);
    setEditing(null);
    load();
  }

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
    <div className="px-4 pt-4">
      <div className="flex gap-2 mb-4">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-colors ${
              range === r.key
                ? 'bg-accent border-accent text-white'
                : 'border-zinc-700 text-zinc-400'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading || !overview ? (
        <div className="space-y-2.5 mb-4">
          <div className="h-24 rounded-xl bg-surface animate-pulse" />
          <div className="h-16 rounded-xl bg-surface animate-pulse" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-2.5">
            <div className="bg-surface border border-zinc-800 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium mb-1">
                <TrendingUp size={13} /> Faturado
              </div>
              <p className="text-white font-bold text-lg">{formatBRL(overview.totalFaturado)}</p>
            </div>
            <div className="bg-surface border border-zinc-800 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-red-400 text-xs font-medium mb-1">
                <TrendingDown size={13} /> Despesas
              </div>
              <p className="text-white font-bold text-lg">{formatBRL(overview.totalDespesas)}</p>
            </div>
          </div>

          <div
            className={`bg-surface border rounded-xl p-3.5 mb-4 flex items-center gap-3 ${
              overview.saldoLiquido >= 0 ? 'border-emerald-500/30' : 'border-accent/30'
            }`}
          >
            <div
              className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                overview.saldoLiquido >= 0 ? 'bg-emerald-500/15' : 'bg-accent/15'
              }`}
            >
              <Scale size={16} className={overview.saldoLiquido >= 0 ? 'text-emerald-400' : 'text-accent-light'} />
            </div>
            <div className="flex-1">
              <p className="text-zinc-400 text-xs">Saldo líquido do período</p>
              <p
                className={`font-bold text-base ${
                  overview.saldoLiquido >= 0 ? 'text-emerald-400' : 'text-accent-light'
                }`}
              >
                {formatBRL(overview.saldoLiquido)}
              </p>
            </div>
          </div>

          {Object.keys(overview.porCategoria).length > 0 && (
            <div className="flex gap-2 mb-5 overflow-x-auto -mx-1 px-1 pb-1">
              {Object.entries(overview.porCategoria).map(([cat, total]) => (
                <div
                  key={cat}
                  className="shrink-0 bg-elevated border border-zinc-800 rounded-lg px-3 py-2.5 text-center min-w-[92px]"
                >
                  <p className="text-white text-xs font-semibold">{formatBRL(total)}</p>
                  <p className="text-zinc-500 text-[10px]">{CATEGORY_LABEL[cat] || cat}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <p className="text-zinc-500 text-xs">
              {overview.despesas.length} despesa{overview.despesas.length !== 1 ? 's' : ''} no período
            </p>
            <button
              onClick={() => setSheetOpen(true)}
              className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:bg-accent-dark"
            >
              <Plus size={14} /> Nova despesa
            </button>
          </div>

          <div className="space-y-2">
            {overview.despesas.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center mt-10">
                Nenhuma despesa lançada nesse período.
              </p>
            ) : (
              overview.despesas.map((expense) => (
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
        open={sheetOpen}
        onClose={handleSheetClose}
        expense={editing}
        chefeId={barber.id}
      />
    </div>
  );
}
