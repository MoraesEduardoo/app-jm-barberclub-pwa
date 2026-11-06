'use client';

import { CheckCircle2, ShoppingBag, Sparkles, Zap, ChevronRight } from 'lucide-react';
import { isPreScheduledAppointment } from '@/lib/pre-scheduled';
import { parseAppointmentNotes } from './AddProductSheet';

/**
 * Converte "HH:MM" em minutos desde 00:00.
 */
export function timeStrToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null;
  const [hStr, mStr] = timeStr.slice(0, 5).split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * Converte minutos desde 00:00 para "HH:MM".
 */
export function minutesToTimeStr(totalMinutes) {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '';
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Extrai o horário de início ("HH:MM") do agendamento no fuso America/Fortaleza.
 */
export function getAppointmentStartTime(appointment) {
  if (!appointment) return '';
  if (appointment.appointment_time) {
    return String(appointment.appointment_time).slice(0, 5);
  }
  if (
    appointment.appointment_date &&
    String(appointment.appointment_date).includes('T') &&
    !String(appointment.appointment_date).includes('T00:00:00')
  ) {
    return new Date(appointment.appointment_date).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Fortaleza',
    });
  }
  return '';
}

/**
 * Obtém a duração em minutos do agendamento (padrão 30 min).
 */
export function getAppointmentDuration(appointment) {
  const raw =
    appointment?.duration_minutes ??
    appointment?.services?.duration_minutes ??
    appointment?.services?.default_duration_minutes ??
    30;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/**
 * Obtém o horário de término ("HH:MM") do agendamento.
 */
export function getAppointmentEndTime(
  appointment,
  startTime = getAppointmentStartTime(appointment),
  durationMin = getAppointmentDuration(appointment)
) {
  if (appointment?.end_time) {
    return String(appointment.end_time).slice(0, 5);
  }
  const startMinutes = timeStrToMinutes(startTime);
  if (startMinutes === null) return '';
  return minutesToTimeStr(startMinutes + durationMin);
}

/**
 * Gera marcações intermediárias de 30 em 30 minutos para agendamentos longos
 * na coluna esquerda da linha do tempo.
 */
function getIntermediateTicks(startTime, durationMin) {
  const startMin = timeStrToMinutes(startTime);
  if (startMin === null || durationMin < 45) return [];
  const endMin = startMin + durationMin;
  const ticks = [];
  let cursor = Math.ceil((startMin + 15) / 30) * 30;
  while (cursor <= endMin - 15) {
    ticks.push(minutesToTimeStr(cursor));
    cursor += 30;
  }
  return ticks;
}

export default function AppointmentCard({
  appointment,
  onSelect,
  isLast = false,
  closingTime = '20:30',
  busy = false,
}) {
  const isPreScheduled = isPreScheduledAppointment(appointment);
  const paid = appointment.payment_status === 'pago';
  const rawStatus = (appointment.status || 'confirmado').toLowerCase().trim();
  const isCompleted =
    paid ||
    rawStatus === 'concluido' ||
    rawStatus === 'concluído' ||
    rawStatus === 'completed';
  const isPending =
    rawStatus === 'pendente' ||
    rawStatus === 'pending' ||
    isPreScheduled;

  const startTime = getAppointmentStartTime(appointment);
  const durationMin = getAppointmentDuration(appointment);
  const endTime = getAppointmentEndTime(appointment, startTime, durationMin);
  const intermediateTicks = getIntermediateTicks(startTime, durationMin);

  const endMin = timeStrToMinutes(endTime);
  const closeMin = timeStrToMinutes(closingTime) ?? 20 * 60 + 30;
  const reachesClosingTime = endMin !== null && endMin >= closeMin;
  const showEndOfShiftHighlight = isLast || reachesClosingTime;

  const serviceName =
    appointment.services?.name || appointment.service || 'Serviço';
  const barberName = appointment.barbers?.name || '';

  const totalAmount = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );
  const { products: attachedProducts } = parseAppointmentNotes(appointment.notes);

  // Altura proporcional à duração na linha do tempo (ex: 30min -> 78px, 60min -> 118px)
  const blockMinHeight = Math.max(76, Math.min(164, Math.round(durationMin * 1.95 + 18)));

  // Estilização OLED Dark com acentos em Azul Profundo, Vermelho Escarlate, Zinco e Esmeralda
  let cardSurfaceClass =
    'bg-[#080d18] border-blue-500/35 hover:border-blue-400/60 hover:bg-[#0b1222]';
  let nodeDotClass = 'bg-accent border-black ring-2 ring-accent/30';
  let timeBadgeClass = 'text-blue-300/90';
  let statusLabel = 'Confirmado';
  let statusTextClass = 'text-blue-400';

  if (isCompleted) {
    cardSurfaceClass =
      'bg-[#06090f] border-zinc-800/90 hover:border-emerald-500/40 hover:bg-[#090e17]';
    nodeDotClass = 'bg-emerald-400 border-black ring-2 ring-emerald-500/25';
    timeBadgeClass = 'text-emerald-400/90';
    statusLabel = paid ? 'Pago' : 'Concluído';
    statusTextClass = 'text-emerald-400';
  } else if (isPreScheduled) {
    cardSurfaceClass =
      'bg-[#0b0914] border-purple-500/40 hover:border-purple-400/65 hover:bg-[#100d1d]';
    nodeDotClass = 'bg-purple-400 border-black ring-2 ring-purple-500/25';
    timeBadgeClass = 'text-purple-300/90';
    statusLabel = 'Pré-agendado';
    statusTextClass = 'text-purple-300';
  } else if (isPending) {
    cardSurfaceClass =
      'bg-[#11080a] border-accent/45 hover:border-accent-light/70 hover:bg-[#170b0d]';
    nodeDotClass = 'bg-accent border-black ring-2 ring-accent/35';
    timeBadgeClass = 'text-accent-light';
    statusLabel = 'Pendente';
    statusTextClass = 'text-accent-light';
  }

  // Destaque especial no último agendamento / fecho do expediente
  if (showEndOfShiftHighlight && !isPreScheduled) {
    cardSurfaceClass = isCompleted
      ? 'bg-gradient-to-br from-[#070b12] via-[#090d14] to-[#120709] border-emerald-500/40 hover:border-emerald-400/65'
      : 'bg-gradient-to-br from-[#090d18] via-[#0c0a12] to-[#16070a] border-accent/50 hover:border-accent-light/75';
  }

  return (
    <div className="relative flex items-stretch gap-3 sm:gap-4 select-none">
      {/* Coluna Esquerda: Eixo Vertical de Horários da Timeline */}
      <div className="w-14 sm:w-16 shrink-0 flex flex-col items-end pr-2 relative">
        {/* Linha Conectora Vertical */}
        <div
          className={`absolute right-0 top-2.5 w-px ${
            isLast
              ? 'bottom-2 bg-gradient-to-b from-zinc-700 via-accent/40 to-transparent'
              : '-bottom-3 bg-zinc-800/90'
          }`}
        />

        {/* Nó indicador no eixo */}
        <span
          className={`absolute -right-[4.5px] top-2.5 h-2.5 w-2.5 rounded-full border ${nodeDotClass} z-10`}
        />

        {/* Horário de Início */}
        <span className="font-mono tabular-nums text-xs sm:text-[13px] font-bold text-white leading-none mt-1">
          {startTime || '--:--'}
        </span>

        {/* Marcações intermediárias se o bloco ocupar 45+ min */}
        {intermediateTicks.length > 0 && (
          <div className="flex-1 flex flex-col justify-evenly items-end py-2">
            {intermediateTicks.map((tick) => (
              <span
                key={tick}
                className="font-mono tabular-nums text-[10px] font-medium text-zinc-600 leading-none"
              >
                {tick}
              </span>
            ))}
          </div>
        )}

        {/* Horário de Término na base do bloco (destacado quando encerra o expediente) */}
        {endTime && (
          <span
            className={`mt-auto pb-1.5 font-mono tabular-nums text-[10px] leading-none ${
              showEndOfShiftHighlight
                ? 'font-bold text-accent-light'
                : 'font-medium text-zinc-500'
            }`}
          >
            {endTime}
          </span>
        )}
      </div>

      {/* Coluna Direita: Bloco Enxuto do Agendamento (Clicável para abrir Modal/Drawer) */}
      <div className="flex-1 min-w-0 pb-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelect && onSelect(appointment)}
          style={{ minHeight: `${blockMinHeight}px` }}
          className={`w-full text-left rounded-2xl border px-3.5 py-3 transition-all duration-150 flex flex-col justify-between group active:scale-[0.99] touch-manipulation ${cardSurfaceClass} ${
            busy ? 'opacity-60 pointer-events-none' : ''
          }`}
        >
          {/* Topo: Nome do Cliente + Preço / Status */}
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="text-white font-bold text-sm sm:text-[15px] tracking-tight truncate">
                  {appointment.client_name || 'Cliente'}
                </h3>
                {appointment.is_walk_in && (
                  <span
                    title="Atendimento sem hora marcada"
                    className="inline-flex items-center text-[10px] font-semibold text-amber-400 shrink-0"
                  >
                    <Zap size={11} />
                  </span>
                )}
                {isPreScheduled && (
                  <span
                    title="Pré-agendamento recorrente"
                    className="inline-flex items-center text-[10px] font-semibold text-purple-300 shrink-0"
                  >
                    <Sparkles size={11} />
                  </span>
                )}
              </div>

              {/* Serviço + Barbeiro */}
              <p className="text-zinc-300 text-xs font-medium truncate mt-0.5">
                {serviceName}
                {barberName ? (
                  <span className="text-zinc-500 font-normal"> · {barberName}</span>
                ) : null}
              </p>
            </div>

            {/* Valor e Indicador de Clique */}
            <div className="shrink-0 flex items-center gap-1.5">
              <div className="text-right">
                {totalAmount > 0 && (
                  <div className="font-mono tabular-nums text-xs sm:text-[13px] font-bold text-white leading-tight">
                    R$ {totalAmount.toFixed(2).replace('.', ',')}
                  </div>
                )}
                <div className={`flex items-center justify-end gap-1 text-[10px] font-semibold ${statusTextClass}`}>
                  {paid && <CheckCircle2 size={10} className="shrink-0" />}
                  <span>{statusLabel}</span>
                </div>
              </div>
              <ChevronRight
                size={15}
                className="text-zinc-600 group-hover:text-zinc-300 transition-colors shrink-0"
              />
            </div>
          </div>

          {/* Rodapé Enxuto do Bloco: Intervalo de Horário + Duração + Indicador de Produtos */}
          <div className="mt-2 pt-1.5 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 font-mono tabular-nums">
              <span className={`font-semibold ${timeBadgeClass}`}>
                {startTime && endTime
                  ? `${startTime} – ${endTime}`
                  : startTime || 'Sem horário'}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400">{durationMin} min</span>
            </div>

            {attachedProducts.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300/90">
                <ShoppingBag size={10} className="text-amber-400 shrink-0" />
                +{attachedProducts.length} {attachedProducts.length === 1 ? 'prod.' : 'prods.'}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-zinc-500 group-hover:text-zinc-300 transition-colors">
                Ver ações
              </span>
            )}
          </div>

          {/* Rodapé Especial de Fecho do Expediente no Último Atendimento */}
          {showEndOfShiftHighlight && endTime && (
            <div className="mt-2 pt-2 border-t border-accent/20 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-200 tracking-tight truncate">
                🏁 Fim do Expediente • Encerrado às{' '}
                <span className="font-mono tabular-nums text-accent-light font-bold">
                  {endTime}
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-mono tabular-nums text-zinc-400">
                {reachesClosingTime ? 'Fecho da barbearia' : 'Último do dia'}
              </span>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
