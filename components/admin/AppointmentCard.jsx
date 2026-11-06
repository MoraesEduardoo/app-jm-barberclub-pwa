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
  const showEndOfShiftHighlight = isLast && reachesClosingTime;

  const serviceName =
    appointment.services?.name || appointment.service || 'Serviço';
  const barberName = appointment.barbers?.name || '';

  const totalAmount = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );
  const { products: attachedProducts } = parseAppointmentNotes(appointment.notes);

  // Altura proporcional à duração na linha do tempo vertical (ex: 30min -> 88px, 60min -> 128px)
  const blockMinHeight = Math.max(86, Math.min(168, Math.round(durationMin * 1.85 + 30)));

  // Paleta rigorosa OLED Dark: Preto dominante, Zinco refinado e Acentos da marca (Vermelho/Esmeralda)
  let cardSurfaceClass =
    'bg-[#0b0b0e] border-zinc-800/95 hover:border-zinc-700 hover:bg-[#101015] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
  let nodeDotClass = 'bg-accent border-black ring-2 ring-accent/30';
  let timeRangeClass = 'text-zinc-200';
  let statusLabel = 'Confirmado';
  let statusTextClass = 'text-zinc-300';
  let statusDotColor = 'bg-accent';

  if (isCompleted) {
    cardSurfaceClass =
      'bg-[#080c0a] border-emerald-900/50 hover:border-emerald-700/60 hover:bg-[#0b110e] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
    nodeDotClass = 'bg-emerald-400 border-black ring-2 ring-emerald-500/25';
    timeRangeClass = 'text-emerald-300/95';
    statusLabel = paid ? 'Pago' : 'Concluído';
    statusTextClass = 'text-emerald-400';
    statusDotColor = 'bg-emerald-400';
  } else if (isPreScheduled) {
    cardSurfaceClass =
      'bg-[#0d0914] border-purple-500/35 hover:border-purple-400/60 hover:bg-[#120d1c] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
    nodeDotClass = 'bg-purple-400 border-black ring-2 ring-purple-500/25';
    timeRangeClass = 'text-purple-300/95';
    statusLabel = 'Pré-agendado';
    statusTextClass = 'text-purple-300';
    statusDotColor = 'bg-purple-400';
  } else if (isPending) {
    cardSurfaceClass =
      'bg-[#110809] border-accent/45 hover:border-accent-light/70 hover:bg-[#170b0d] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
    nodeDotClass = 'bg-accent-light border-black ring-2 ring-accent/35';
    timeRangeClass = 'text-accent-light';
    statusLabel = 'Pendente';
    statusTextClass = 'text-accent-light';
    statusDotColor = 'bg-accent-light';
  }

  return (
    <div className="relative flex items-stretch gap-3 sm:gap-4 select-none">
      {/* Coluna Esquerda: Régua Vertical de Horários da Timeline */}
      <div className="w-14 sm:w-16 shrink-0 flex flex-col justify-between items-end pr-3 py-2 relative">
        {/* Linha Conectora Contínua do Bloco Ocupado */}
        <div
          className={`absolute right-0 top-0 w-px ${
            isLast
              ? 'bottom-2 bg-gradient-to-b from-zinc-700 via-zinc-800 to-transparent'
              : 'bottom-0 bg-zinc-800'
          }`}
        />

        {/* Nó Principal do Agendamento no Eixo */}
        <span
          className={`absolute -right-[4.5px] top-3.5 h-2.5 w-2.5 rounded-full border ${nodeDotClass} z-10`}
        />

        {/* Horário de Início */}
        <span className="font-mono tabular-nums text-xs sm:text-[13px] font-bold text-white leading-none pt-1">
          {startTime || '--:--'}
        </span>

        {/* Marcações intermediárias para blocos longos (45+ min) */}
        {intermediateTicks.length > 0 && (
          <div className="flex flex-col items-end gap-1 my-1">
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

        {/* Horário de Término na base do bloco */}
        {endTime && (
          <span
            className={`font-mono tabular-nums text-[10px] leading-none pb-1 ${
              showEndOfShiftHighlight
                ? 'font-bold text-accent-light'
                : 'font-medium text-zinc-500'
            }`}
          >
            {endTime}
          </span>
        )}
      </div>

      {/* Coluna Direita: Bloco Vertical Estruturado do Agendamento */}
      <div className="flex-1 min-w-0 py-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelect && onSelect(appointment)}
          style={{ minHeight: `${blockMinHeight}px` }}
          className={`w-full text-left rounded-2xl border px-4 py-3 transition-all duration-150 flex flex-col justify-between group active:scale-[0.992] touch-manipulation ${cardSurfaceClass} ${
            busy ? 'opacity-60 pointer-events-none' : ''
          }`}
        >
          {/* Linha 1: Faixa de Horário + Duração (Esquerda) e Status do Atendimento (Direita) */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-800/70">
            <div className="flex items-center gap-1.5 font-mono tabular-nums text-[11px]">
              <span className={`font-bold ${timeRangeClass}`}>
                {startTime && endTime
                  ? `${startTime} – ${endTime}`
                  : startTime || 'Sem horário'}
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400 font-medium">{durationMin} min</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {attachedProducts.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300/90">
                  <ShoppingBag size={10} className="text-amber-400 shrink-0" />
                  +{attachedProducts.length} {attachedProducts.length === 1 ? 'prod.' : 'prods.'}
                </span>
              )}
              <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${statusTextClass}`}>
                {paid ? (
                  <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotColor} shrink-0`} />
                )}
                <span>{statusLabel}</span>
              </div>
            </div>
          </div>

          {/* Linha 2: Identificação do Cliente, Serviço/Profissional e Valor Total */}
          <div className="flex items-center justify-between gap-3 pt-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="text-white font-bold text-sm sm:text-[15px] tracking-tight truncate">
                  {appointment.client_name || 'Cliente'}
                </h3>
                {appointment.is_walk_in && (
                  <span
                    title="Encaixe / Sem hora marcada"
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

              <p className="text-zinc-400 text-xs font-medium truncate mt-0.5">
                <span className="text-zinc-200">{serviceName}</span>
                {barberName ? (
                  <span className="text-zinc-500 font-normal"> · {barberName}</span>
                ) : null}
              </p>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {totalAmount > 0 && (
                <div className="text-right">
                  <div className="font-mono tabular-nums text-sm sm:text-[15px] font-bold text-white leading-none">
                    R$ {totalAmount.toFixed(2).replace('.', ',')}
                  </div>
                  <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors">
                    Detalhes
                  </span>
                </div>
              )}
              <ChevronRight
                size={16}
                className="text-zinc-600 group-hover:text-zinc-300 transition-colors shrink-0"
              />
            </div>
          </div>

          {/* Linha 3 (Condicional): Destaque Especial de Fecho quando o último atendimento encerra o expediente */}
          {showEndOfShiftHighlight && endTime && (
            <div className="mt-2.5 pt-2 border-t border-accent/20 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-200 tracking-tight truncate">
                🏁 Fim do Expediente • Encerrado às{' '}
                <span className="font-mono tabular-nums text-accent-light font-bold">
                  {endTime}
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-mono tabular-nums text-zinc-400">
                Fecho do dia
              </span>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
