'use client';

import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Scissors,
  Percent,
  AlertCircle,
  Calendar,
  Clock,
  Loader2,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import { getBarberCashHistory } from '@/lib/actions/team';
import { useRouter } from 'next/navigation';

function formatBRL(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace('.', ',')}`;
}

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '';
  }
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return '';
  }
}

/**
 * TeamMemberCashSheet:
 * Histórico de Caixa, Faturamento e Comissões acumuladas do colaborador.
 * Permite alternar entre "Hoje" e "Mês Atual", visualizando cortes realizados,
 * valores recebidos e lista completa de atendimentos.
 */
export default function TeamMemberCashSheet({ open, onClose, member }) {
  const router = useRouter();
  const [period, setPeriod] = useState('today'); // 'today' | 'month'
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open || !member?.id) return;

    let active = true;
    setLoading(true);

    getBarberCashHistory(member.id, period)
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Erro ao carregar caixa do colaborador:', err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, member?.id, period]);

  if (!member) return null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`Caixa de ${member.name}`}
    >
      <div className="space-y-4">
        {/* Seletor de período: Hoje vs Mês Atual */}
        <div className="flex bg-surface border border-zinc-800 rounded-xl p-1 gap-1">
          <button
            type="button"
            onClick={() => setPeriod('today')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all touch-manipulation select-none ${
              period === 'today'
                ? 'bg-accent text-white shadow-sm'
                : 'text-zinc-400 active:text-white'
            }`}
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => setPeriod('month')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all touch-manipulation select-none ${
              period === 'month'
                ? 'bg-accent text-white shadow-sm'
                : 'text-zinc-400 active:text-white'
            }`}
          >
            Mês atual
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-zinc-500">
            <Loader2 size={24} className="animate-spin text-accent" />
            <span className="text-xs">Calculando faturamento e comissões…</span>
          </div>
        ) : !data ? (
          <p className="text-center text-zinc-500 py-8 text-xs">
            Não foi possível carregar os dados financeiros.
          </p>
        ) : (
          <>
            {/* Cards de Métricas Principais */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Total Faturado */}
              <div className="bg-surface border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium mb-1">
                  <TrendingUp size={13} /> Faturado
                </div>
                <p className="text-white font-bold text-lg">
                  {formatBRL(data.totalFaturado)}
                </p>
                <p className="text-zinc-500 text-[10px] mt-0.5">
                  em serviços pagos
                </p>
              </div>

              {/* Comissão Acumulada */}
              <div className="bg-surface border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-accent-light text-xs font-medium mb-1">
                  <Percent size={13} /> Comissão ({data.commissionPercent}%)
                </div>
                <p className="text-white font-bold text-lg">
                  {formatBRL(data.comissaoAcumulada)}
                </p>
                <p className="text-zinc-500 text-[10px] mt-0.5">
                  a repassar ao barbeiro
                </p>
              </div>

              {/* Cortes / Atendimentos Realizados */}
              <div className="bg-surface border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-zinc-300 text-xs font-medium mb-1">
                  <Scissors size={13} /> Cortes pagos
                </div>
                <p className="text-white font-bold text-lg">
                  {data.totalCortes}
                </p>
                <p className="text-zinc-500 text-[10px] mt-0.5">
                  {period === 'today' ? 'atendimentos hoje' : 'no mês'}
                </p>
              </div>

              {/* Pendente / A receber */}
              <div className="bg-surface border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium mb-1">
                  <AlertCircle size={13} /> A receber
                </div>
                <p className="text-white font-bold text-lg">
                  {formatBRL(data.totalPendente)}
                </p>
                <p className="text-zinc-500 text-[10px] mt-0.5">
                  não finalizados
                </p>
              </div>
            </div>

            {/* Lista dos Atendimentos */}
            <div className="pt-2">
              <h4 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2.5 flex items-center justify-between">
                <span>Atendimentos ({data.appointments.length})</span>
                <span className="text-zinc-500 text-[11px] font-normal lowercase">
                  taxa: {data.commissionPercent}%
                </span>
              </h4>

              {data.appointments.length === 0 ? (
                <div className="bg-surface/50 border border-zinc-800/80 rounded-xl py-8 text-center text-zinc-500 text-xs">
                  Nenhum atendimento registrado neste período.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5 overscroll-contain">
                  {data.appointments.map((a) => {
                    const isPago = a.payment_status === 'pago';
                    return (
                      <div
                        key={a.id}
                        className="bg-surface border border-zinc-800/90 rounded-xl p-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-white font-semibold truncate">
                              {a.client_name || 'Cliente'}
                            </span>
                            {a.is_walk_in && (
                              <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[9.5px] text-zinc-400">
                                sem hora
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
                            <span>{a.services?.name || 'Serviço'}</span>
                            <span>•</span>
                            <span className="flex items-center gap-0.5 text-zinc-500">
                              <Clock size={10} />
                              {formatTime(a.appointment_date)}
                              {period === 'month' && ` (${formatDate(a.appointment_date)})`}
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className="text-white font-bold">
                            {formatBRL(a.amount)}
                          </p>
                          <div className="flex items-center justify-end gap-1.5 mt-0.5">
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                isPago
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-amber-500/10 text-amber-400'
                              }`}
                            >
                              {isPago ? 'Pago' : 'Pendente'}
                            </span>
                            {isPago && (
                              <span className="text-[10px] text-zinc-400 font-medium">
                                comissão: {formatBRL(a.commission_value)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Ação rápida para ver no Painel Financeiro */}
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push('/admin/financeiro');
              }}
              className="w-full flex items-center justify-center gap-1.5 bg-elevated border border-zinc-700/80 rounded-xl py-3 text-xs font-semibold text-white active:bg-zinc-900 transition-all touch-manipulation"
            >
              <span>Abrir no Caixa Geral</span>
              <ChevronRight size={14} className="text-zinc-400" />
            </button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
