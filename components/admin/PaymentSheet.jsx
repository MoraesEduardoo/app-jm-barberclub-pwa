'use client';

import { useState } from 'react';
import { QrCode, CreditCard, Banknote } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton } from './FormField';
import { registerPayment } from '@/lib/actions/appointments';

const METHODS = [
  { value: 'pix', label: 'Pix', icon: QrCode },
  { value: 'cartao', label: 'Cartão', icon: CreditCard },
  { value: 'dinheiro', label: 'Dinheiro', icon: Banknote },
];

export default function PaymentSheet({ open, onClose, appointment }) {
  const [method, setMethod] = useState(appointment?.payment_method || 'pix');
  const [amount, setAmount] = useState(appointment?.services?.price ?? '');
  const [saving, setSaving] = useState(false);

  if (!appointment) return null;

  async function handleConfirm() {
    setSaving(true);
    try {
      await registerPayment(appointment.id, {
        barber_id: appointment.barbers?.id,
        payment_method: method,
        amount: Number(amount),
        description: `${appointment.services?.name} — ${appointment.client_name}`,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Registrar pagamento">
      <p className="text-zinc-400 text-sm mb-4">
        {appointment.client_name} · {appointment.services?.name}
      </p>

      <FormField label="Valor cobrado (R$)">
        <TextInput
          type="number"
          inputMode="decimal"
          min="0"
          step="0.5"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="45,00"
          autoFocus
        />
      </FormField>

      <span className="block text-xs font-medium text-zinc-400 mb-1.5">
        Forma de pagamento
      </span>
      <div className="grid grid-cols-3 gap-2 mb-5">
        {METHODS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setMethod(value)}
            className={`flex flex-col items-center gap-1.5 rounded-lg border py-3 text-xs font-medium transition-colors ${
              method === value
                ? 'border-accent bg-accent/10 text-white'
                : 'border-zinc-700 text-zinc-400'
            }`}
          >
            <Icon size={18} className={method === value ? 'text-accent-light' : ''} />
            {label}
          </button>
        ))}
      </div>

      <PrimaryButton onClick={handleConfirm} disabled={saving || !amount}>
        {saving ? 'Registrando…' : 'Confirmar pagamento'}
      </PrimaryButton>
    </BottomSheet>
  );
}
