'use client';

import { CheckCircle2, XCircle, Clock3, Wallet, User, Zap } from 'lucide-react';

const STATUS_STYLES = {
  pendente: { label: 'Pendente', className: 'bg-zinc-800 text-zinc-300' },
  confirmado: { label: 'Confirmado', className: 'bg-emerald-500/15 text-emerald-400' },
  cancelado: { label: 'Cancelado', className: 'bg-accent/15 text-accent-light' },
};

export default function AppointmentCard({ appointment, onChangeStatus, onOpenPayment }) {
  const status = STATUS_STYLES[appointment.status] || STATUS_STYLES.pendente;
  const paid = appointment.payment_status === 'pago';
  const time = appointment.appointment_date
    ? new Date(appointment.appointment_date).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
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
            onClick={() => onChangeStatus(appointment.id, 'confirmado')}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-elevated border border-zinc-700 text-xs font-medium text-white active:bg-zinc-800"
          >
            <CheckCircle2 size={14} /> Confirmar
          </button>
        )}
        {appointment.status !== 'cancelado' && (
          <button
            onClick={() => onChangeStatus(appointment.id, 'cancelado')}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-elevated border border-zinc-700 text-xs font-medium text-zinc-400 active:bg-zinc-800"
          >
            <XCircle size={14} /> Cancelar
          </button>
        )}
        {!paid && appointment.status !== 'cancelado' && (
          <button
            onClick={() => onOpenPayment(appointment)}
            className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-accent text-xs font-semibold text-white active:bg-accent-dark"
          >
            <Wallet size={14} /> Pagamento
          </button>
        )}
      </div>
    </div>
  );
}
