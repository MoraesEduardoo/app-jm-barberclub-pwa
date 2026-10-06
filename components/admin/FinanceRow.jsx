'use client';

const METHOD_LABELS = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };

export default function FinanceRow({ appointment, variant }) {
  const dt = appointment.appointment_date ? new Date(appointment.appointment_date) : null;

  return (
    <div className="flex items-center justify-between gap-3 bg-surface border border-zinc-800 rounded-xl px-4 py-3">
      <div className="min-w-0">
        <p className="text-white text-sm font-medium truncate">{appointment.client_name}</p>
        <p className="text-zinc-500 text-xs">
          {dt &&
            dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
              ' · ' +
              dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {appointment.barbers?.name ? ` · ${appointment.barbers.name}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={`font-semibold text-sm ${variant === 'paid' ? 'text-emerald-400' : 'text-accent-light'}`}>
          R$ {Number(appointment.amount || 0).toFixed(2).replace('.', ',')}
        </p>
        {variant === 'paid' && appointment.payment_method && (
          <p className="text-zinc-500 text-[11px]">
            {METHOD_LABELS[appointment.payment_method] || appointment.payment_method}
          </p>
        )}
      </div>
    </div>
  );
}
