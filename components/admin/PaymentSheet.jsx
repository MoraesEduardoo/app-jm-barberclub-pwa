"use client";

import { endSession } from "@/lib/session";
import { useEffect, useState } from "react";
import { QrCode, CreditCard, Banknote, ShoppingBag } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { FormField, TextInput, PrimaryButton } from "./FormField";
import { registerPayment } from "@/lib/actions/appointments";
import { parseAppointmentNotes } from "./AddProductSheet";

const METHODS = [
  { value: "pix", label: "Pix", icon: QrCode },
  { value: "cartao", label: "Cartão", icon: CreditCard },
  { value: "dinheiro", label: "Dinheiro", icon: Banknote },
];

export default function PaymentSheet({ open, onClose, appointment }) {
  const defaultAmount =
    appointment?.total_price ??
    appointment?.price ??
    appointment?.services?.price ??
    "";

  const [method, setMethod] = useState(appointment?.payment_method || "pix");
  const [amount, setAmount] = useState(defaultAmount);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (appointment && open) {
      setMethod(appointment.payment_method || "pix");
      setAmount(
        appointment.total_price ??
          appointment.price ??
          appointment.services?.price ??
          "",
      );
      setError("");
    }
  }, [appointment, open]);

  if (!appointment) return null;

  const serviceLabel =
    appointment.services?.name || appointment.service || "Serviço";
  const { products: attachedProducts } = parseAppointmentNotes(
    appointment.notes,
  );

  async function handleConfirm() {
    setSaving(true);
    setError("");

    try {
      const response = await registerPayment(appointment.id, {
        barber_id: appointment.barbers?.id || appointment.barber_id,
        payment_method: method,
        amount: Number(amount),
        description: `${serviceLabel} — ${appointment.client_name}`,
      });

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (response?.error) {
        setError(response.error);
        return;
      }

      onClose();
    } catch (err) {
      setError("Ocorreu um erro ao registar o pagamento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Registrar pagamento">
      <div className="mb-4 space-y-1.5">
        <p className="text-zinc-300 text-sm font-medium">
          {appointment.client_name} · {serviceLabel}
        </p>
        {attachedProducts.length > 0 && (
          <div className="bg-elevated/70 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-emerald-300 space-y-0.5">
            <span className="inline-flex items-center gap-1 font-semibold text-[11px]">
              <ShoppingBag size={12} /> Inclui produto(s):
            </span>
            {attachedProducts.map((p) => (
              <p key={p.key} className="text-zinc-300 text-[11px]">
                • {p.label}
              </p>
            ))}
          </div>
        )}
      </div>

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
            type="button"
            onClick={() => setMethod(value)}
            className={`flex flex-col items-center gap-1.5 rounded-lg border py-3 text-xs font-medium transition-all touch-manipulation select-none active:scale-95 ${
              method === value
                ? "border-accent bg-accent/10 text-white"
                : "border-zinc-700 text-zinc-400 active:bg-zinc-800"
            }`}
          >
            <Icon
              size={18}
              className={method === value ? "text-accent-light" : ""}
            />
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-accent-light text-xs mb-3">{error}</p>}

      <PrimaryButton onClick={handleConfirm} disabled={saving || !amount}>
        {saving ? "Registrando…" : "Confirmar pagamento"}
      </PrimaryButton>
    </BottomSheet>
  );
}
