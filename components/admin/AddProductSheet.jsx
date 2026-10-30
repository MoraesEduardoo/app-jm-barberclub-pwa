"use client";

import { useEffect, useState } from "react";
import { Package, Plus, Minus, Check, Loader2, ShoppingBag } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { PrimaryButton } from "./FormField";
import { listProducts } from "@/lib/actions/products";
import { addProductToAppointment } from "@/lib/actions/appointments";

function formatBRL(val) {
  return `R$ ${Number(val || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

/**
 * Extrai das notas do agendamento os produtos vinculados no formato:
 * [PRODUTO:<id>:<qty>:<unitPrice>] <qty>x <Nome> (R$ <subtotal>)
 */
export function parseAppointmentNotes(notes) {
  if (!notes) return { cleanNotes: "", products: [] };
  const lines = String(notes).split("\n");
  const cleanLines = [];
  const products = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[PRODUTO:([^:]+):(\d+):([0-9.]+)\]\s*(.+)$/);
    if (match) {
      const productId = match[1];
      const quantity = parseInt(match[2], 10) || 1;
      const unitPrice = parseFloat(match[3]) || 0;
      const label = match[4];
      products.push({
        key: `${productId}-${index}`,
        rawLine: trimmed,
        productId,
        quantity,
        unitPrice,
        subtotal: Number((quantity * unitPrice).toFixed(2)),
        label,
      });
    } else if (trimmed) {
      cleanLines.push(line);
    }
  });

  return {
    cleanNotes: cleanLines.join("\n").trim(),
    products,
  };
}

export default function AddProductSheet({ open, onClose, appointment, onAdded }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setSelectedId(null);
    setQuantity(1);
    setLoading(true);

    listProducts()
      .then((data) => {
        const activeProducts = (data || []).filter((p) => p.is_active !== false);
        setProducts(activeProducts);
        const firstAvailable = activeProducts.find((p) => Number(p.stock_quantity || 0) > 0);
        if (firstAvailable) {
          setSelectedId(firstAvailable.id);
        }
      })
      .catch(() => {
        setError("Não foi possível carregar o catálogo de produtos.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  if (!appointment) return null;

  const selectedProduct = products.find((p) => p.id === selectedId) || null;
  const maxStock = Number(selectedProduct?.stock_quantity || 0);
  const currentTotal = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0,
  );
  const productSubtotal = selectedProduct
    ? Number((Number(selectedProduct.price || 0) * quantity).toFixed(2))
    : 0;
  const nextTotal = Number((currentTotal + productSubtotal).toFixed(2));

  async function handleConfirm() {
    if (!selectedProduct) return;
    setSaving(true);
    setError("");

    try {
      const res = await addProductToAppointment({
        appointmentId: appointment.id,
        productId: selectedProduct.id,
        quantity,
      });

      if (res?.error) {
        setError(res.error);
        setSaving(false);
        return;
      }

      if (onAdded) {
        onAdded(res);
      }
      onClose();
    } catch {
      setError("Erro ao vincular produto ao atendimento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Adicionar Produto ao Atendimento"
    >
      <div className="space-y-4">
        {/* Resumo do Cliente / Atendimento */}
        <div className="flex items-center justify-between bg-elevated/70 border border-zinc-800 rounded-xl px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-white text-xs font-bold truncate">
              {appointment.client_name}
            </p>
            <p className="text-zinc-400 text-[11px] truncate">
              {appointment.services?.name || appointment.service || "Serviço"}
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-[10px] text-zinc-500 block">Atual</span>
            <span className="text-white font-bold text-xs">
              {formatBRL(currentTotal)}
            </span>
          </div>
        </div>

        {/* Lista de Produtos */}
        {loading ? (
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <Loader2 size={20} className="animate-spin text-accent" />
            <span className="text-xs">Carregando produtos em estoque…</span>
          </div>
        ) : products.length === 0 ? (
          <div className="py-6 text-center bg-surface border border-zinc-800 rounded-xl p-4">
            <Package size={24} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-white text-xs font-semibold">
              Nenhum produto cadastrado
            </p>
            <p className="text-zinc-500 text-[11px] mt-1">
              Cadastre pomadas, óleos ou itens na aba Serviços &gt; Produtos.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
            {products.map((product) => {
              const stock = Number(product.stock_quantity || 0);
              const outOfStock = stock <= 0;
              const isSelected = selectedId === product.id;

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => {
                    setSelectedId(product.id);
                    setQuantity(1);
                    setError("");
                  }}
                  className={`w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border text-left transition-all touch-manipulation ${
                    outOfStock
                      ? "bg-zinc-950/60 border-zinc-900 opacity-50 cursor-not-allowed"
                      : isSelected
                        ? "bg-accent/15 border-accent text-white"
                        : "bg-surface border-zinc-800 hover:border-zinc-700 text-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-11 w-11 rounded-lg bg-zinc-900 border border-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-full w-full object-cover object-center"
                        />
                      ) : (
                        <Package size={18} className="text-zinc-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">
                        {product.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-accent-light font-semibold text-xs">
                          {formatBRL(product.price)}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            outOfStock
                              ? "bg-rose-500/15 text-rose-400"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {outOfStock ? "Sem estoque" : `Estoque: ${stock} un.`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${
                      isSelected
                        ? "border-accent bg-accent text-white"
                        : "border-zinc-700"
                    }`}
                  >
                    {isSelected && <Check size={12} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Seletor de Quantidade e Resumo de Novo Total */}
        {selectedProduct && maxStock > 0 && (
          <div className="bg-surface border border-zinc-800 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">
                Quantidade vendida
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  className="h-8 w-8 rounded-lg bg-elevated border border-zinc-700 flex items-center justify-center text-white disabled:opacity-40 active:scale-95"
                >
                  <Minus size={14} />
                </button>
                <span className="w-6 text-center text-sm font-bold text-white">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(maxStock, q + 1))}
                  disabled={quantity >= maxStock}
                  className="h-8 w-8 rounded-lg bg-elevated border border-zinc-700 flex items-center justify-center text-white disabled:opacity-40 active:scale-95"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                Novo total a cobrar do cliente
              </span>
              <span className="text-sm font-bold text-emerald-400">
                {formatBRL(nextTotal)}
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-rose-400 text-xs bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <PrimaryButton
          onClick={handleConfirm}
          disabled={saving || !selectedProduct || maxStock <= 0}
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Adicionando…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <ShoppingBag size={15} /> Confirmar e Somar ao Atendimento
            </span>
          )}
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
