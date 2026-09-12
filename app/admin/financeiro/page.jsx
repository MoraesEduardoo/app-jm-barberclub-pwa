'use client';

import { useEffect, useState, useCallback } from 'react';
import { QrCode, CreditCard, Banknote, TrendingUp, AlertCircle, Percent } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';
import { PERMISSION_KEYS } from '@/lib/auth';
import { getFinanceSummary } from '@/lib/actions/finance';
import { listTeam } from '@/lib/actions/team';
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
  const [team, setTeam] = useState([]);
  // 'todos' só é uma opção válida pra quem tem MANAGE_FINANCE; barbeiro sem
  // essa permissão sempre fica travado no próprio id (ver useEffect abaixo).
  const [scopeId, setScopeId] = useState(canManageFinance ? 'todos' : barber.id);

  useEffect(() => {
    if (canManageFinance) {
      listTeam().then(setTeam).catch(() => {});
    }
  }, [canManageFinance]);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = getRangeDates(range);
    const scope = canManageFinance ? (scopeId === 'todos' ? null : scopeId) : barber.id;
    const data = await getFinanceSummary({ from, to, scopeBarberId: scope });
    setSummary(data);
    setLoading(false);
  }, [range, scopeId, canManageFinance, barber.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="px-4 pt-4">
      {canManageFinance && team.length > 0 && (
        <div className="mb-3 -mx-1 flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setScopeId('todos')}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
              scopeId === 'todos'
                ? 'bg-accent border-accent text-white'
                : 'border-zinc-700 text-zinc-400'
            }`}
          >
            Todos
          </button>
          {team.map((member) => (
            <button
              key={member.id}
              onClick={() => setScopeId(member.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                scopeId === member.id
                  ? 'bg-accent border-accent text-white'
                  : 'border-zinc-700 text-zinc-400'
              }`}
            >
              {member.name}
            </button>
          ))}
        </div>
      )}

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

          {summary.comissao && (
            <div className="bg-surface border border-accent/30 rounded-xl p-3.5 mb-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                <Percent size={16} className="text-accent-light" />
              </div>
              <div className="flex-1">
                <p className="text-zinc-400 text-xs">
                  Comissão ({summary.comissao.percent}% do faturado)
                </p>
                <p className="text-white font-bold text-base">{formatBRL(summary.comissao.valor)}</p>
              </div>
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
