'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock3,
  Wallet,
  User,
  Zap,
  MessageSquare,
  Crown,
  Clock,
  RefreshCw,
  Sparkles,
  CalendarClock,
  ShoppingBag,
  Plus,
  X,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  buildAppointmentReminderWhatsAppMessage,
  getWhatsAppClickToChatUrl,
} from '@/lib/whatsapp';
import { isPreScheduledAppointment } from '@/lib/pre-scheduled';
import { parseAppointmentNotes } from './AddProductSheet';
import { removeProductFromAppointment } from '@/lib/actions/appointments';

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
  onOpenPreSchedule,
  onAddProduct,
  onProductRemoved,
  busy = false,
}) {
  const [removingKey, setRemovingKey] = useState(null);

  const isPreScheduled = isPreScheduledAppointment(appointment);
  const status = STATUS_STYLES[appointment.status] || STATUS_STYLES.confirmado;
  const paid = appointment.payment_status === 'pago';
  const isCancelled = appointment.status === 'cancelado' || appointment.status === 'cancelled';
  const isPending =
    appointment.status === 'pendente' ||
    appointment.status === 'pending' ||
    appointment.status === 'pre_scheduled' ||
    appointment.status === 'pre_agendado' ||
    appointment.status === 'pre-agendado';

  // Extração rigorosa do horário local (elimina o desvio de UTC que jogava tudo para 21:00)
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

  const firstName = appointment.client_name?.trim().split(' ')[0] || 'Cliente';
  const hasPhone = Boolean(appointment.client_phone && appointment.client_phone.length >= 8);

  // Heurística de cliente recorrente (quando possui telefone e dados completos)
  const isFrequentClient = Boolean(hasPhone && appointment.client_name);

  // Valor total atualizado do atendimento (serviço + eventuais produtos vinculados)
  const totalAmount = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );
  const { cleanNotes, products: attachedProducts } = parseAppointmentNotes(appointment.notes);

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

  async function handleRemoveProduct(e, item) {
    e.stopPropagation();
    if (removingKey) return;
    setRemovingKey(item.key);
    try {
      const res = await removeProductFromAppointment({
        appointmentId: appointment.id,
        rawLine: item.rawLine,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success('Produto removido e devolvido ao estoque.');
      if (onProductRemoved) {
        onProductRemoved(res);
      }
    } catch {
      toast.error('Não foi possível remover o produto.');
    } finally {
      setRemovingKey(null);
    }
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
            <span className="text-white font-bold text-sm tracking-tight">{time || 'Horário'}</span>

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
            <span className="truncate">{appointment.client_name}</span>
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

          {/* Observações normais do cliente */}
          {cleanNotes ? (
            <p className="text-[11px] text-zinc-400 mt-1.5 italic bg-zinc-900/70 border border-zinc-800/70 rounded-lg px-2.5 py-1">
              {cleanNotes}
            </p>
          ) : null}

          {/* Produtos vinculados ao atendimento */}
          {attachedProducts.length > 0 && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-2.5 bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 space-y-1.5"
            >
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                  <ShoppingBag size={11} /> Produto(s) adicionado(s)
                </span>
                {appointment.services?.price != null && (
                  <span className="text-zinc-500">
                    Serviço: R$ {Number(appointment.services.price).toFixed(2).replace('.', ',')}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {attachedProducts.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-2 text-[11px] bg-black/60 border border-zinc-800/80 rounded-lg px-2 py-1"
                  >
                    <span className="text-zinc-200 font-medium truncate">{item.label}</span>
                    {!paid && !isCancelled && (
                      <button
                        type="button"
                        onClick={(e) => handleRemoveProduct(e, item)}
                        disabled={removingKey === item.key}
                        title="Remover produto e devolver ao estoque"
                        className="text-zinc-500 hover:text-rose-400 p-0.5 rounded transition-colors shrink-0"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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

        {/* Status de Pagamento + Valor Total */}
        <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
          {paid ? (
            <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 size={13} /> Pago
            </span>
          ) : (
            <span className="flex items-center gap-1 text-zinc-400 text-xs font-medium px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
              <Clock3 size={13} /> Não pago
            </span>
          )}
          {totalAmount > 0 && (
            <span className="text-white font-bold text-xs px-1">
              R$ {totalAmount.toFixed(2).replace('.', ',')}
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

        {!isCancelled && onAddProduct && !paid && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onAddProduct(appointment);
            }}
            className="flex-1 min-w-[125px] flex items-center justify-center gap-1.5 h-9 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-amber-500/40 text-xs font-semibold text-amber-300 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
          >
            <ShoppingBag size={13} className="text-amber-400" />
            <Plus size={11} className="-ml-1 text-amber-400" />
            <span>Produto</span>
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

        {hasPhone && !isCancelled && (
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
      </div>
    </div>
  );
}
