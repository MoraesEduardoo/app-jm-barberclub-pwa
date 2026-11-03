'use client';

import { useMemo, useState } from 'react';
import {
  Wallet,
  CheckCircle2,
  Clock3,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { isPreScheduledAppointment } from '@/lib/pre-scheduled';
import { calculateAppointmentFinance } from '@/lib/commission';

function getAppointmentAmount(a) {
  return calculateAppointmentFinance(a, a?.barbers).totalAmount;
}

function getAppointmentCommission(a) {
  return calculateAppointmentFinance(a, a?.barbers).commissionAmount;
}

/**
 * AgendaDashboardWidget:
 * Resumo e Status Financeiro do Dia (Quem Pagou vs. Quem Não Pagou)
 * posicionado no topo da Agenda do Barbeiro em padrão Dark Theme OLED (#000000).
 */
export default function AgendaDashboardWidget({ appointments = [], isToday = true }) {
  const [expanded, setExpanded] = useState(false);

  const metrics = useMemo(() => {
    const active = appointments.filter((a) => {
      const st = String(a.status || 'confirmado').toLowerCase().trim();
      return st !== 'cancelado' && st !== 'cancelled';
    });

    const confirmed = active.filter((a) => {
      const st = String(a.status || 'confirmado').toLowerCase().trim();
      return st === 'confirmado' || st === 'confirmed';
    });

    const paidList = active.filter((a) => a.payment_status === 'pago');
    const unpaidList = active.filter((a) => a.payment_status !== 'pago');
    const preScheduledCount = active.filter(isPreScheduledAppointment).length;

    const totalEstimated = active.reduce((acc, a) => acc + getAppointmentAmount(a), 0);
    const totalPaid = paidList.reduce((acc, a) => acc + getAppointmentAmount(a), 0);
    const totalPending = unpaidList.reduce((acc, a) => acc + getAppointmentAmount(a), 0);

    const paidCommission = paidList.reduce((acc, a) => acc + getAppointmentCommission(a), 0);
    const pendingCommission = unpaidList.reduce((acc, a) => acc + getAppointmentCommission(a), 0);

    const paidCount = paidList.length;
    const unpaidCount = unpaidList.length;

    const paidPercent =
      active.length > 0 ? Math.round((paidCount / active.length) * 100) : 0;

    const ticketMedio = active.length > 0 ? totalEstimated / active.length : 0;

    // Distribuição por turnos do dia
    let morningCount = 0;
    let afternoonCount = 0;
    let eveningCount = 0;

    active.forEach((a) => {
      let hour = 12;
      if (a.appointment_time) {
        hour = parseInt(String(a.appointment_time).split(':')[0], 10) || 12;
      } else if (
        a.appointment_date &&
        String(a.appointment_date).includes('T') &&
        !String(a.appointment_date).includes('T00:00:00')
      ) {
        try {
          const d = new Date(a.appointment_date);
          hour =
            parseInt(
              d.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                timeZone: 'America/Fortaleza',
                hour12: false,
              }),
              10
            ) || 12;
        } catch {
          hour = 12;
        }
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
      paidCount,
      unpaidCount,
      totalEstimated,
      totalPaid,
      totalPending,
      paidCommission,
      pendingCommission,
      paidPercent,
      ticketMedio,
      preScheduledCount,
      periods: {
        morning: { count: morningCount, pct: Math.round((morningCount / maxPeriod) * 100) },
        afternoon: { count: afternoonCount, pct: Math.round((afternoonCount / maxPeriod) * 100) },
        evening: { count: eveningCount, pct: Math.round((eveningCount / maxPeriod) * 100) },
      },
    };
  }, [appointments]);

  const formatCurrency = (val) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

  return (
    <div className="mb-4 bg-[#09090b] border border-zinc-800/90 rounded-2xl overflow-hidden shadow-lg transition-all">
      {/* Cabeçalho Principal + Status Financeiro Instantâneo */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="p-3.5 cursor-pointer select-none active:bg-zinc-900/50 transition-colors space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-red-600/15 border border-red-500/25 flex items-center justify-center text-red-500 shrink-0">
              <Wallet size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white text-xs font-bold tracking-tight">
                  {isToday ? 'Status Financeiro de Hoje' : 'Status Financeiro da Data'}
                </span>
                <span className="text-[11px] text-zinc-400 font-medium">
                  · {metrics.activeCount} atendimento{metrics.activeCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 text-zinc-400 text-[11px] mt-0.5">
                <span>Total do dia: <strong className="text-white">{formatCurrency(metrics.totalEstimated)}</strong></span>
                {metrics.preScheduledCount > 0 && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span className="text-purple-300 font-medium">
                      {metrics.preScheduledCount} pré-agendado{metrics.preScheduledCount > 1 ? 's' : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label={expanded ? 'Recolher detalhes' : 'Expandir métricas'}
            className="text-zinc-500 hover:text-white p-1 rounded-lg shrink-0"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {/* Cards Visuais: Quem Pagou (Verde) vs. Quem Não Pagou / Pendentes (Amarelo/Vermelho) */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-emerald-950/25 border border-emerald-500/30 rounded-xl px-3 py-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                <CheckCircle2 size={12} />
                Pagos
              </span>
              <span className="text-[10px] font-semibold text-emerald-300">
                {metrics.paidCount} {metrics.paidCount === 1 ? 'cliente' : 'clientes'}
              </span>
            </div>
            <p className="text-white font-bold text-sm mt-1">
              {formatCurrency(metrics.totalPaid)}
            </p>
          </div>

          <div className="bg-amber-950/25 border border-amber-500/30 rounded-xl px-3 py-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-400">
                <Clock3 size={12} />
                A Receber
              </span>
              <span className="text-[10px] font-semibold text-amber-300">
                {metrics.unpaidCount} {metrics.unpaidCount === 1 ? 'pendente' : 'pendentes'}
              </span>
            </div>
            <p className="text-white font-bold text-sm mt-1">
              {formatCurrency(metrics.totalPending)}
            </p>
          </div>
        </div>

        {/* Barra de Progresso de Pagamentos (Quem Pagou vs. Quem Não Pagou) */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-zinc-400 font-medium">
              Progresso do Caixa ({metrics.paidCount}/{metrics.activeCount} pagos)
            </span>
            <span className="text-emerald-400 font-bold">
              {metrics.paidPercent}% recebido
            </span>
          </div>
          <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-800 flex">
            {metrics.activeCount > 0 && (
              <>
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${metrics.paidPercent}%` }}
                />
                <div
                  className="h-full bg-amber-500/60 transition-all duration-500"
                  style={{ width: `${Math.max(0, 100 - metrics.paidPercent)}%` }}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Painel Expansível de Detalhamento */}
      {expanded && (
        <div className="px-3.5 pb-4 pt-2 border-t border-zinc-800/60 space-y-3 animate-fade-in">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-2.5 text-center">
              <span className="text-[10px] text-zinc-400 block font-medium">Atendimentos</span>
              <span className="text-white font-bold text-sm mt-0.5 block">
                {metrics.activeCount}
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
              <span className="text-[10px] text-zinc-400 block font-medium">Previsto Total</span>
              <span className="text-white font-bold text-sm mt-0.5 block">
                {formatCurrency(metrics.totalEstimated)}
              </span>
              <span className="text-[9px] text-zinc-500 font-normal">no dia</span>
            </div>
          </div>

          {/* Mini Gráfico de Barras: Horários por Turno */}
          <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-3">
            <div className="flex items-center justify-between text-[11px] mb-2.5">
              <span className="text-zinc-300 font-medium">Fluxo por Período</span>
              <span className="text-zinc-500 text-[10px]">Distribuição no dia</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
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
