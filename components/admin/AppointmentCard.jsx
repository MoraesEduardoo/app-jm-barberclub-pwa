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
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  buildAppointmentReminderWhatsAppMessage,
  getWhatsAppClickToChatUrl,
} from '@/lib/whatsapp';

const STATUS_STYLES = {
  pendente: { label: 'Pendente', className: 'bg-zinc-800 text-zinc-300' },
  pending: { label: 'Pendente', className: 'bg-zinc-800 text-zinc-300' },
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
  busy = false,
}) {
  const status = STATUS_STYLES[appointment.status] || STATUS_STYLES.confirmado;
  const paid = appointment.payment_status === 'pago';
  const isCancelled = appointment.status === 'cancelado' || appointment.status === 'cancelled';
  const isPending = appointment.status === 'pendente' || appointment.status === 'pending';

  // Extração rigorosa do horário local (elimina o desvio de UTC que jogava tudo para 21:00)
  const time = appointment.appointment_time
    ? String(appointment.appointment_time).slice(0, 5)
    : appointment.appointment_date && String(appointment.appointment_date).includes('T')
    ? new Date(appointment.appointment_date).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Fortaleza',
      })
    : '';

  const firstName = appointment.client_name?.trim().split(' ')[0] || 'Cliente';
  const hasPhone = Boolean(appointment.client_phone && appointment.client_phone.length >= 8);

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
    <div className="bg-[#0f0f0f] border border-zinc-800/80 rounded-2xl p-4 shadow-sm hover:border-zinc-700/80 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Header com Horário, Status e Badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-white font-bold text-sm tracking-tight">{time || 'Horário'}</span>

            <span
              className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${status.className}`}
            >
              {status.label}
            </span>

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
            <span className="truncate">{appointment.client_name}</span>
          </div>

          {/* Serviço e Barbeiro */}
          <p className="text-zinc-400 text-xs mt-0.5 font-medium">
            {appointment.services?.name || appointment.service || 'Serviço'}
            {appointment.barbers?.name ? ` · ${appointment.barbers.name}` : ''}
          </p>

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
        {isPending && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChangeStatus(appointment.id, 'confirmado')}
            className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-zinc-900 border border-zinc-700/80 text-xs font-semibold text-white active:scale-95 active:bg-zinc-800 transition-all touch-manipulation disabled:opacity-50"
          >
            <CheckCircle2 size={14} className="text-emerald-400" /> Confirmar
          </button>
        )}

        {!isCancelled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChangeStatus(appointment.id, 'cancelado')}
            className="flex-1 min-w-[90px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-400 active:scale-95 active:bg-zinc-800 transition-all touch-manipulation disabled:opacity-50"
          >
            <XCircle size={14} /> Cancelar
          </button>
        )}

        {!paid && !isCancelled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenPayment(appointment)}
            className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-red-600 hover:bg-red-500 text-xs font-bold text-white shadow-sm active:scale-95 active:bg-red-700 transition-all touch-manipulation disabled:opacity-50"
          >
            <Wallet size={14} /> Cobrar
          </button>
        )}

        {hasPhone && (
          <button
            type="button"
            onClick={handleSendWhatsAppReminder}
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
            onClick={() => onDelete(appointment.id)}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl bg-red-950/30 border border-red-900/50 text-xs font-medium text-red-400 active:scale-95 active:bg-red-900/50 transition-all touch-manipulation disabled:opacity-50"
          >
            <Trash2 size={14} /> Excluir registro
          </button>
        )}
      </div>
    </div>
  );
}
