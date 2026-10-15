'use client';

import { useMemo, useState } from 'react';
import {
  TrendingUp,
  DollarSign,
  Users,
  ChevronDown,
  ChevronUp,
  Clock,
  Sparkles,
} from 'lucide-react';

/**
 * AgendaDashboardWidget:
 * Dashboard dinâmico de faturamento, taxa de ocupação e performance
 * direto na tela principal da Agenda do Barbeiro.
 */
export default function AgendaDashboardWidget({ appointments = [], isToday = true }) {
  const [expanded, setExpanded] = useState(false);

  // Métricas computadas em tempo real
  const metrics = useMemo(() => {
    const active = appointments.filter((a) => a.status !== 'cancelado');
    const confirmed = appointments.filter((a) => a.status === 'confirmado');
    const pending = appointments.filter((a) => a.status === 'pendente');
    const cancelled = appointments.filter((a) => a.status === 'cancelado');

    // Faturamento previsto e realizado
    const totalEstimated = active.reduce((acc, a) => {
      const price = Number(a.services?.price) || 0;
      return acc + price;
    }, 0);

    const totalPaid = appointments.reduce((acc, a) => {
      if (a.payment_status === 'pago') {
        const price = Number(a.services?.price) || 0;
        return acc + price;
      }
      return acc;
    }, 0);

    // Estimativa de slots do dia (base padrão: 12 atendimentos/dia)
    const totalDailySlots = 12;
    const occupancyPercent = Math.min(
      Math.round((active.length / totalDailySlots) * 100),
      100
    );

    // Ticket médio
    const ticketMedio = active.length > 0 ? totalEstimated / active.length : 0;

    // Distribuição por turnos do dia
    let morningCount = 0;
    let afternoonCount = 0;
    let eveningCount = 0;

    active.forEach((a) => {
      let hour = 12;
      if (a.appointment_time) {
        hour = parseInt(String(a.appointment_time).split(':')[0], 10) || 12;
      } else if (a.appointment_date) {
        hour = new Date(a.appointment_date).getHours();
      } else {
        return;
      }
      if (hour < 12) morningCount++;
      else if (hour < 18) afternoonCount++;
      else eveningCount++;
    });

    const maxPeriod = Math.max(morningCount, afternoonCount, eveningCount, 1);

    return {
      totalAppointments: appointments.length,
      activeCount: active.length,
      confirmedCount: confirmed.length,
      pendingCount: pending.length,
      cancelledCount: cancelled.length,
      totalEstimated,
      totalPaid,
      occupancyPercent,
      ticketMedio,
      periods: {
        morning: { count: morningCount, pct: Math.round((morningCount / maxPeriod) * 100) },
        afternoon: { count: afternoonCount, pct: Math.round((afternoonCount / maxPeriod) * 100) },
        evening: { count: eveningCount, pct: Math.round((eveningCount / maxPeriod) * 100) },
      },
    };
  }, [appointments]);

  const formatCurrency = (val) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="mb-4 bg-[#0f0f0f] border border-zinc-800/80 rounded-2xl overflow-hidden shadow-lg transition-all">
      {/* Barra de Visão Geral Compacta */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="p-3.5 flex items-center justify-between cursor-pointer select-none active:bg-zinc-900/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-red-600/15 border border-red-500/25 flex items-center justify-center text-red-500 shrink-0">
            <TrendingUp size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white text-xs font-bold tracking-tight">
                {isToday ? 'Performance de Hoje' : 'Resumo da Data'}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-950/60 border border-red-800/50 text-red-400 font-semibold">
                {metrics.occupancyPercent}% ocupado
              </span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400 text-[11px] mt-0.5">
              <span>{formatCurrency(metrics.totalEstimated)} previsto</span>
              <span className="text-zinc-600">•</span>
              <span className="text-emerald-400 font-medium">
                {formatCurrency(metrics.totalPaid)} em caixa
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          aria-label={expanded ? 'Recolher detalhes' : 'Expandir métricas'}
          className="text-zinc-500 hover:text-white p-1 rounded-lg"
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* Painel Expansível de Detalhamento e Gráficos */}
      {expanded && (
        <div className="px-3.5 pb-4 pt-1 border-t border-zinc-800/60 space-y-3.5 animate-fade-in">
          {/* Grid de 3 Cards Rápidos */}
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-center">
              <span className="text-[10px] text-zinc-400 block font-medium">Atendimentos</span>
              <span className="text-white font-bold text-sm mt-0.5 block">
                {metrics.activeCount}
                <span className="text-zinc-500 text-[10px] font-normal"> / {metrics.totalAppointments}</span>
              </span>
              <span className="text-[9px] text-emerald-400 font-medium">
                {metrics.confirmedCount} confirmados
              </span>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-center">
              <span className="text-[10px] text-zinc-400 block font-medium">Ticket Médio</span>
              <span className="text-white font-bold text-sm mt-0.5 block">
                {formatCurrency(metrics.ticketMedio)}
              </span>
              <span className="text-[9px] text-zinc-500 font-normal">por cliente</span>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-center">
              <span className="text-[10px] text-zinc-400 block font-medium">A Receber</span>
              <span className="text-amber-400 font-bold text-sm mt-0.5 block">
                {formatCurrency(Math.max(0, metrics.totalEstimated - metrics.totalPaid))}
              </span>
              <span className="text-[9px] text-amber-500/80 font-normal">pendente</span>
            </div>
          </div>

          {/* Barra Gráfica de Ocupação da Cadeira */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-zinc-300 font-medium flex items-center gap-1.5 text-[11px]">
                <Clock size={12} className="text-red-400" />
                Taxa de Ocupação da Grade
              </span>
              <span className="text-red-400 font-bold text-[11px]">
                {metrics.activeCount} vagas preenchidas (~{metrics.occupancyPercent}%)
              </span>
            </div>
            <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-500"
                style={{ width: `${metrics.occupancyPercent}%` }}
              />
            </div>
          </div>

          {/* Mini Gráfico de Barras: Horários por Turno */}
          <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-3">
            <div className="flex items-center justify-between text-[11px] mb-2.5">
              <span className="text-zinc-300 font-medium">Fluxo por Período</span>
              <span className="text-zinc-500 text-[10px]">Pico de agendamentos</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {/* Manhã */}
              <div>
                <div className="flex items-end justify-between text-[10px] text-zinc-400 mb-1">
                  <span>Manhã</span>
                  <span className="font-semibold text-white">{metrics.periods.morning.count}</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500/80 rounded-full"
                    style={{ width: `${metrics.periods.morning.pct}%` }}
                  />
                </div>
              </div>

              {/* Tarde */}
              <div>
                <div className="flex items-end justify-between text-[10px] text-zinc-400 mb-1">
                  <span>Tarde</span>
                  <span className="font-semibold text-white">{metrics.periods.afternoon.count}</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full"
                    style={{ width: `${metrics.periods.afternoon.pct}%` }}
                  />
                </div>
              </div>

              {/* Noite */}
              <div>
                <div className="flex items-end justify-between text-[10px] text-zinc-400 mb-1">
                  <span>Noite</span>
                  <span className="font-semibold text-white">{metrics.periods.evening.count}</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-400 rounded-full"
                    style={{ width: `${metrics.periods.evening.pct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
