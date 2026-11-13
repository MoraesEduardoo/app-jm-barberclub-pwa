'use client';

import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock3,
  Wallet,
  User,
  Phone,
  Zap,
  MessageCircle,
  Crown,
  Clock,
  RefreshCw,
  CalendarClock,
  ShoppingBag,
  Coffee,
  X,
  Scissors,
  Copy,
  Check,
  ArrowUpDown,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import { toast } from '@/lib/toast';
import {
  buildAppointmentReminderWhatsAppMessage,
  getWhatsAppClickToChatUrl,
  formatPhoneBR,
} from '@/lib/whatsapp';
import { isPreScheduledAppointment } from '@/lib/pre-scheduled';
import { parseAppointmentNotes } from './AddProductSheet';
import { removeProductFromAppointment } from '@/lib/actions/appointments';
import { useBarber } from '@/lib/barber-context';
import { isChefe } from '@/lib/auth';
import { isOwnerBarber } from '@/lib/commission';
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
  onCompleteFiado,
  onAddProduct,
  onAddConvenience,
  onEditService,
  onMoveAppointment,
  onOpenPreSchedule,
  onProductRemoved,
}) {
  const { barber } = useBarber();
  const isChief = isChefe(barber) || isOwnerBarber(barber);

  const [removingKey, setRemovingKey] = useState(null);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setCopiedPhone(false);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    }
  }, [open, appointment?.id]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (!appointment) return null;

  const isPreScheduled = isPreScheduledAppointment(appointment);
  const statusInfo = STATUS_BADGE[appointment.status] || STATUS_BADGE.confirmado;
  const paid = appointment.payment_status === 'pago';
  const rawStatus = String(appointment.status || '').toLowerCase().trim();
  const isCompleted =
    paid ||
    rawStatus === 'concluido' ||
    rawStatus === 'concluído' ||
    rawStatus === 'completed';
  const isFiado = !paid && (appointment.payment_method === 'fiado' || isCompleted);
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
  const {
    cleanNotes,
    products: attachedProducts,
    regularProducts,
    convenienceProducts,
  } = parseAppointmentNotes(appointment.notes);

  const productsSubtotal = attachedProducts.reduce(
    (acc, item) => acc + Number(item.subtotal || 0),
    0
  );
  const serviceBaseAmount = Math.max(
    0,
    Number((totalAmount - productsSubtotal).toFixed(2))
  );

  const serviceName =
    appointment.service || appointment.services?.name || 'Serviço';
  const barberName = appointment.barbers?.name || '';
  const formattedPhone = formatPhoneBR(appointment.client_phone) || appointment.client_phone;

  async function handleCopyPhone() {
    const textToCopy = formattedPhone || String(appointment.client_phone || '').trim();
    if (!textToCopy) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    } catch {
      // Fallback silencioso
    }

    setCopiedPhone(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopiedPhone(false);
    }, 1500);
  }

  function handleSendWhatsAppReminder() {
    if (!appointment.client_phone) {
      toast.warning('Telefone não cadastrado.');
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
      toast.warning('Telefone inválido.');
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    toast.success(`Lembrete enviado para ${firstName}!`);
  }

  async function handleRemoveProduct(item) {
    if (removingKey) return;
    if (item.isConvenience && !isChief) {
      toast.warning('Restrito ao Barbeiro Chefe.');
      return;
    }
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
      toast.success('Item removido.');
      if (onProductRemoved) {
        onProductRemoved(res);
      }
    } catch {
      toast.error('Erro ao remover item.');
    } finally {
      setRemovingKey(null);
    }
  }

  const visibleRegularProducts = regularProducts;
  const visibleConvenienceProducts = isChief ? convenienceProducts : [];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Atendimento"
    >
      <div className="space-y-3">
        {/* Bloco Principal: Horário, Status e Cliente */}
        <div className="rounded-2xl bg-zinc-950 border border-zinc-800/90 p-3 space-y-2.5">
          {/* Topo: Faixa de Horário + Botão Rápido Mover + Status */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-xs font-bold text-white bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-lg">
                <Clock size={12} className="text-accent-light" />
                {startTime} – {endTime}
              </span>
              <span className="text-xs text-zinc-500 font-mono tabular-nums">
                {durationMin} min
              </span>
              {!isCancelled && onMoveAppointment && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onClose();
                    onMoveAppointment(appointment);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/90 hover:border-accent/50 text-[11px] font-semibold text-zinc-200 hover:text-white active:scale-95 transition-all touch-manipulation"
                >
                  <ArrowUpDown size={11} className="text-accent-light shrink-0" />
                  <span>Mover</span>
                </button>
              )}
            </div>

            {paid ? (
              <span
                title="Pago"
                className="inline-flex items-center gap-1 text-emerald-400 text-xs font-semibold px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30"
              >
                <CheckCircle2 size={13} className="text-emerald-400" />
              </span>
            ) : isFiado ? (
              <span className="inline-flex items-center gap-1 text-amber-300 text-xs font-semibold px-2 py-0.5 rounded-lg bg-amber-500/15 border border-amber-500/35">
                <Clock3 size={12} /> Fiado
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-lg ${statusInfo.className}`}>
                <Clock3 size={12} /> {statusInfo.label}
              </span>
            )}
          </div>

          {/* Cliente e Telefone */}
          <div className="pt-2 border-t border-zinc-800/70 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <User size={14} className="text-zinc-400 shrink-0" />
                <h3 className="text-sm font-bold text-white truncate">
                  {appointment.client_name || 'Cliente'}
                </h3>
              </div>
              {appointment.client_phone && (
                <button
                  type="button"
                  onClick={handleCopyPhone}
                  title="Copiar telefone"
                  aria-label={`Copiar telefone ${formattedPhone}`}
                  className={`mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 -ml-2 rounded-lg text-xs font-mono tabular-nums transition-all active:scale-95 touch-manipulation select-none group ${
                    copiedPhone
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
                  }`}
                >
                  {copiedPhone ? (
                    <>
                      <Check size={11} className="text-emerald-400 shrink-0" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Phone size={11} className="text-zinc-500 group-hover:text-zinc-300 shrink-0" />
                      <span>{formattedPhone}</span>
                      <Copy
                        size={10}
                        className="text-zinc-500 group-hover:text-zinc-300 transition-colors shrink-0"
                      />
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              {isFrequentClient && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-light">
                  <Crown size={10} /> Fiel
                </span>
              )}
              {appointment.is_walk_in && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
                  <Zap size={10} /> Encaixe
                </span>
              )}
            </div>
          </div>

          {/* Resumo do Serviço e Valor */}
          <div className="pt-2 border-t border-zinc-800/70 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Serviço</p>
              <p className="text-xs font-semibold text-zinc-100 truncate">
                {serviceName}
                {barberName ? (
                  <span className="text-zinc-400 font-normal"> · {barberName}</span>
                ) : null}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Total</p>
              <p className="text-sm font-bold text-white font-mono tabular-nums">
                R$ {totalAmount.toFixed(2).replace('.', ',')}
              </p>
            </div>
          </div>

          {isPreScheduled && (
            <div className="pt-2 border-t border-zinc-800/70 flex items-center gap-1.5 text-[11px] text-blue-300 font-medium">
              <RefreshCw size={11} className="text-blue-400 shrink-0" />
              <span>Pré-agendado</span>
            </div>
          )}

          {cleanNotes && (
            <div className="pt-2 border-t border-zinc-800/70">
              <p className="text-xs text-zinc-300 bg-zinc-900/90 border border-zinc-800 rounded-xl px-2.5 py-1.5 italic">
                {cleanNotes}
              </p>
            </div>
          )}

          {appointment.reference_photo && (
            <div className="pt-2 border-t border-zinc-800/70">
              <a
                href={appointment.reference_photo.image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/90 p-1.5 pr-3 active:opacity-80"
              >
                <img
                  src={appointment.reference_photo.image_url}
                  alt={appointment.reference_photo.title || 'Referência'}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="h-9 w-9 rounded-lg object-cover"
                />
                <span className="text-xs text-white font-semibold truncate">
                  {appointment.reference_photo.title || 'Referência'}
                </span>
              </a>
            </div>
          )}
        </div>

        {/* Lista de Produtos de Barbearia */}
        {visibleRegularProducts.length > 0 && (
          <div className="rounded-2xl bg-zinc-950 border border-zinc-800/90 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold">
                <ShoppingBag size={12} /> Produtos
              </span>
              {serviceBaseAmount > 0 && (
                <span className="text-zinc-500 font-mono tabular-nums text-[11px]">
                  Serv.: R$ {serviceBaseAmount.toFixed(2).replace('.', ',')}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {visibleRegularProducts.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-2 text-xs bg-black border border-zinc-800/80 rounded-xl px-2.5 py-1.5"
                >
                  <span className="text-zinc-200 font-medium truncate">
                    {item.label}
                  </span>
                  {!isCancelled && (
                    <button
                      type="button"
                      onClick={() => handleRemoveProduct(item)}
                      disabled={removingKey === item.key}
                      title="Remover"
                      className="h-6 w-6 flex items-center justify-center text-zinc-400 hover:text-rose-400 rounded-lg hover:bg-zinc-900 transition-colors shrink-0"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lista de Itens de Conveniência (Exclusivo Chefe) */}
        {visibleConvenienceProducts.length > 0 && (
          <div className="rounded-2xl bg-zinc-950 border border-emerald-500/30 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                <Coffee size={12} /> Conveniência
              </span>
              <span className="text-emerald-300/80 font-mono tabular-nums text-[10px] font-semibold">
                100% Caixa
              </span>
            </div>
            <div className="space-y-1.5">
              {visibleConvenienceProducts.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-2 text-xs bg-black border border-emerald-500/20 rounded-xl px-2.5 py-1.5"
                >
                  <span className="text-zinc-200 font-medium truncate">
                    {item.label}
                  </span>
                  {!isCancelled && isChief && (
                    <button
                      type="button"
                      onClick={() => handleRemoveProduct(item)}
                      disabled={removingKey === item.key}
                      title="Remover"
                      className="h-6 w-6 flex items-center justify-center text-zinc-400 hover:text-rose-400 rounded-lg hover:bg-zinc-900 transition-colors shrink-0"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Painel de Ações Compactas (v2.8.2) */}
        {!isCancelled && (
          <div className="space-y-2 pt-0.5">
            {/* Linha Principal de Baixa: Receber + Fiado */}
            {!paid && (
              <div className="flex items-stretch gap-2">
                {onOpenPayment && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onClose();
                      onOpenPayment(appointment);
                    }}
                    className="flex-1 h-11 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/20 active:scale-[0.99] transition-all touch-manipulation disabled:opacity-50"
                  >
                    <Wallet size={15} className="shrink-0" />
                    <span className="truncate">
                      Receber R$ {totalAmount.toFixed(2).replace('.', ',')}
                    </span>
                  </button>
                )}

                {onCompleteFiado && !isFiado && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onCompleteFiado(appointment);
                      onClose();
                    }}
                    title="Concluir no Fiado"
                    className="shrink-0 h-11 px-3.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                  >
                    <Clock3 size={14} className="text-amber-400 shrink-0" />
                    <span>Fiado</span>
                  </button>
                )}
              </div>
            )}

            {isFiado && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-center justify-between gap-2 text-xs text-amber-200">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Clock3 size={13} className="text-amber-400 shrink-0" />
                  Pendente (Fiado)
                </span>
                <span className="font-mono tabular-nums font-bold text-amber-300">
                  R$ {totalAmount.toFixed(2).replace('.', ',')}
                </span>
              </div>
            )}

            {/* Linha Compacta de Ações Secundárias (Outline/Ghost) */}
            <div className="grid grid-cols-2 gap-2">
              {onEditService && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onClose();
                    onEditService(appointment);
                  }}
                  className="h-10 px-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-blue-500/40 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                >
                  <Scissors size={13} className="text-blue-400 shrink-0" />
                  <span className="truncate">Editar</span>
                </button>
              )}

              {onMoveAppointment && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onClose();
                    onMoveAppointment(appointment);
                  }}
                  className="h-10 px-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-accent/40 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                >
                  <ArrowUpDown size={13} className="text-accent-light shrink-0" />
                  <span className="truncate">Mover Horário</span>
                </button>
              )}

              {onAddProduct && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onClose();
                    onAddProduct(appointment);
                  }}
                  className="h-10 px-2.5 rounded-xl bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 hover:border-amber-500/40 text-xs font-semibold text-zinc-200 flex items-center justify-center gap-1.5 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                >
                  <ShoppingBag size={13} className="text-amber-400 shrink-0" />
                  <span className="truncate">+ Produto</span>
                </button>
              )}

              {isChief && onAddConvenience && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onClose();
                    onAddConvenience(appointment);
                  }}
                  title="Conveniência (Exclusivo Chefe)"
                  className="h-10 px-2.5 rounded-xl bg-zinc-950 hover:bg-emerald-950/30 border border-zinc-800 hover:border-emerald-500/40 text-xs font-semibold text-emerald-300 flex items-center justify-center gap-1.5 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                >
                  <Coffee size={13} className="text-emerald-400 shrink-0" />
                  <span className="truncate">+ Conveniência</span>
                </button>
              )}
            </div>

            {/* Ações de Pré-Agendamento / Confirmação */}
            {(isPreScheduled || isPending) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {isPreScheduled && onOpenPreSchedule && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onClose();
                      onOpenPreSchedule(appointment);
                    }}
                    className="h-10 px-3 rounded-xl bg-zinc-950 hover:bg-blue-950/40 border border-blue-500/35 text-xs font-semibold text-blue-200 flex items-center justify-center gap-1.5 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                  >
                    <CalendarClock size={14} className="text-blue-400 shrink-0" />
                    <span>Pré-agendamento</span>
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
                    className="h-10 px-3 rounded-xl bg-zinc-950 hover:bg-emerald-950/30 border border-emerald-500/35 text-xs font-semibold text-emerald-300 flex items-center justify-center gap-1.5 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                  >
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                    <span>Confirmar</span>
                  </button>
                )}
              </div>
            )}

            {/* Linha Final Compacta: WhatsApp + Cancelar */}
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={handleSendWhatsAppReminder}
                title="WhatsApp"
                aria-label="WhatsApp"
                className="w-11 h-10 shrink-0 rounded-xl bg-zinc-950 hover:bg-emerald-500/15 border border-zinc-800 hover:border-emerald-500/40 text-emerald-400 flex items-center justify-center active:scale-95 transition-all touch-manipulation"
              >
                <span className="relative inline-flex items-center justify-center">
                  <MessageCircle size={20} strokeWidth={2} className="text-emerald-400" />
                  <Phone
                    size={8.5}
                    strokeWidth={2.4}
                    className="text-emerald-400 fill-emerald-400 absolute"
                  />
                </span>
              </button>

              {onChangeStatus && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onChangeStatus(appointment.id, 'cancelado');
                    onClose();
                  }}
                  className="flex-1 h-10 px-3 rounded-xl bg-zinc-950 hover:bg-red-950/30 border border-zinc-800 hover:border-accent/40 text-xs font-semibold text-zinc-400 hover:text-accent-light flex items-center justify-center gap-1.5 active:scale-95 transition-all touch-manipulation disabled:opacity-50"
                >
                  <XCircle size={14} className="text-accent-light shrink-0" />
                  <span className="truncate">Cancelar</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
