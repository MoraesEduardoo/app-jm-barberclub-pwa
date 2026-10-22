'use client';

import {
  CheckCircle2,
  XCircle,
  Clock3,
  Wallet,
  User,
  Zap,
  Trash2,
  MessageSquare,
  Crown,
  Clock,
  RefreshCw,
  Sparkles,
  CalendarClock,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  buildAppointmentReminderWhatsAppMessage,
  getWhatsAppClickToChatUrl,
} from '@/lib/whatsapp';
import { isPreScheduledAppointment } from '@/lib/pre-scheduled';

const STATUS_STYLES = {
  pendente: { label: 'Pendente', className: 'bg-zinc-800 text-zinc-300' },
  pending: { label: 'Pendente', className: 'bg-zinc-800 text-zinc-300' },
  pre_scheduled: { label: 'Pré-agendado', className: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' },
  pre_agendado: { label: 'Pré-agendado', className: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' },
  'pre-agendado': { label: 'Pré-agendado', className: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' },
  confirmado: { label: 'Confirmado', className: 'bg-emerald-500/15 text-emerald-400' },
  confirmed: { label: 'Confirmado', className: 'bg-emerald-500/15 text-emerald-400' },
  concluido: { label: 'Concluído', className: 'bg-blue-500/15 text-blue-400' },
  completed: { label: 'Concluído', className: 'bg-blue-500/15 text-blue-400' },
  cancelado: { label: 'Cancelado', className: 'bg-accent/15 text-accent-light' },
  cancelled: { label: 'Cancelado', className: 'bg-accent/15 text-accent-light' },
};

export default function AppointmentCard({
  appointment,
  onChangeStatus,
  onOpenPayment,
  onDelete,
  onOpenPreSchedule,
  busy = false,
}) {
  if (!appointment) return null;

  const isPreScheduled = isPreScheduledAppointment(appointment);
  const statusKey = (appointment.status || 'confirmado').toLowerCase();
  const status = STATUS_STYLES[statusKey] || STATUS_STYLES.confirmado;
  const paid = appointment.payment_status === 'pago';
  const isCancelled = statusKey === 'cancelado' || statusKey === 'cancelled';
  const isPending =
    statusKey === 'pendente' ||
    statusKey === 'pending' ||
    statusKey === 'pre_scheduled' ||
    statusKey === 'pre_agendado' ||
    statusKey === 'pre-agendado';

  // Extração rigorosa do horário local de início (elimina desvios de UTC)
  const time = appointment.appointment_time
    ? String(appointment.appointment_time).slice(0, 5)
    : appointment.appointment_date &&
      String(appointment.appointment_date).includes('T') &&
      !String(appointment.appointment_date).includes('T00:00:00')
    ? new Date(appointment.appointment_date).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Fortaleza',
      })
    : '';

  // Horário de término (end_time real ou fallback de appointment_end_time)
  const endTime = appointment.end_time || appointment.appointment_end_time
    ? String(appointment.end_time || appointment.appointment_end_time).slice(0, 5)
    : '';

  const displayTime = time
    ? (endTime && endTime !== time ? `${time} - ${endTime}` : time)
    : 'Horário a definir';

  const clientName = appointment.client_name?.trim() || 'Cliente';
  const firstName = clientName.split(' ')[0] || 'Cliente';
  const hasPhone = Boolean(appointment.client_phone && String(appointment.client_phone).replace(/\D/g, '').length >= 8);

  // Heurística de cliente recorrente (quando possui telefone e dados completos)
  const isFrequentClient = Boolean(hasPhone && appointment.client_name);

  // Lembrete ESPECÍFICO deste agendamento (100% limpo, sem emojis e com horário correto)
  function handleSendWhatsAppReminder(e) {
    e.stopPropagation();
    if (!appointment.client_phone) {
      toast.warning('Telefone do cliente não cadastrado.');
      return;
    }

    const serviceName =
      appointment.services?.name || appointment.service || 'Corte';
    const barberName = appointment.barbers?.name || '';

    const text = buildAppointmentReminderWhatsAppMessage({
      clientName: appointment.client_name,
      serviceName,
      appointmentDate: appointment.appointment_date,
      appointmentTime: appointment.appointment_time || (time ? `${time}:00` : null),
      barberName,
    });

    const url = getWhatsAppClickToChatUrl(appointment.client_phone, text);
    if (!url) {
      toast.warning('Número de telefone inválido para WhatsApp.');
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    toast.success(`Lembrete de agendamento gerado para ${firstName}!`);
  }

  const durationMin = appointment.duration_minutes || appointment.services?.default_duration_minutes;

  return (
    <div
      onClick={() => {
        if (isPreScheduled && onOpenPreSchedule) {
          onOpenPreSchedule(appointment);
        }
      }}
      className={`rounded-2xl p-4 shadow-sm transition-all ${
        isPreScheduled
          ? 'bg-gradient-to-b from-[#181226] via-[#120f1c] to-[#0d0b14] border-2 border-purple-500/50 shadow-purple-950/30 hover:border-purple-400/70 cursor-pointer ring-1 ring-purple-500/20'
          : 'bg-[#0f0f0f] border border-zinc-800/80 hover:border-zinc-700/80'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Header com Horário, Status e Badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-white font-bold text-sm tracking-tight">{displayTime}</span>

            <span
              className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${status.className}`}
            >
              {status.label}
            </span>

            {isPreScheduled && (
              <span className="flex items-center gap-1 text-[10px] font-bold rounded-full px-2.5 py-0.5 bg-purple-500/25 text-purple-200 border border-purple-400/40 shadow-sm">
                <RefreshCw size={10} className="text-purple-300" />
                <span>🔄 Pré-agendado</span>
              </span>
            )}

            {appointment.is_walk_in && (
              <span className="flex items-center gap-0.5 text-[10px] font-medium rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <Zap size={10} /> Sem hora
              </span>
            )}

            {isFrequentClient && (
              <span className="flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 bg-red-950/50 text-red-400 border border-red-800/40">
                <Crown size={10} /> Cliente Fiel
              </span>
            )}
          </div>

          {/* Nome do Cliente */}
          <div className="flex items-center gap-1.5 mt-2 text-zinc-200 text-sm font-semibold">
            <User size={14} className="text-zinc-500 shrink-0" />
            <span className="truncate">{clientName}</span>
          </div>

          {/* Serviço e Barbeiro */}
          <p className="text-zinc-400 text-xs mt-0.5 font-medium">
            {appointment.services?.name || appointment.service || 'Serviço'}
            {appointment.barbers?.name ? ` · ${appointment.barbers.name}` : ''}
          </p>

          {/* Tag especial de pré-agendamento futuro / chatbot */}
          {isPreScheduled && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-purple-300 font-medium">
              <Sparkles size={12} className="text-purple-400 shrink-0" />
              <span>Recorrência garantida via chatbot</span>
            </div>
          )}

          {/* Duração estimada do atendimento */}
          {durationMin ? (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-zinc-500">
              <Clock size={11} className="text-zinc-500 shrink-0" />
              <span>Duração: ~{durationMin} min</span>
            </div>
          ) : null}

          {/* Foto de Referência */}
          {appointment.reference_photo && (
            <a
              href={appointment.reference_photo.image_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-2.5 inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1.5 pr-3 active:opacity-80"
            >
              <img
                src={appointment.reference_photo.image_url}
                alt=""
                loading="lazy"
                className="h-10 w-10 rounded-lg object-cover"
              />
              <span className="text-[11px] text-zinc-300">
                Referência:{' '}
                <span className="text-white font-medium">
                  {appointment.reference_photo.title}
                </span>
              </span>
            </a>
          )}
        </div>

        {/* Status de Pagamento */}
        <div className="text-right shrink-0">
          {paid ? (
            <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 size={13} /> Pago
            </span>
          ) : (
            <span className="flex items-center gap-1 text-zinc-400 text-xs font-medium px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
              <Clock3 size={13} /> Não pago
            </span>
          )}
        </div>
      </div>

      {/* Botões de Ação */}
      <div className="flex flex-wrap items-center gap-2 mt-3.5 pt-2 border-t border-zinc-800/60">
        {/* Botão de Gestão de Pré-Agendamento */}
        {isPreScheduled && onOpenPreSchedule && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onOpenPreSchedule(appointment);
            }}
            className="flex-1 min-w-[130px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-purple-600/30 hover:bg-purple-600/40 border border-purple-500/50 text-xs font-bold text-purple-200 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
          >
            <CalendarClock size={14} className="text-purple-300" />
            <span>Gerenciar</span>
          </button>
        )}

        {isPending && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onChangeStatus(appointment.id, 'confirmado');
            }}
            className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-zinc-900 border border-zinc-700/80 text-xs font-semibold text-white active:scale-95 active:bg-zinc-800 transition-all touch-manipulation disabled:opacity-50"
          >
            <CheckCircle2 size={14} className="text-emerald-400" /> Confirmar
          </button>
        )}

        {!isCancelled && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onChangeStatus(appointment.id, 'cancelado');
            }}
            className="flex-1 min-w-[90px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-400 active:scale-95 active:bg-zinc-800 transition-all touch-manipulation disabled:opacity-50"
          >
            <XCircle size={14} /> Cancelar
          </button>
        )}

        {!paid && !isCancelled && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onOpenPayment(appointment);
            }}
            className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-bold text-white shadow-sm active:scale-95 active:bg-red-700 transition-all touch-manipulation disabled:opacity-50"
          >
            <Wallet size={14} /> Cobrar
          </button>
        )}

        {hasPhone && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSendWhatsAppReminder(e);
            }}
            title={`Enviar lembrete deste agendamento (${time}) via WhatsApp`}
            className="h-9 px-3 rounded-xl bg-zinc-900/90 border border-zinc-800 hover:border-emerald-500/40 text-zinc-300 hover:text-white text-xs font-medium flex items-center gap-1.5 active:scale-95 active:bg-zinc-800 transition-all touch-manipulation"
          >
            <MessageSquare size={13} className="text-emerald-400" />
            <span>Lembrete</span>
          </button>
        )}

        {isCancelled && onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(appointment.id);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl bg-red-950/30 border border-red-900/50 text-xs font-medium text-red-400 active:scale-95 active:bg-red-900/50 transition-all touch-manipulation disabled:opacity-50"
          >
            <Trash2 size={14} /> Excluir registro
          </button>
        )}
      </div>
    </div>
  );
}
