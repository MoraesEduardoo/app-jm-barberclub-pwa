'use client';

import { CheckCircle2, XCircle, Clock3, Wallet, User, Zap, Trash2 } from 'lucide-react';

const STATUS_STYLES = {
  pendente: { label: 'Pendente', className: 'bg-zinc-800 text-zinc-300' },
  confirmado: { label: 'Confirmado', className: 'bg-emerald-500/15 text-emerald-400' },
  cancelado: { label: 'Cancelado', className: 'bg-accent/15 text-accent-light' },
};

export default function AppointmentCard({ appointment, onChangeStatus, onOpenPayment, onDelete, busy = false }) {
  const status = STATUS_STYLES[appointment.status] || STATUS_STYLES.pendente;
  const paid = appointment.payment_status === 'pago';
  const time = appointment.appointment_date
    ? new Date(appointment.appointment_date).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Fortaleza', // UTC-3 fixo, igual a @/lib/dates
      })
    : '';

  return (
    <div className="bg-surface border border-zinc-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-sm">{time}</span>
            <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${status.className}`}>
              {status.label}
            </span>
            {appointment.is_walk_in && (
              <span className="flex items-center gap-0.5 text-[10px] font-medium rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-400">
                <Zap size={10} /> Sem hora
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-zinc-300 text-sm">
            <User size={13} className="text-zinc-500" />
            <span className="truncate">{appointment.client_name}</span>
          </div>
          <p className="text-zinc-500 text-xs mt-0.5">
            {appointment.services?.name}
            {appointment.barbers?.name ? ` · ${appointment.barbers.name}` : ''}
          </p>
          {appointment.reference_photo && (
            <a
              href={appointment.reference_photo.image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-elevated p-1 pr-2.5 active:opacity-80"
            >
              <img
                src={appointment.reference_photo.image_url}
                alt=""
                loading="lazy"
                className="h-10 w-10 rounded-md object-cover"
              />
              <span className="text-[11px] text-zinc-300">
                Referência: <span className="text-white font-medium">{appointment.reference_photo.title}</span>
              </span>
            </a>
          )}
        </div>

        <div className="text-right shrink-0">
          {paid ? (
            <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
              <CheckCircle2 size={13} /> Pago
            </span>
          ) : (
            <span className="flex items-center gap-1 text-zinc-500 text-xs font-medium">
              <Clock3 size={13} /> Não pago
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3.5">
        {appointment.status === 'pendente' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChangeStatus(appointment.id, 'confirmado')}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-elevated border border-zinc-700 text-xs font-medium text-white active:scale-95 active:bg-zinc-800 transition-all touch-manipulation select-none disabled:opacity-50"
          >
            <CheckCircle2 size={14} /> Confirmar
          </button>
        )}
        {appointment.status !== 'cancelado' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChangeStatus(appointment.id, 'cancelado')}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-elevated border border-zinc-700 text-xs font-medium text-zinc-400 active:scale-95 active:bg-zinc-800 transition-all touch-manipulation select-none disabled:opacity-50"
          >
            <XCircle size={14} /> Cancelar
          </button>
        )}
        {!paid && appointment.status !== 'cancelado' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenPayment(appointment)}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-accent text-xs font-semibold text-white active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none disabled:opacity-50"
          >
            <Wallet size={14} /> Pagamento
          </button>
        )}
        {appointment.status === 'cancelado' && onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(appointment.id)}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-red-950/30 border border-red-900/50 text-xs font-medium text-red-400 active:scale-95 active:bg-red-900/50 transition-all touch-manipulation select-none disabled:opacity-50"
          >
            <Trash2 size={14} /> Excluir registro
          </button>
        )}
      </div>
    </div>
  );
}
