'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Package,
  Plus,
  Minus,
  Loader2,
  AlertCircle,
  ShoppingBag,
  Sparkles,
  RefreshCw,
  Coffee,
  Lock,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import { PrimaryButton } from './FormField';
import { listProducts, seedDefaultConvenienceProducts } from '@/lib/actions/products';
import { addProductsToAppointment } from '@/lib/actions/appointments';
import { cacheKeys, getCache, setCache } from '@/lib/admin-cache';
import { isConvenienceProduct, isOwnerBarber } from '@/lib/commission';
import { useBarber } from '@/lib/barber-context';
import { isChefe } from '@/lib/auth';
import { toast } from '@/lib/toast';

const PRODUCTS_CACHE_KEY = cacheKeys.products();

/**
 * Extrai e separa os produtos de barbearia ([PRODUTO:...]) e itens de conveniência ([CONVENIENCIA:...])
 * das notas livres de um agendamento.
 */
export function parseAppointmentNotes(notes) {
  if (!notes) {
    return {
      cleanNotes: '',
      products: [],
      regularProducts: [],
      convenienceProducts: [],
    };
  }
  const lines = String(notes).split('\n');
  const products = [];
  const regularProducts = [];
  const convenienceProducts = [];
  const otherLines = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^\[(PRODUTO|CONVENIENCIA):([^:]+):(\d+):([0-9.]+)\]\s*(.*)$/);
    if (match) {
      const tagType = match[1];
      const isConvenience = tagType === 'CONVENIENCIA';
      const qty = parseInt(match[3], 10) || 1;
      const unitPrice = parseFloat(match[4]) || 0;
      const itemObj = {
        key: `${match[2]}-${idx}`,
        rawLine: trimmed,
        productId: match[2],
        quantity: qty,
        unitPrice,
        subtotal: Number((qty * unitPrice).toFixed(2)),
        isConvenience,
        category: isConvenience ? 'conveniencia' : 'barbearia',
        label: match[5] || `${qty}x ${isConvenience ? 'Conveniência' : 'Produto'}`,
      };
      products.push(itemObj);
      if (isConvenience) {
        convenienceProducts.push(itemObj);
      } else {
        regularProducts.push(itemObj);
      }
    } else if (trimmed) {
      otherLines.push(line);
    }
  });

  return {
    cleanNotes: otherLines.join('\n').trim(),
    products,
    regularProducts,
    convenienceProducts,
  };
}

/**
 * Busca a lista de produtos em estoque via rota HTTP GET (/api/products)
 * com fallback automático para Server Action e timeout de segurança (7s).
 */
async function fetchStockProductsFast() {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT_PRODUCTS')), 7000)
  );

  const fetchTask = (async () => {
    try {
      const res = await fetch('/api/products', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.data)) {
          return json.data;
        }
      }
    } catch {
      // Fallback imediato para Server Action
    }
    return await listProducts();
  })();

  return Promise.race([fetchTask, timeoutPromise]);
}

export default function AddProductSheet({
  open,
  onClose,
  appointment,
  mode = 'produto', // 'produto' | 'conveniencia'
  onAdded,
}) {
  const { barber } = useBarber();
  const isChief = isChefe(barber) || isOwnerBarber(barber);
  const isConvenienceMode = mode === 'conveniencia';

  const [allProducts, setAllProducts] = useState(() => {
    const cached = getCache(PRODUCTS_CACHE_KEY);
    return Array.isArray(cached) ? cached.filter((p) => p && p.is_active !== false) : [];
  });
  const [loading, setLoading] = useState(false);
  const [seedingConvenience, setSeedingConvenience] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedMap, setSelectedMap] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadProductsCatalog = useCallback(async ({ forceSpinner = false } = {}) => {
    const cached = getCache(PRODUCTS_CACHE_KEY);
    const hasCached = Array.isArray(cached) && cached.length > 0;

    if (hasCached && !forceSpinner) {
      const activeCached = cached.filter((p) => p && p.is_active !== false);
      setAllProducts(activeCached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    setLoadError(false);

    try {
      const data = await fetchStockProductsFast();
      if (!mountedRef.current) return;
      const safeList = Array.isArray(data) ? data : [];
      setCache(PRODUCTS_CACHE_KEY, safeList);
      const activeList = safeList.filter((p) => p && p.is_active !== false);
      setAllProducts(activeList);
      setLoadError(false);
    } catch (err) {
      console.warn('[AddProductSheet] Aviso ao sincronizar produtos:', err?.message);
      if (!mountedRef.current) return;
      if (!hasCached) {
        setLoadError(true);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedMap({});
    setError('');
    loadProductsCatalog({ forceSpinner: false });
  }, [open, mode, loadProductsCatalog]);

  const products = useMemo(() => {
    if (isConvenienceMode) {
      if (!isChief) return [];
      return allProducts.filter((p) => isConvenienceProduct(p));
    }
    return allProducts.filter((p) => !isConvenienceProduct(p));
  }, [allProducts, isConvenienceMode, isChief]);

  async function handleSeedConvenience() {
    if (!isChief || seedingConvenience) return;
    setSeedingConvenience(true);
    setError('');
    try {
      const res = await seedDefaultConvenienceProducts();
      if (Array.isArray(res?.items) && res.items.length > 0) {
        setAllProducts((prev) => {
          const byName = new Map(
            prev.map((p) => [String(p.name || '').toLowerCase().trim(), p])
          );
          for (const item of res.items) {
            byName.set(String(item.name || '').toLowerCase().trim(), item);
          }
          const merged = Array.from(byName.values());
          setCache(PRODUCTS_CACHE_KEY, merged);
          return merged;
        });
      }
      await loadProductsCatalog({ forceSpinner: false });
      toast.success('Catálogo de Conveniência carregado!');
    } catch (err) {
      setError(err?.message || 'Não foi possível carregar os itens de Conveniência.');
    } finally {
      setSeedingConvenience(false);
    }
  }

  const selectedItems = useMemo(() => {
    const list = [];
    for (const product of products) {
      const qty = Number(selectedMap[product.id] || 0);
      if (qty > 0) {
        const unitPrice = Number(product.price || 0);
        list.push({
          product,
          productId: product.id,
          quantity: qty,
          unitPrice,
          subtotal: Number((unitPrice * qty).toFixed(2)),
        });
      }
    }
    return list;
  }, [products, selectedMap]);

  const totalUnitsSelected = useMemo(
    () => selectedItems.reduce((acc, item) => acc + item.quantity, 0),
    [selectedItems]
  );

  const addedTotal = useMemo(
    () => Number(selectedItems.reduce((acc, item) => acc + item.subtotal, 0).toFixed(2)),
    [selectedItems]
  );

  if (!appointment) return null;

  const currentApptTotal = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );
  const newApptTotal = Number((currentApptTotal + addedTotal).toFixed(2));

  function handleToggleProduct(product) {
    const maxStock = Math.max(0, Number(product.stock_quantity || 0));
    if (maxStock <= 0) return;

    setError('');
    setSelectedMap((prev) => {
      const currentQty = Number(prev[product.id] || 0);
      if (currentQty > 0) {
        const next = { ...prev };
        delete next[product.id];
        return next;
      }
      return {
        ...prev,
        [product.id]: 1,
      };
    });
  }

  function handleStepProductQuantity(product, delta, e) {
    if (e) e.stopPropagation();
    const maxStock = Math.max(0, Number(product.stock_quantity || 0));
    if (maxStock <= 0) return;

    setError('');
    setSelectedMap((prev) => {
      const currentQty = Number(prev[product.id] || 0);
      const nextQty = Math.min(maxStock, Math.max(0, currentQty + delta));
      const next = { ...prev };
      if (nextQty <= 0) {
        delete next[product.id];
      } else {
        next[product.id] = nextQty;
      }
      return next;
    });
  }

  async function handleConfirm(e) {
    e.preventDefault();
    if (isConvenienceMode && !isChief) {
      setError('Restrito ao Barbeiro Chefe.');
      return;
    }
    if (selectedItems.length === 0) {
      setError('Selecione pelo menos um item.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await addProductsToAppointment({
        appointmentId: appointment.id,
        items: selectedItems.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      });

      if (res?.error) {
        setError(res.error);
        return;
      }

      if (Array.isArray(res?.addedItems) && res.addedItems.length > 0) {
        const stockMap = new Map(
          res.addedItems.map((item) => [item.productId, item.remainingStock])
        );
        const updatedCatalog = allProducts.map((p) =>
          stockMap.has(p.id) ? { ...p, stock_quantity: stockMap.get(p.id) } : p
        );
        setAllProducts(updatedCatalog);
        setCache(PRODUCTS_CACHE_KEY, updatedCatalog);
      }

      if (onAdded) {
        onAdded(res);
      }
      onClose();
    } catch (err) {
      setError(err?.message || 'Erro ao vincular itens.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={isConvenienceMode ? 'Conveniência • Bebidas & Snacks' : 'Adicionar Produtos'}
    >
      {isConvenienceMode && !isChief ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 flex flex-col items-center justify-center text-center gap-2">
          <Lock size={20} className="text-zinc-500" />
          <p className="text-xs text-zinc-400">Restrito ao Barbeiro Chefe.</p>
        </div>
      ) : (
        <form onSubmit={handleConfirm} className="space-y-3">
          {/* Resumo Compacto do Atendimento */}
          <div className="rounded-2xl bg-zinc-950 border border-zinc-800/90 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">
                {appointment.client_name || 'Cliente'}
              </p>
              <p className="text-xs text-zinc-400 truncate">
                {appointment.services?.name || appointment.service || 'Serviço'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Atual</p>
              <p className="text-sm font-bold text-zinc-200 font-mono tabular-nums">
                R$ {currentApptTotal.toFixed(2).replace('.', ',')}
              </p>
            </div>
          </div>

          {isConvenienceMode && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-emerald-300">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Coffee size={13} className="text-emerald-400 shrink-0" />
                Exclusivo Chefe
              </span>
              <span className="font-mono text-[10px] text-emerald-400 font-bold">
                100% Caixa • 0% Colab.
              </span>
            </div>
          )}

          {/* Lista de Itens */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-xs font-semibold text-zinc-300">
                {isConvenienceMode ? 'Bebidas & Snacks' : 'Catálogo'}
              </span>
              <div className="flex items-center gap-2">
                {selectedItems.length > 0 && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                      isConvenienceMode
                        ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
                        : 'text-accent-light bg-accent/15 border-accent/30'
                    }`}
                  >
                    {totalUnitsSelected} un.
                  </span>
                )}
                <span className="text-[11px] text-zinc-500">{products.length} itens</span>
              </div>
            </div>

            {loading && products.length === 0 ? (
              <div className="space-y-2 py-2">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-14 rounded-2xl bg-zinc-950 border border-zinc-800/70 animate-pulse flex items-center px-3 gap-3"
                  >
                    <div className="h-10 w-10 rounded-xl bg-zinc-900 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/3 rounded bg-zinc-900" />
                      <div className="h-2.5 w-1/3 rounded bg-zinc-900/70" />
                    </div>
                  </div>
                ))}
              </div>
            ) : loadError && products.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-center space-y-2.5">
                <AlertCircle size={20} className="mx-auto text-amber-400" />
                <p className="text-xs text-zinc-300">Falha ao sincronizar estoque.</p>
                <button
                  type="button"
                  onClick={() => loadProductsCatalog({ forceSpinner: true })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-700 text-xs font-semibold text-white active:scale-95 transition-all"
                >
                  <RefreshCw size={12} />
                  Recarregar
                </button>
              </div>
            ) : products.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-center space-y-3">
                {isConvenienceMode ? (
                  <Coffee size={22} className="mx-auto text-emerald-400" />
                ) : (
                  <Package size={22} className="mx-auto text-zinc-600" />
                )}
                <p className="text-xs text-zinc-400">
                  {isConvenienceMode
                    ? 'Catálogo de Conveniência vazio.'
                    : 'Nenhum produto registado.'}
                </p>
                {isConvenienceMode && isChief && (
                  <button
                    type="button"
                    disabled={seedingConvenience}
                    onClick={handleSeedConvenience}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
                  >
                    {seedingConvenience ? (
                      <>
                        <Loader2 size={13} className="animate-spin" /> Carregando…
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} /> Carregar Bebidas & Snacks Padrão
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                {products.map((product) => {
                  const stock = Number(product.stock_quantity || 0);
                  const outOfStock = stock <= 0;
                  const qtySelected = Number(selectedMap[product.id] || 0);
                  const isSelected = qtySelected > 0;
                  const unitPrice = Number(product.price || 0);
                  const itemSubtotal = Number((unitPrice * qtySelected).toFixed(2));

                  return (
                    <div
                      key={product.id}
                      onClick={() => !outOfStock && handleToggleProduct(product)}
                      role="button"
                      tabIndex={outOfStock ? -1 : 0}
                      onKeyDown={(e) => {
                        if (!outOfStock && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleToggleProduct(product);
                        }
                      }}
                      className={`w-full text-left rounded-2xl border p-2.5 flex items-center gap-2.5 transition-all select-none ${
                        outOfStock
                          ? 'border-zinc-900 bg-zinc-950/50 opacity-45 cursor-not-allowed'
                          : isSelected
                          ? isConvenienceMode
                            ? 'border-emerald-500 bg-emerald-500/10 cursor-pointer'
                            : 'border-accent bg-accent/10 cursor-pointer'
                          : 'border-zinc-800/90 bg-zinc-950 hover:border-zinc-700 cursor-pointer active:scale-[0.99]'
                      }`}
                    >
                      <div className="h-11 w-11 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center relative">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover object-center"
                          />
                        ) : isConvenienceMode ? (
                          <Coffee size={17} className="text-emerald-400" />
                        ) : (
                          <Package size={17} className="text-zinc-600" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate">{product.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${
                              outOfStock
                                ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                                : stock <= 3
                                ? 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                            }`}
                          >
                            {outOfStock ? 'Esgotado' : `${stock} un.`}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-zinc-300 font-semibold">
                            R$ {unitPrice.toFixed(2).replace('.', ',')}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {isSelected ? (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 bg-black border border-zinc-700 rounded-xl p-1"
                          >
                            <button
                              type="button"
                              onClick={(e) => handleStepProductQuantity(product, -1, e)}
                              aria-label={`Diminuir ${product.name}`}
                              className="h-7 w-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-white active:scale-90 transition-all"
                            >
                              <Minus size={12} />
                            </button>
                            <div className="min-w-[32px] text-center px-1">
                              <span className="block font-mono tabular-nums text-xs font-bold text-white leading-none">
                                {qtySelected}x
                              </span>
                              <span
                                className={`block font-mono tabular-nums text-[9px] leading-tight mt-0.5 ${
                                  isConvenienceMode ? 'text-emerald-300' : 'text-accent-light'
                                }`}
                              >
                                R$ {itemSubtotal.toFixed(0)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleStepProductQuantity(product, 1, e)}
                              disabled={qtySelected >= stock}
                              aria-label={`Aumentar ${product.name}`}
                              className="h-7 w-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-white disabled:opacity-30 active:scale-90 transition-all"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        ) : (
                          <span
                            className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
                              outOfStock
                                ? 'border-zinc-800 bg-zinc-900/40 text-zinc-700'
                                : isConvenienceMode
                                ? 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300'
                                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-accent/50 hover:text-white'
                            }`}
                          >
                            <Plus size={13} />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resumo dos Selecionados e Novo Total */}
          {selectedItems.length > 0 && (
            <div className="rounded-2xl bg-zinc-950 border border-zinc-800/90 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 font-semibold flex items-center gap-1.5">
                  {isConvenienceMode ? (
                    <Coffee size={13} className="text-emerald-400" />
                  ) : (
                    <ShoppingBag size={13} className="text-accent-light" />
                  )}
                  Selecionados ({totalUnitsSelected} un.)
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedMap({})}
                  className="text-[11px] text-zinc-400 hover:text-rose-400 transition-colors"
                >
                  Limpar
                </button>
              </div>

              <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                <span className="text-zinc-400">
                  + R$ {addedTotal.toFixed(2).replace('.', ',')}
                </span>
                <span className="text-sm font-bold text-emerald-400 font-mono tabular-nums">
                  Novo Total: R$ {newApptTotal.toFixed(2).replace('.', ',')}
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-rose-950/40 border border-rose-500/30 p-3 flex items-center gap-2 text-xs text-rose-200">
              <AlertCircle size={14} className="text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <PrimaryButton
            type="submit"
            disabled={submitting || selectedItems.length === 0}
          >
            {submitting
              ? 'Salvando…'
              : selectedItems.length > 0
              ? `Confirmar (+ R$ ${addedTotal.toFixed(2).replace('.', ',')})`
              : 'Selecione acima'}
          </PrimaryButton>
        </form>
      )}
    </BottomSheet>
  );
}
