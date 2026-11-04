'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock3,
  Wallet,
  User,
  Phone,
  Zap,
  MessageSquare,
  Crown,
  Clock,
  RefreshCw,
  CalendarClock,
  ShoppingBag,
  X,
  Scissors,
  Sparkles,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import { toast } from '@/lib/toast';
import {
  buildAppointmentReminderWhatsAppMessage,
  getWhatsAppClickToChatUrl,
} from '@/lib/whatsapp';
import { isPreScheduledAppointment } from '@/lib/pre-scheduled';
import { parseAppointmentNotes } from './AddProductSheet';
import { removeProductFromAppointment } from '@/lib/actions/appointments';
import {
  getAppointmentStartTime,
  getAppointmentEndTime,
  getAppointmentDuration,
} from './AppointmentCard';

const STATUS_BADGE = {
  pendente: {
    label: 'Pendente',
    className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  },
  pending: {
    label: 'Pendente',
    className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  },
  pre_scheduled: {
    label: 'Pré-agendado',
    className: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  },
  pre_agendado: {
    label: 'Pré-agendado',
    className: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  },
  'pre-agendado': {
    label: 'Pré-agendado',
    className: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  },
  confirmado: {
    label: 'Confirmado',
    className: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  },
  confirmed: {
    label: 'Confirmado',
    className: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  },
  concluido: {
    label: 'Concluído',
    className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  },
  concluído: {
    label: 'Concluído',
    className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  },
  completed: {
    label: 'Concluído',
    className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  },
  cancelado: {
    label: 'Cancelado',
    className: 'bg-accent/15 text-accent-light border border-accent/30',
  },
  cancelled: {
    label: 'Cancelado',
    className: 'bg-accent/15 text-accent-light border border-accent/30',
  },
};

export default function AppointmentActionSheet({
  open,
  onClose,
  appointment,
  busy = false,
  onChangeStatus,
  onOpenPayment,
  onAddProduct,
  onEditService,
  onOpenPreSchedule,
  onProductRemoved,
}) {
  const [removingKey, setRemovingKey] = useState(null);

  if (!appointment) return null;

  const isPreScheduled = isPreScheduledAppointment(appointment);
  const statusInfo = STATUS_BADGE[appointment.status] || STATUS_BADGE.confirmado;
  const paid = appointment.payment_status === 'pago';
  const isCancelled =
    appointment.status === 'cancelado' || appointment.status === 'cancelled';
  const isPending =
    appointment.status === 'pendente' ||
    appointment.status === 'pending' ||
    appointment.status === 'pre_scheduled' ||
    appointment.status === 'pre_agendado' ||
    appointment.status === 'pre-agendado';

  const startTime = getAppointmentStartTime(appointment);
  const durationMin = getAppointmentDuration(appointment);
  const endTime = getAppointmentEndTime(appointment, startTime, durationMin);

  const firstName = appointment.client_name?.trim().split(' ')[0] || 'Cliente';
  const hasPhone = Boolean(
    appointment.client_phone && appointment.client_phone.replace(/\D/g, '').length >= 8
  );
  const isFrequentClient = Boolean(hasPhone && appointment.client_name);

  const totalAmount = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );
  const { cleanNotes, products: attachedProducts } = parseAppointmentNotes(
    appointment.notes
  );
  const productsSubtotal = attachedProducts.reduce(
    (acc, item) => acc + Number(item.subtotal || 0),
    0
  );
  const serviceBaseAmount = Math.max(
    0,
    Number((totalAmount - productsSubtotal).toFixed(2))
  );

  const serviceName =
    appointment.services?.name || appointment.service || 'Serviço';
  const barberName = appointment.barbers?.name || '';

  function handleSendWhatsAppReminder() {
    if (!appointment.client_phone) {
      toast.warning('Telefone do cliente não cadastrado.');
      return;
    }

    const text = buildAppointmentReminderWhatsAppMessage({
      clientName: appointment.client_name,
      serviceName,
      appointmentDate: appointment.appointment_date,
      appointmentTime:
        appointment.appointment_time || (startTime ? `${startTime}:00` : null),
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

  async function handleRemoveProduct(item) {
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

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Detalhes do Agendamento"
    >
      <div className="space-y-4">
        {/* Bloco Principal: Horário, Status e Cliente */}
        <div className="rounded-2xl bg-[#070709] border border-zinc-800/90 p-4 space-y-3">
          {/* Topo: Faixa de Horário + Status de Pagamento */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-sm font-bold text-white bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-lg">
                <Clock size={13} className="text-accent-light" />
                {startTime} – {endTime}
              </span>
              <span className="text-xs text-zinc-500 font-mono tabular-nums">
                {durationMin} min
              </span>
            </div>

            {paid ? (
              <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                <CheckCircle2 size={13} /> Pago
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-300 text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25">
                <Clock3 size={13} /> A receber
              </span>
            )}
          </div>

          {/* Cliente e Telefone */}
          <div className="pt-1 border-t border-zinc-800/70 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <User size={15} className="text-zinc-400 shrink-0" />
                <h3 className="text-base font-bold text-white truncate">
                  {appointment.client_name || 'Cliente'}
                </h3>
              </div>
              {appointment.client_phone && (
                <p className="text-xs text-zinc-400 font-mono tabular-nums mt-1 flex items-center gap-1.5">
                  <Phone size={12} className="text-zinc-500" />
                  {appointment.client_phone}
                </p>
              )}
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              <span
                className={`text-[10px] font-semibold rounded-md px-2 py-0.5 ${statusInfo.className}`}
              >
                {statusInfo.label}
              </span>
              {isFrequentClient && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-light">
                  <Crown size={10} /> Cliente Fiel
                </span>
              )}
              {appointment.is_walk_in && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
                  <Zap size={10} /> Encaixe / Sem hora
                </span>
              )}
            </div>
          </div>

          {/* Resumo do Serviço e Valor */}
          <div className="pt-2.5 border-t border-zinc-800/70 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-500">Serviço selecionado</p>
              <p className="text-sm font-semibold text-zinc-100 truncate">
                {serviceName}
                {barberName ? (
                  <span className="text-zinc-400 font-normal"> · {barberName}</span>
                ) : null}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] text-zinc-500">Total</p>
              <p className="text-base font-bold text-white font-mono tabular-nums">
                R$ {totalAmount.toFixed(2).replace('.', ',')}
              </p>
            </div>
          </div>

          {isPreScheduled && (
            <div className="pt-2 border-t border-zinc-800/70 flex items-center gap-1.5 text-xs text-blue-300 font-medium">
              <RefreshCw size={12} className="text-blue-400 shrink-0" />
              <span>Pré-agendamento recorrente garantido via chatbot</span>
            </div>
          )}

          {cleanNotes && (
            <div className="pt-2 border-t border-zinc-800/70">
              <p className="text-xs text-zinc-300 bg-zinc-900/90 border border-zinc-800 rounded-xl px-3 py-2 italic">
                {cleanNotes}
              </p>
            </div>
          )}

          {/* Foto de Referência se existir */}
          {appointment.reference_photo && (
            <div className="pt-2 border-t border-zinc-800/70">
              <a
                href={appointment.reference_photo.image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1.5 pr-3 active:opacity-80"
              >
                <img
                  src={appointment.reference_photo.image_url}
                  alt={appointment.reference_photo.title || 'Referência de corte'}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="h-10 w-10 rounded-lg object-cover"
                />
                <span className="text-xs text-zinc-300">
                  Referência:{' '}
                  <span className="text-white font-semibold">
                    {appointment.reference_photo.title}
                  </span>
                </span>
              </a>
            </div>
          )}
        </div>

        {/* Lista de Produtos Vinculados ao Atendimento */}
        {attachedProducts.length > 0 && (
          <div className="rounded-2xl bg-[#070709] border border-zinc-800/90 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold">
                <ShoppingBag size={13} /> Produtos no Atendimento
              </span>
              {serviceBaseAmount > 0 && (
                <span className="text-zinc-500 font-mono tabular-nums text-[11px]">
                  Serviço: R$ {serviceBaseAmount.toFixed(2).replace('.', ',')}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {attachedProducts.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-2 text-xs bg-black/70 border border-zinc-800/80 rounded-xl px-3 py-2"
                >
                  <span className="text-zinc-200 font-medium truncate">
                    {item.label}
                  </span>
                  {!isCancelled && (
                    <button
                      type="button"
                      onClick={() => handleRemoveProduct(item)}
                      disabled={removingKey === item.key}
                      title="Remover produto e devolver ao estoque"
                      className="h-7 w-7 flex items-center justify-center text-zinc-400 hover:text-rose-400 rounded-lg hover:bg-zinc-900 transition-colors shrink-0"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Painel de Ações do Atendimento */}
        {!isCancelled && (
          <div className="space-y-2.5 pt-1">
            {/* CTA Principal: Cobrar Atendimento */}
            {!paid && onOpenPayment && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onClose();
                  onOpenPayment(appointment);
                }}
                className="w-full h-12 rounded-xl bg-accent hover:bg-accent-light active:bg-accent-dark text-white font-bold text-sm flex items-center justify-center gap-2 shadow-accent-glow active:scale-[0.99] transition-all touch-manipulation disabled:opacity-50"
              >
                <Wallet size={17} className="shrink-0" />
                <span>
                  Cobrar Atendimento (R$ {totalAmount.toFixed(2).replace('.', ',')})
                </span>
              </button>
            )}

            {/* Linha de Edição Rápida: + Produto e Editar Serviço */}
            <div className="grid grid-cols-2 gap-2.5">
              {onAddProduct && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onClose();
                    onAddProduct(appointment);
                  }}
                  className="h-11 px-3 rounded-xl bg-[#0c0c10] hover:bg-zinc-900 border border-amber-500/35 text-xs font-semibold text-amber-300 flex items-center justify-center gap-2 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                >
                  <ShoppingBag size={15} className="text-amber-400 shrink-0" />
                  <span className="truncate">+ Produto</span>
                </button>
              )}

              {onEditService && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onClose();
                    onEditService(appointment);
                  }}
                  className="h-11 px-3 rounded-xl bg-[#0c0c10] hover:bg-zinc-900 border border-blue-500/35 text-xs font-semibold text-blue-200 hover:text-white flex items-center justify-center gap-2 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                >
                  <Scissors size={15} className="text-blue-400 shrink-0" />
                  <span className="truncate">Editar Serviço</span>
                </button>
              )}
            </div>

            {/* Ações de Pré-Agendamento / Confirmação */}
            {(isPreScheduled || isPending) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {isPreScheduled && onOpenPreSchedule && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onClose();
                      onOpenPreSchedule(appointment);
                    }}
                    className="h-11 px-3 rounded-xl bg-blue-950/40 hover:bg-blue-950/60 border border-blue-500/40 text-xs font-bold text-blue-200 flex items-center justify-center gap-2 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                  >
                    <CalendarClock size={15} className="text-blue-400 shrink-0" />
                    <span>Gerenciar Pré-Agendamento</span>
                  </button>
                )}

                {isPending && onChangeStatus && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onChangeStatus(appointment.id, 'confirmado');
                      onClose();
                    }}
                    className="h-11 px-3 rounded-xl bg-emerald-950/30 hover:bg-emerald-950/50 border border-emerald-500/40 text-xs font-semibold text-emerald-300 flex items-center justify-center gap-2 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                  >
                    <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                    <span>Confirmar Presença</span>
                  </button>
                )}
              </div>
            )}

            {/* Linha Inferior: Lembrete WhatsApp e Cancelar Agendamento */}
            <div
              className={`grid gap-2.5 ${
                hasPhone ? 'grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {hasPhone && (
                <button
                  type="button"
                  onClick={handleSendWhatsAppReminder}
                  className="h-11 px-3 rounded-xl bg-[#0c0c10] hover:bg-zinc-900 border border-zinc-800 hover:border-emerald-500/40 text-xs font-semibold text-zinc-200 hover:text-white flex items-center justify-center gap-2 active:scale-95 transition-all touch-manipulation"
                >
                  <MessageSquare size={15} className="text-emerald-400 shrink-0" />
                  <span>Lembrete</span>
                </button>
              )}

              {onChangeStatus && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onChangeStatus(appointment.id, 'cancelado');
                    onClose();
                  }}
                  className="h-11 px-3 rounded-xl bg-[#0c0c10] hover:bg-red-950/30 border border-zinc-800 hover:border-accent/40 text-xs font-semibold text-zinc-400 hover:text-accent-light flex items-center justify-center gap-2 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                >
                  <XCircle size={15} className="text-accent-light shrink-0" />
                  <span>Cancelar</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
