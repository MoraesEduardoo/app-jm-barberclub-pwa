'use client';

const METHOD_LABELS = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' };

export default function FinanceRow({ appointment, variant }) {
  let dateText = '';
  if (appointment.appointment_date) {
    const raw = String(appointment.appointment_date);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [, m, d] = raw.slice(0, 10).split('-');
      dateText = `${d}/${m}`;
    } else {
      try {
        const dt = new Date(raw);
        if (!isNaN(dt.getTime())) {
          dateText = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Fortaleza' });
        }
      } catch {
        // fallback
      }
    }
  }

  const timeText = appointment.appointment_time
    ? String(appointment.appointment_time).slice(0, 5)
    : '';

  const dateTimeLabel = [dateText, timeText].filter(Boolean).join(' · ');

  return (
    <div className="flex items-center justify-between gap-3 bg-surface border border-zinc-800 rounded-xl px-4 py-3">
      <div className="min-w-0">
        <p className="text-white text-sm font-medium truncate">{appointment.client_name}</p>
        <p className="text-zinc-500 text-xs">
          {dateTimeLabel}
          {appointment.barbers?.name ? ` · ${appointment.barbers.name}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={`font-semibold text-sm ${variant === 'paid' ? 'text-emerald-400' : 'text-accent-light'}`}>
          R$ {Number(appointment.price ?? appointment.amount ?? 0).toFixed(2).replace('.', ',')}
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
