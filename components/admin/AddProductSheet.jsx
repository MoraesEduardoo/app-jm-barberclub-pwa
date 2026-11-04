"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package,
  Plus,
  Minus,
  Check,
  Loader2,
  ShoppingBag,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import { PrimaryButton } from "./FormField";
import { listProducts } from "@/lib/actions/products";
import { addProductToAppointment } from "@/lib/actions/appointments";
import { cacheKeys, getCache, setCache } from "@/lib/admin-cache";

function formatBRL(val) {
  return `R$ ${Number(val || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

/**
 * Busca produtos em estoque com proteção de timeout (8s) e duplo canal
 * (API Route GET imediata + Server Action fallback) para nunca travar na fila de transição.
 */
async function fetchProductsSafe() {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT_PRODUCTS")), 8000)
  );

  const fetchTask = (async () => {
    try {
      const res = await fetch("/api/products", {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data)) {
          return json.data;
        }
      }
    } catch {
      // Fallback imediato para Server Action se o endpoint HTTP falhar
    }
    const actionData = await listProducts();
    return Array.isArray(actionData) ? actionData : [];
  })();

  return Promise.race([fetchTask, timeoutPromise]);
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
  const productsKey = cacheKeys.products();
  const [products, setProducts] = useState(() => {
    const cached = getCache(productsKey);
    return Array.isArray(cached)
      ? cached.filter((p) => p && p.is_active !== false && p.active !== false)
      : [];
  });
  const [loading, setLoading] = useState(false);
  // Mapa de carrinho: { [productId]: quantity }
  const [cart, setCart] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadProducts = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
      }
      setLoadFailed(false);
      setError("");

      try {
        const rawData = await fetchProductsSafe();
        if (!mountedRef.current) return;

        const safeList = Array.isArray(rawData) ? rawData : [];
        const activeProducts = safeList.filter(
          (p) => p && p.is_active !== false && p.active !== false
        );

        setCache(productsKey, safeList);
        setProducts(activeProducts);
        setLoadFailed(false);
      } catch (err) {
        console.warn("[AddProductSheet] Falha ao carregar produtos:", err?.message);
        if (!mountedRef.current) return;

        const fallbackCached = getCache(productsKey);
        if (Array.isArray(fallbackCached) && fallbackCached.length > 0) {
          setProducts(
            fallbackCached.filter((p) => p && p.is_active !== false && p.active !== false)
          );
        } else {
          setLoadFailed(true);
          setError("Não foi possível carregar os produtos em estoque. Toque em 'Tentar novamente'.");
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [productsKey]
  );

  useEffect(() => {
    if (!open) {
      setLoading(false);
      return;
    }
    setError("");
    setLoadFailed(false);
    setCart({});

    const cached = getCache(productsKey);
    if (Array.isArray(cached) && cached.length > 0) {
      setProducts(cached.filter((p) => p && p.is_active !== false && p.active !== false));
      setLoading(false);
      loadProducts({ silent: true });
    } else {
      loadProducts({ silent: false });
    }
  }, [open, productsKey, loadProducts]);

  if (!appointment) return null;

  function toggleProduct(product) {
    const stock = Number(product.stock_quantity || 0);
    if (stock <= 0) return;
    setError("");
    setCart((prev) => {
      const next = { ...prev };
      if (next[product.id]) {
        delete next[product.id];
      } else {
        next[product.id] = 1;
      }
      return next;
    });
  }

  function changeItemQuantity(product, delta) {
    const stock = Number(product.stock_quantity || 0);
    if (stock <= 0) return;
    setError("");
    setCart((prev) => {
      const currentQty = prev[product.id] || 0;
      const nextQty = currentQty + delta;
      const next = { ...prev };
      if (nextQty <= 0) {
        delete next[product.id];
      } else {
        next[product.id] = Math.min(stock, nextQty);
      }
      return next;
    });
  }

  // Lista detalhada dos produtos selecionados no carrinho
  const selectedEntries = products
    .filter((p) => (cart[p.id] || 0) > 0 && Number(p.stock_quantity || 0) > 0)
    .map((p) => {
      const stock = Number(p.stock_quantity || 0);
      const qty = Math.min(stock, Number(cart[p.id] || 1));
      const unitPrice = Number(p.price || 0);
      const subtotal = Number((unitPrice * qty).toFixed(2));
      return {
        product: p,
        productId: p.id,
        name: p.name,
        quantity: qty,
        maxStock: stock,
        unitPrice,
        subtotal,
      };
    });

  const totalUnits = selectedEntries.reduce((acc, item) => acc + item.quantity, 0);
  const productsSubtotal = Number(
    selectedEntries.reduce((acc, item) => acc + item.subtotal, 0).toFixed(2)
  );

  const currentTotal = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );
  const nextTotal = Number((currentTotal + productsSubtotal).toFixed(2));

  async function handleConfirm() {
    if (selectedEntries.length === 0) return;
    setSaving(true);
    setError("");

    try {
      const res = await addProductToAppointment({
        appointmentId: appointment.id,
        items: selectedEntries.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
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
      setError("Erro ao vincular produtos ao atendimento.");
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
            <span className="text-[10px] text-zinc-500 block">Valor atual</span>
            <span className="text-white font-bold text-xs">
              {formatBRL(currentTotal)}
            </span>
          </div>
        </div>

        {/* Instrução rápida + Botão de atualizar estoque */}
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[11px] text-zinc-400">
            Toque nos produtos para marcar um ou mais itens:
          </span>
          <div className="flex items-center gap-3">
            {selectedEntries.length > 0 && (
              <button
                type="button"
                onClick={() => setCart({})}
                className="text-[11px] font-semibold text-zinc-400 hover:text-white transition-colors"
              >
                Limpar ({selectedEntries.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => loadProducts({ silent: false })}
              disabled={loading}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={loading ? "animate-spin text-accent" : ""} />
              <span>Atualizar</span>
            </button>
          </div>
        </div>

        {/* Lista de Produtos com Seleção Múltipla e Quantidade por Item */}
        {loading ? (
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <Loader2 size={20} className="animate-spin text-accent" />
            <span className="text-xs">Carregando produtos em estoque…</span>
          </div>
        ) : loadFailed ? (
          <div className="py-6 text-center bg-surface border border-rose-500/30 rounded-xl p-4 space-y-3">
            <AlertCircle size={24} className="mx-auto text-rose-400" />
            <div>
              <p className="text-white text-xs font-semibold">
                Falha ao consultar produtos em estoque
              </p>
              <p className="text-zinc-400 text-[11px] mt-1">
                A conexão demorou mais do que o esperado. Tente recarregar a listagem.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadProducts({ silent: false })}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent hover:bg-accent-light px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-all"
            >
              <RefreshCw size={13} /> Tentar novamente
            </button>
          </div>
        ) : products.length === 0 ? (
          <div className="py-6 text-center bg-surface border border-zinc-800 rounded-xl p-4 space-y-3">
            <Package size={24} className="mx-auto text-zinc-600" />
            <div>
              <p className="text-white text-xs font-semibold">
                Nenhum produto disponível em estoque
              </p>
              <p className="text-zinc-500 text-[11px] mt-1">
                Cadastre pomadas, óleos ou itens na aba Serviços &gt; Produtos ou toque abaixo para sincronizar.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadProducts({ silent: false })}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-elevated border border-zinc-700 hover:border-zinc-600 px-3.5 py-2 text-xs font-semibold text-zinc-200 active:scale-95 transition-all"
            >
              <RefreshCw size={13} /> Recarregar estoque
            </button>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
            {products.map((product) => {
              const stock = Number(product.stock_quantity || 0);
              const outOfStock = stock <= 0;
              const qty = cart[product.id] || 0;
              const isSelected = qty > 0;
              const itemSubtotal = Number((Number(product.price || 0) * qty).toFixed(2));

              return (
                <div
                  key={product.id}
                  onClick={() => {
                    if (!outOfStock) toggleProduct(product);
                  }}
                  role="button"
                  tabIndex={outOfStock ? -1 : 0}
                  onKeyDown={(e) => {
                    if (!outOfStock && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      toggleProduct(product);
                    }
                  }}
                  className={`w-full rounded-xl border p-2.5 text-left transition-all touch-manipulation select-none ${
                    outOfStock
                      ? "bg-zinc-950/60 border-zinc-900 opacity-50 cursor-not-allowed"
                      : isSelected
                        ? "bg-accent/15 border-accent text-white cursor-pointer"
                        : "bg-surface border-zinc-800 hover:border-zinc-700 text-zinc-200 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Checkbox de seleção múltipla */}
                      <div
                        className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? "border-accent bg-accent text-white"
                            : "border-zinc-700 bg-zinc-900/60"
                        }`}
                      >
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </div>

                      {/* Foto do produto */}
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

                      {/* Nome, preço unitário e estoque */}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-white truncate">
                          {product.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
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

                    {/* Controle individual de quantidade (+ e -) quando selecionado */}
                    {isSelected && !outOfStock && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex flex-col items-end gap-1 shrink-0"
                      >
                        <div className="flex items-center gap-1.5 bg-black/80 border border-zinc-700/90 rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => changeItemQuantity(product, -1)}
                            aria-label={`Diminuir quantidade de ${product.name}`}
                            className="h-7 w-7 rounded-md bg-elevated hover:bg-zinc-800 flex items-center justify-center text-white active:scale-95 transition-transform"
                          >
                            <Minus size={13} />
                          </button>
                          <span className="min-w-[20px] text-center text-xs font-bold text-white">
                            {qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => changeItemQuantity(product, 1)}
                            disabled={qty >= stock}
                            aria-label={`Aumentar quantidade de ${product.name}`}
                            className="h-7 w-7 rounded-md bg-elevated hover:bg-zinc-800 flex items-center justify-center text-white disabled:opacity-35 active:scale-95 transition-transform"
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                        <span className="text-[10px] font-semibold text-emerald-400">
                          {formatBRL(itemSubtotal)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Resumo Dinâmico do Carrinho + Novo Total a Cobrar do Cliente */}
        <div className="bg-surface border border-zinc-800 rounded-xl p-3 space-y-2.5">
          {selectedEntries.length > 0 ? (
            <div className="space-y-1.5 pb-2 border-b border-zinc-800/80">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>
                  Itens selecionados ({selectedEntries.length}{" "}
                  {selectedEntries.length === 1 ? "produto" : "produtos"},{" "}
                  {totalUnits} {totalUnits === 1 ? "un." : "uns."})
                </span>
                <span className="font-semibold text-zinc-200">
                  + {formatBRL(productsSubtotal)}
                </span>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto pr-0.5">
                {selectedEntries.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center justify-between text-[11px] text-zinc-300"
                  >
                    <span className="truncate pr-2">
                      <strong className="text-white">{item.quantity}x</strong>{" "}
                      {item.name}
                    </span>
                    <span className="text-zinc-400 shrink-0 font-medium">
                      {formatBRL(item.subtotal)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500 pb-2 border-b border-zinc-800/80">
              Nenhum produto selecionado ainda.
            </p>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">
              Novo total a cobrar do cliente
            </span>
            <span className="text-sm font-bold text-emerald-400">
              {formatBRL(nextTotal)}
            </span>
          </div>
        </div>

        {error && (
          <p className="text-rose-400 text-xs bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <PrimaryButton
          onClick={handleConfirm}
          disabled={saving || selectedEntries.length === 0}
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Adicionando…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <ShoppingBag size={15} />
              <span>
                Confirmar e Somar ao Atendimento
                {totalUnits > 0 ? ` (${totalUnits} un.)` : ""}
              </span>
            </span>
          )}
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
