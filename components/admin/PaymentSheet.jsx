"use client";

import { endSession } from "@/lib/session";
import { useEffect, useState } from "react";
import { QrCode, CreditCard, Banknote, ShoppingBag, Tag } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { FormField, TextInput, PrimaryButton } from "./FormField";
import { registerPayment } from "@/lib/actions/appointments";
import { parseAppointmentNotes } from "./AddProductSheet";
import { allocateProportionalDiscount } from "@/lib/commission";

const formatBRL = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const METHODS = [
  { value: "pix", label: "Pix", icon: QrCode },
  { value: "cartao", label: "Cartão", icon: CreditCard },
  { value: "dinheiro", label: "Dinheiro", icon: Banknote },
];

export default function PaymentSheet({ open, onClose, appointment }) {
  const defaultGross = Number(
    appointment?.total_price ??
      appointment?.price ??
      appointment?.services?.price ??
      0,
  );

  const [method, setMethod] = useState(appointment?.payment_method || "pix");
  const [discount, setDiscount] = useState("");
  const [amount, setAmount] = useState(defaultGross ? String(defaultGross) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (appointment && open) {
      const gross = Number(
        appointment.total_price ??
          appointment.price ??
          appointment.services?.price ??
          0,
      );
      setMethod(appointment.payment_method || "pix");
      setDiscount("");
      setAmount(gross ? String(gross) : "");
      setError("");
    }
  }, [appointment, open]);

  if (!appointment) return null;

  const serviceLabel =
    appointment.services?.name || appointment.service || "Serviço";
  const { products: attachedProducts } = parseAppointmentNotes(
    appointment.notes,
  );

  const productsGross = attachedProducts.reduce(
    (acc, p) => acc + (Number(p.total) || Number(p.unitPrice || 0) * Number(p.qty || 1)),
    0,
  );
  const serviceGross = Math.max(0, Number((defaultGross - productsGross).toFixed(2)));
  const numericDiscount = Math.max(0, Number(discount) || 0);
  const discountAllocation = allocateProportionalDiscount(
    serviceGross,
    productsGross,
    numericDiscount,
  );

  function handleDiscountChange(val) {
    setDiscount(val);
    const disc = Math.max(0, Number(val) || 0);
    const nextNet = Math.max(0, Number((defaultGross - disc).toFixed(2)));
    setAmount(String(nextNet));
  }

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

      onClose(response);
    } catch (err) {
      setError("Ocorreu um erro ao registar o pagamento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={() => onClose(null)} title="Finalizar e Receber">
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
              <p key={p.key} className="text-zinc-300 text-[11px] font-mono tabular-nums">
                • {p.label}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <FormField label="Desconto (R$)">
          <TextInput
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            value={discount}
            onChange={(e) => handleDiscountChange(e.target.value)}
            placeholder="0,00"
          />
        </FormField>

        <FormField label="Valor final cobrado (R$)">
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
      </div>

      {numericDiscount > 0 && (
        <div className="mb-4 rounded-xl bg-zinc-900/90 border border-zinc-800 p-3 space-y-1 text-[11px]">
          <div className="flex items-center justify-between text-amber-300 font-semibold">
            <span className="inline-flex items-center gap-1">
              <Tag size={12} /> Rateio Proporcional de Desconto
            </span>
            <span className="font-mono tabular-nums">-{formatBRL(discountAllocation.totalDiscount)}</span>
          </div>
          <div className="flex items-center justify-between text-zinc-400">
            <span>Serviços (líquido):</span>
            <span className="font-mono tabular-nums text-zinc-200">
              {formatBRL(discountAllocation.netServiceAmount)}
            </span>
          </div>
          {productsGross > 0 && (
            <div className="flex items-center justify-between text-zinc-400">
              <span>Produtos/Conveniência (líquido):</span>
              <span className="font-mono tabular-nums text-zinc-200">
                {formatBRL(discountAllocation.netProductAmount)}
              </span>
            </div>
          )}
        </div>
      )}

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
