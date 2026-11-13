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
  // Reservado exclusivamente para o último agendamento que coincide com o fecho real do expediente (ex: 20:30)
  const showEndOfShiftHighlight = Boolean(isLast && reachesClosingTime);
  // Corte individual concluído: destaca o horário final em azul (ex: 08:30)
  const showCompletedEndTimeBlue = Boolean(isCompleted && !showEndOfShiftHighlight);

  const serviceName =
    appointment.services?.name || appointment.service || 'Serviço';
  const barberName = appointment.barbers?.name || '';

  const totalAmount = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );
  const { products: attachedProducts } = parseAppointmentNotes(appointment.notes);

  // Altura proporcional à duração na linha do tempo vertical (ex: 30min -> 88px, 60min -> 128px)
  const blockMinHeight = Math.max(86, Math.min(168, Math.round(durationMin * 1.85 + 30)));

  const isFiado =
    !paid &&
    (appointment.payment_method === 'fiado' ||
      rawStatus === 'concluido' ||
      rawStatus === 'concluído' ||
      rawStatus === 'completed');

  // Padronização de Cores na Linha do Tempo (v2.8.2):
  // - Pago: Verde (emerald)
  // - Fiado: Amarelo (amber)
  // - Confirmado: Azul (blue)
  let cardSurfaceClass =
    'bg-[#070c15] border-blue-500/40 hover:border-blue-400/65 hover:bg-[#0a1220] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
  let nodeDotClass = 'bg-blue-400 border-black ring-2 ring-blue-500/30';
  let startTimeClass = 'text-blue-200';
  let statusLabel = 'Confirmado';
  let statusTextClass = 'text-blue-400';
  let statusDotColor = 'bg-blue-400';
  let completedIconColor = 'text-blue-400';

  if (paid) {
    // Pago -> Verde
    cardSurfaceClass =
      'bg-[#06120c] border-emerald-500/45 hover:border-emerald-400/70 hover:bg-[#091a11] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
    nodeDotClass = 'bg-emerald-400 border-black ring-2 ring-emerald-500/30';
    startTimeClass = 'text-emerald-200';
    statusLabel = 'Pago';
    statusTextClass = 'text-emerald-400';
    statusDotColor = 'bg-emerald-400';
    completedIconColor = 'text-emerald-400';
  } else if (isFiado) {
    // Fiado -> Amarelo
    cardSurfaceClass =
      'bg-[#130f05] border-amber-500/45 hover:border-amber-400/70 hover:bg-[#1a1407] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
    nodeDotClass = 'bg-amber-400 border-black ring-2 ring-amber-500/30';
    startTimeClass = 'text-amber-200';
    statusLabel = 'Fiado';
    statusTextClass = 'text-amber-400';
    statusDotColor = 'bg-amber-400';
    completedIconColor = 'text-amber-400';
  } else if (isPreScheduled) {
    cardSurfaceClass =
      'bg-[#0d0914] border-purple-500/35 hover:border-purple-400/60 hover:bg-[#120d1c] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
    nodeDotClass = 'bg-purple-400 border-black ring-2 ring-purple-500/25';
    startTimeClass = 'text-purple-300/95';
    statusLabel = 'Pré-agendado';
    statusTextClass = 'text-purple-300';
    statusDotColor = 'bg-purple-400';
  } else if (isPending) {
    cardSurfaceClass =
      'bg-[#110809] border-accent/45 hover:border-accent-light/70 hover:bg-[#170b0d] shadow-[0_2px_12px_rgba(0,0,0,0.65)]';
    nodeDotClass = 'bg-accent-light border-black ring-2 ring-accent/35';
    startTimeClass = 'text-accent-light';
    statusLabel = 'Pendente';
    statusTextClass = 'text-accent-light';
    statusDotColor = 'bg-accent-light';
  }

  if (showEndOfShiftHighlight) {
    cardSurfaceClass =
      'bg-gradient-to-br from-[#0b0b0e] via-[#100a0c] to-[#18070a] border-accent/55 hover:border-accent-light/80 shadow-[0_2px_14px_rgba(220,38,38,0.18)]';
  }

  return (
    <div className="relative flex items-stretch gap-3 sm:gap-4 select-none">
      {/* Coluna Esquerda: Régua Vertical de Horários da Timeline */}
      <div className="w-14 sm:w-16 shrink-0 flex flex-col justify-between items-end pr-3 py-2 relative">
        {/* Linha Conectora Contínua do Bloco Ocupado */}
        <div
          className={`absolute right-0 top-0 w-px ${
            showEndOfShiftHighlight
              ? 'bottom-2 bg-gradient-to-b from-zinc-700 via-accent/60 to-accent'
              : paid
              ? 'bottom-0 bg-gradient-to-b from-zinc-800 via-emerald-500/45 to-emerald-500/75'
              : isFiado
              ? 'bottom-0 bg-gradient-to-b from-zinc-800 via-amber-500/45 to-amber-500/75'
              : showCompletedEndTimeBlue
              ? 'bottom-0 bg-gradient-to-b from-zinc-800 via-blue-500/40 to-blue-500/70'
              : isLast
              ? 'bottom-2 bg-gradient-to-b from-zinc-700 via-zinc-800 to-transparent'
              : 'bottom-0 bg-gradient-to-b from-zinc-800 via-blue-500/30 to-zinc-800'
          }`}
        />

        {/* Nó de Início do Agendamento no Eixo */}
        <span
          className={`absolute -right-[4.5px] top-3.5 h-2.5 w-2.5 rounded-full border ${nodeDotClass} z-10`}
        />

        {/* Nó de Encerramento no Eixo */}
        {(showCompletedEndTimeBlue || showEndOfShiftHighlight || paid || isFiado) && (
          <span
            className={`absolute -right-[4px] bottom-3 h-2 w-2 rounded-full border border-black z-10 ${
              showEndOfShiftHighlight
                ? 'bg-accent-light ring-2 ring-accent/35'
                : paid
                ? 'bg-emerald-400 ring-2 ring-emerald-500/30'
                : isFiado
                ? 'bg-amber-400 ring-2 ring-amber-500/30'
                : 'bg-blue-400 ring-2 ring-blue-500/30'
            }`}
          />
        )}

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

        {/* Horário Final na base do bloco */}
        {endTime && (
          <span
            className={`font-mono tabular-nums text-[10px] leading-none ${
              showEndOfShiftHighlight
                ? 'font-bold text-accent-light bg-accent/15 border border-accent/40 px-1.5 py-0.5 rounded-md shadow-[0_0_8px_rgba(220,38,38,0.2)]'
                : paid
                ? 'font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/35 px-1.5 py-0.5 rounded-md shadow-[0_0_8px_rgba(16,185,129,0.18)]'
                : isFiado
                ? 'font-bold text-amber-400 bg-amber-500/15 border border-amber-500/35 px-1.5 py-0.5 rounded-md shadow-[0_0_8px_rgba(245,158,11,0.18)]'
                : showCompletedEndTimeBlue
                ? 'font-bold text-blue-400 bg-blue-500/15 border border-blue-500/35 px-1.5 py-0.5 rounded-md shadow-[0_0_8px_rgba(59,130,246,0.18)]'
                : 'font-medium text-blue-300/80 pb-1'
            }`}
          >
            {endTime}
          </span>
        )}
      </div>

      {/* Coluna Direita: Bloco Vertical Estruturado do Agendamento */}
      <div className="flex-1 min-w-0 py-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSelect && onSelect(appointment)}
          style={{ minHeight: `${blockMinHeight}px` }}
          className={`w-full text-left rounded-2xl border p-3 transition-all duration-150 flex flex-col justify-between group active:scale-[0.992] touch-manipulation ${cardSurfaceClass} ${
            busy ? 'opacity-60 pointer-events-none' : ''
          }`}
        >
          {/* Linha 1: Faixa de Horário + Duração (Esquerda) e Status do Atendimento (Direita) */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-800/70">
            <div className="flex items-center gap-1.5 font-mono tabular-nums text-[11px]">
              {startTime && endTime ? (
                <span className="font-bold">
                  <span className={startTimeClass}>{startTime}</span>
                  <span className="text-zinc-600 mx-1">–</span>
                  <span
                    className={
                      showEndOfShiftHighlight
                        ? 'text-accent-light font-extrabold'
                        : paid
                        ? 'text-emerald-400 font-extrabold'
                        : isFiado
                        ? 'text-amber-400 font-extrabold'
                        : showCompletedEndTimeBlue
                        ? 'text-blue-400 font-extrabold'
                        : startTimeClass
                    }
                  >
                    {endTime}
                  </span>
                </span>
              ) : startTime ? (
                <span className={`font-bold ${startTimeClass}`}>{startTime}</span>
              ) : (
                <span className="px-2 py-0.5 rounded-md bg-zinc-800/95 border border-zinc-700 text-zinc-200 font-semibold text-[10px]">
                  Sem hora
                </span>
              )}
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400 font-medium">{durationMin} min</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {attachedProducts.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300/90">
                  <ShoppingBag size={10} className="text-amber-400 shrink-0" />
                  +{attachedProducts.length}
                </span>
              )}
              {paid ? (
                <span
                  title="Pago"
                  aria-label="Pago"
                  className="inline-flex items-center justify-center text-emerald-400"
                >
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                </span>
              ) : (
                <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${statusTextClass}`}>
                  {isCompleted ? (
                    <CheckCircle2 size={12} className={`${completedIconColor} shrink-0`} />
                  ) : (
                    <span className={`h-1.5 w-1.5 rounded-full ${statusDotColor} shrink-0`} />
                  )}
                  <span>{statusLabel}</span>
                </div>
              )}
            </div>
          </div>

          {/* Linha 2: Identificação do Cliente, Serviço/Profissional e Valor Total */}
          <div className="flex items-center justify-between gap-2 pt-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="text-white font-bold text-sm sm:text-[15px] tracking-tight truncate">
                  {appointment.client_name || 'Cliente'}
                </h3>
                {appointment.is_walk_in && (
                  <span
                    title="Encaixe"
                    className="inline-flex items-center text-[10px] font-semibold text-amber-400 shrink-0"
                  >
                    <Zap size={11} />
                  </span>
                )}
                {isPreScheduled && (
                  <span
                    title="Pré-agendado"
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

            <div className="shrink-0 flex items-center gap-1.5">
              {totalAmount > 0 && (
                <div className="font-mono tabular-nums text-sm sm:text-[15px] font-bold text-white leading-none">
                  R$ {totalAmount.toFixed(2).replace('.', ',')}
                </div>
              )}
              <ChevronRight
                size={15}
                className="text-zinc-500 group-hover:text-zinc-200 transition-colors shrink-0"
              />
            </div>
          </div>

          {/* Linha 3 (Exclusiva para o Fecho Real do Expediente, ex: 20:30) */}
          {showEndOfShiftHighlight && endTime && (
            <div className="mt-2 pt-2 border-t border-accent/25 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-zinc-200 tracking-tight truncate">
                🏁 Fim do Expediente •{' '}
                <span className="font-mono tabular-nums text-accent-light font-bold">
                  {endTime}
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-mono tabular-nums font-semibold text-accent-light">
                Fecho
              </span>
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
