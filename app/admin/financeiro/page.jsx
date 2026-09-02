'use client';

import { useEffect, useState, useCallback } from 'react';
import { QrCode, CreditCard, Banknote, TrendingUp, AlertCircle } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import { PERMISSION_KEYS } from '@/lib/auth';
import { getFinanceSummary } from '@/lib/actions/finance';
import FinanceRow from '@/components/admin/FinanceRow';

const RANGES = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'semana', label: 'Semana' },
  { key: 'mes', label: 'Mês' },
];

const METHOD_ICON = { pix: QrCode, cartao: CreditCard, dinheiro: Banknote };
const METHOD_LABEL = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };

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

export default function FinanceiroPage() {
  const { barber, can } = useBarber();
  const canManageFinance = can(PERMISSION_KEYS.MANAGE_FINANCE);

  const [range, setRange] = useState('hoje');
  const [tab, setTab] = useState('pagos');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = getRangeDates(range);
    const scope = canManageFinance ? null : barber.id;
    const data = await getFinanceSummary({ from, to, scopeBarberId: scope });
    setSummary(data);
    setLoading(false);
  }, [range, canManageFinance, barber.id]);

  useEffect(() => {
    load();
  }, [load]);

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

      {loading || !summary ? (
        <div className="h-24 rounded-xl bg-surface animate-pulse mb-4" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <div className="bg-surface border border-zinc-800 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium mb-1">
                <TrendingUp size={13} /> Faturado
              </div>
              <p className="text-white font-bold text-lg">{formatBRL(summary.totalFaturado)}</p>
              <p className="text-zinc-500 text-[11px]">{summary.pagos.length} pagamento(s)</p>
            </div>
            <div className="bg-surface border border-zinc-800 rounded-xl p-3.5">
              <div className="flex items-center gap-1.5 text-accent-light text-xs font-medium mb-1">
                <AlertCircle size={13} /> A receber
              </div>
              <p className="text-white font-bold text-lg">{formatBRL(summary.totalPendente)}</p>
              <p className="text-zinc-500 text-[11px]">{summary.pendentes.length} pendente(s)</p>
            </div>
          </div>

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
                    <p className="text-white text-xs font-semibold">{formatBRL(total)}</p>
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
              onClick={() => setTab('pagos')}
              className={`flex-1 pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === 'pagos'
                  ? 'border-accent text-white'
                  : 'border-transparent text-zinc-500'
              }`}
            >
              Quem pagou ({summary.pagos.length})
            </button>
            <button
              onClick={() => setTab('pendentes')}
              className={`flex-1 pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === 'pendentes'
                  ? 'border-accent text-white'
                  : 'border-transparent text-zinc-500'
              }`}
            >
              Quem não pagou ({summary.pendentes.length})
            </button>
          </div>

          <div className="space-y-2">
            {(tab === 'pagos' ? summary.pagos : summary.pendentes).length === 0 ? (
              <p className="text-zinc-600 text-sm text-center mt-10">
                {tab === 'pagos' ? 'Nenhum pagamento registrado.' : 'Ninguém pendente. 🎉'}
              </p>
            ) : (
              (tab === 'pagos' ? summary.pagos : summary.pendentes).map((appointment) => (
                <FinanceRow
                  key={appointment.id}
                  appointment={appointment}
                  variant={tab === 'pagos' ? 'paid' : 'pending'}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
