'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Package,
  Plus,
  Minus,
  Check,
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
  // Mapa { [productId]: quantity } para seleção múltipla
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

  // Filtra estritamente por modo ('conveniencia' vs 'produto') e garante trava de permissão
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
      await seedDefaultConvenienceProducts();
      await loadProductsCatalog({ forceSpinner: true });
      toast.success('Itens padrão de Conveniência carregados com sucesso!');
    } catch {
      setError('Não foi possível carregar os itens padrão de Conveniência.');
    } finally {
      setSeedingConvenience(false);
    }
  }

  // Lista detalhada dos itens selecionados no carrinho
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
      setError('Acesso restrito ao Barbeiro Chefe (Administrador).');
      return;
    }
    if (selectedItems.length === 0) {
      setError(
        isConvenienceMode
          ? 'Selecione pelo menos um item de conveniência para adicionar à conta.'
          : 'Selecione pelo menos um produto em estoque para adicionar.'
      );
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

      // Atualiza imediatamente o estoque no cache local para próxima abertura instantânea
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
      setError(err?.message || 'Erro ao vincular itens ao atendimento.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={
        isConvenienceMode
          ? 'Conveniência • Bebidas & Snacks'
          : 'Adicionar Produtos ao Atendimento'
      }
    >
      {isConvenienceMode && !isChief ? (
        <div className="rounded-2xl border border-zinc-800 bg-surface/60 p-6 flex flex-col items-center justify-center text-center gap-3">
          <Lock size={24} className="text-zinc-500" />
          <p className="text-xs text-zinc-400">
            O módulo de Conveniência é exclusivo para o perfil do Barbeiro Chefe (Administrador).
          </p>
        </div>
      ) : (
        <form onSubmit={handleConfirm} className="space-y-4">
          {/* Resumo do Atendimento Atual */}
          <div className="rounded-2xl bg-[#070709] border border-zinc-800/90 p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">
                Cliente & Serviço
              </p>
              <p className="text-sm font-bold text-white truncate mt-0.5">
                {appointment.client_name || 'Cliente'}
              </p>
              <p className="text-xs text-zinc-400 truncate">
                {appointment.services?.name || appointment.service || 'Serviço'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[11px] text-zinc-500">Valor Atual</p>
              <p className="text-sm font-bold text-zinc-200 font-mono tabular-nums">
                R$ {currentApptTotal.toFixed(2).replace('.', ',')}
              </p>
            </div>
          </div>

          {isConvenienceMode && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 flex items-center justify-between gap-2 text-[11px] text-emerald-300">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Coffee size={13} className="text-emerald-400 shrink-0" />
                Conveniência (Exclusivo Chefe): 100% retido no Caixa Geral (0% comissão colab.)
              </span>
            </div>
          )}

          {/* Lista de Itens com Seleção Múltipla e Controle Individual de Quantidade */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-xs font-semibold text-zinc-300">
                {isConvenienceMode
                  ? 'Selecione as bebidas / snacks'
                  : 'Selecione um ou mais produtos'}
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
                    {selectedItems.length} selecionado{selectedItems.length > 1 ? 's' : ''} (
                    {totalUnitsSelected} un.)
                  </span>
                )}
                <span className="text-[11px] text-zinc-500">{products.length} no catálogo</span>
              </div>
            </div>

            {loading && products.length === 0 ? (
              <div className="space-y-2 py-2">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-16 rounded-2xl bg-zinc-900/70 border border-zinc-800/70 animate-pulse flex items-center px-3 gap-3"
                  >
                    <div className="h-11 w-11 rounded-xl bg-zinc-800 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 rounded bg-zinc-800" />
                      <div className="h-2.5 w-1/3 rounded bg-zinc-800/70" />
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-center gap-2 pt-1 text-zinc-400 text-xs">
                  <Loader2 size={14} className="animate-spin text-accent" />
                  <span>Sincronizando estoque…</span>
                </div>
              </div>
            ) : loadError && products.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 text-center space-y-3">
                <AlertCircle size={22} className="mx-auto text-amber-400" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-zinc-200">
                    Não foi possível carregar o estoque agora.
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Verifique sua conexão e tente atualizar a lista abaixo.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => loadProductsCatalog({ forceSpinner: true })}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-xs font-semibold text-white hover:border-accent active:scale-95 transition-all"
                >
                  <RefreshCw size={13} />
                  Tentar novamente
                </button>
              </div>
            ) : products.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-surface/60 p-6 text-center space-y-3">
                {isConvenienceMode ? (
                  <Coffee size={24} className="mx-auto text-emerald-400" />
                ) : (
                  <Package size={24} className="mx-auto text-zinc-600" />
                )}
                <p className="text-xs text-zinc-400">
                  {isConvenienceMode
                    ? 'Nenhum item de Conveniência registado ainda. Carregue o catálogo padrão de bebidas e snacks ou cadastre na aba Serviços > Conveniência.'
                    : 'Nenhum produto registado no catálogo. Cadastre produtos na aba Serviços > Produtos.'}
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
                        <Loader2 size={14} className="animate-spin" /> Carregando Conveniência…
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} /> Carregar Bebidas & Snacks Padrão (5)
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
                      className={`w-full text-left rounded-2xl border p-2.5 flex items-center gap-3 transition-all select-none ${
                        outOfStock
                          ? 'border-zinc-900 bg-zinc-950/50 opacity-45 cursor-not-allowed'
                          : isSelected
                          ? isConvenienceMode
                            ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_20px_-6px_rgba(16,185,129,0.45)] cursor-pointer'
                            : 'border-accent bg-accent/10 shadow-[0_0_20px_-6px_rgba(225,29,72,0.45)] cursor-pointer'
                          : 'border-zinc-800/90 bg-[#0b0b0e] hover:border-zinc-700 cursor-pointer active:scale-[0.99]'
                      }`}
                    >
                      <div className="h-12 w-12 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center relative">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover object-center"
                          />
                        ) : isConvenienceMode ? (
                          <Coffee size={18} className="text-emerald-400" />
                        ) : (
                          <Package size={18} className="text-zinc-600" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate">{product.name}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${
                              outOfStock
                                ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                                : stock <= 3
                                ? 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                            }`}
                          >
                            {outOfStock ? 'Sem estoque' : `Estoque: ${stock} un.`}
                          </span>
                          <span className="text-[11px] font-mono tabular-nums text-zinc-300 font-semibold">
                            R$ {unitPrice.toFixed(2).replace('.', ',')} / un.
                          </span>
                        </div>
                      </div>

                      {/* Controle individual: se selecionado mostra stepper [- qty +], senão mostra botão de seleção */}
                      <div className="shrink-0 flex items-center gap-2">
                        {isSelected ? (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 bg-black/80 border border-zinc-700 rounded-xl p-1"
                          >
                            <button
                              type="button"
                              onClick={(e) => handleStepProductQuantity(product, -1, e)}
                              aria-label={`Diminuir quantidade de ${product.name}`}
                              className="h-7 w-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-white active:scale-90 transition-all"
                            >
                              <Minus size={13} />
                            </button>
                            <div className="min-w-[34px] text-center px-1">
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
                              aria-label={`Aumentar quantidade de ${product.name}`}
                              className="h-7 w-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-white disabled:opacity-30 active:scale-90 transition-all"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        ) : (
                          <div className="text-right flex items-center gap-2">
                            <span
                              className={`h-6 w-6 rounded-full border flex items-center justify-center transition-colors ${
                                outOfStock
                                  ? 'border-zinc-800 bg-zinc-900/40 text-zinc-700'
                                  : isConvenienceMode
                                  ? 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-emerald-400 hover:text-white'
                                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-accent-light hover:text-white'
                              }`}
                            >
                              <Plus size={13} />
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Resumo dos Itens Selecionados e Novo Total do Atendimento */}
          {selectedItems.length > 0 && (
            <div className="rounded-2xl bg-[#070709] border border-zinc-800/90 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-medium flex items-center gap-1.5">
                  {isConvenienceMode ? (
                    <Coffee size={13} className="text-emerald-400" />
                  ) : (
                    <ShoppingBag size={13} className="text-accent-light" />
                  )}
                  {isConvenienceMode
                    ? `Conveniência selecionada (${selectedItems.length})`
                    : `Produtos selecionados (${selectedItems.length})`}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedMap({})}
                  className="text-[11px] text-zinc-400 hover:text-rose-400 transition-colors"
                >
                  Limpar seleção
                </button>
              </div>

              <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
                {selectedItems.map((item) => (
                  <div
                    key={item.productId}
                    className="flex items-center justify-between text-xs bg-black/60 border border-zinc-800/70 rounded-xl px-2.5 py-1.5"
                  >
                    <span className="text-zinc-200 truncate">
                      <strong
                        className={
                          isConvenienceMode ? 'text-emerald-300' : 'text-accent-light'
                        }
                      >
                        {item.quantity}x
                      </strong>{' '}
                      {item.product.name}
                    </span>
                    <span className="font-mono tabular-nums text-zinc-300 font-semibold shrink-0 ml-2">
                      + R$ {item.subtotal.toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-zinc-800/80 space-y-1">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    {isConvenienceMode
                      ? `Subtotal Conveniência (${totalUnitsSelected} un.)`
                      : `Subtotal de produtos (${totalUnitsSelected} un.)`}
                  </span>
                  <span className="font-mono tabular-nums text-zinc-200 font-semibold">
                    + R$ {addedTotal.toFixed(2).replace('.', ',')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pt-0.5">
                  <span className="text-zinc-300 font-semibold flex items-center gap-1">
                    <Sparkles size={12} className="text-emerald-400" />
                    Novo Total do Atendimento
                  </span>
                  <span className="text-sm font-bold text-emerald-400 font-mono tabular-nums">
                    R$ {newApptTotal.toFixed(2).replace('.', ',')}
                  </span>
                </div>
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
              ? isConvenienceMode
                ? 'Adicionando Conveniência…'
                : 'Adicionando e atualizando estoque…'
              : selectedItems.length > 0
              ? `Confirmar ${totalUnitsSelected} ${
                  totalUnitsSelected === 1 ? 'item' : 'itens'
                } (+ R$ ${addedTotal.toFixed(2).replace('.', ',')})`
              : isConvenienceMode
              ? 'Selecione itens de Conveniência acima'
              : 'Selecione os produtos acima'}
          </PrimaryButton>
        </form>
      )}
    </BottomSheet>
  );
}
