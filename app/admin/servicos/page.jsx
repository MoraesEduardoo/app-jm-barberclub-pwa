'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Plus,
  Lock,
  ArrowUpDown,
  Check,
  Loader2,
  Sparkles,
  Scissors,
  Package,
  Coffee,
  RefreshCw,
} from 'lucide-react';
import { Reorder, useDragControls } from 'framer-motion';
import { listServices, reorderServices } from '@/lib/actions/services';
import { listProducts, seedDefaultConvenienceProducts } from '@/lib/actions/products';
import { bootstrapInitialServicesCatalogAction } from '@/lib/actions/bootstrap';
import {
  cacheKeys,
  getCache,
  setCache,
  invalidateCache,
} from '@/lib/admin-cache';
import ServiceRow from '@/components/admin/ServiceRow';
import ServiceFormSheet from '@/components/admin/ServiceFormSheet';
import ProductFormSheet from '@/components/admin/ProductFormSheet';
import { useBarber } from '@/lib/barber-context';
import { PERMISSION_KEYS, isChefe } from '@/lib/auth';
import { isConvenienceProduct, isOwnerBarber } from '@/lib/commission';
import { toast } from '@/lib/toast';

const SERVICES_KEY = cacheKeys.services();
const PRODUCTS_KEY = cacheKeys.products();

function ReorderableServiceRow({ service, onEdit }) {
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);

  return (
    <Reorder.Item
      value={service}
      id={service.id}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      whileDrag={{
        scale: 1.02,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(220, 38, 38, 0.3)',
        zIndex: 50,
      }}
      transition={{ duration: 0.2 }}
      className="relative select-none list-none touch-pan-y"
      style={{ touchAction: 'pan-y' }}
    >
      <ServiceRow
        service={service}
        dragControls={dragControls}
        isDragging={isDragging}
        onClick={() => onEdit(service)}
      />
    </Reorder.Item>
  );
}

export default function ServicosPage() {
  const { barber, can } = useBarber();
  const canManage = can(PERMISSION_KEYS.MANAGE_SERVICES);
  const isChief = isChefe(barber) || isOwnerBarber(barber);

  const [activeTab, setActiveTab] = useState('services'); // 'services' | 'products' | 'convenience'
  const [services, setServices] = useState(() => {
    const cached = getCache(SERVICES_KEY);
    return Array.isArray(cached) ? cached : [];
  });
  const [products, setProducts] = useState(() => {
    const cached = getCache(PRODUCTS_KEY);
    return Array.isArray(cached) ? cached : [];
  });
  const [loading, setLoading] = useState(() => {
    const cachedServices = getCache(SERVICES_KEY);
    return !(Array.isArray(cachedServices) && cachedServices.length > 0);
  });
  const [errorMsg, setErrorMsg] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [seedingConvenience, setSeedingConvenience] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [defaultProductCategory, setDefaultProductCategory] = useState('barbearia');

  const [saveStatus, setSaveStatus] = useState(null); // 'saving' | 'saved' | null
  const saveTimeoutRef = useRef(null);

  const regularProducts = useMemo(
    () => products.filter((p) => !isConvenienceProduct(p)),
    [products]
  );

  const convenienceProducts = useMemo(
    () => (isChief ? products.filter((p) => isConvenienceProduct(p)) : []),
    [products, isChief]
  );

  const loadCatalog = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setErrorMsg(null);

    const fetchProductsFast = async () => {
      try {
        const res = await fetch('/api/products', { method: 'GET', cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json?.data)) return json.data;
        }
      } catch {}
      return listProducts();
    };

    try {
      const [servicesResult, productsResult] = await Promise.allSettled([
        listServices(),
        fetchProductsFast(),
      ]);

      if (servicesResult.status === 'fulfilled') {
        const nextServices = Array.isArray(servicesResult.value) ? servicesResult.value : [];
        setServices(nextServices);
        setCache(SERVICES_KEY, nextServices);
      } else {
        console.error('[ServicosPage] Erro ao buscar serviços:', servicesResult.reason);
        setErrorMsg('Não foi possível sincronizar todos os itens. Tente atualizar.');
      }

      if (productsResult.status === 'fulfilled') {
        const nextProducts = Array.isArray(productsResult.value) ? productsResult.value : [];
        setProducts(nextProducts);
        setCache(PRODUCTS_KEY, nextProducts);
      } else {
        console.error('[ServicosPage] Erro ao buscar produtos:', productsResult.reason);
      }
    } catch (err) {
      console.error('[ServicosPage] Exceção ao carregar catálogo:', err);
      setErrorMsg('Falha de comunicação ao carregar catálogo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cachedServices = getCache(SERVICES_KEY);
    const hasLoadedServices = Array.isArray(cachedServices) && cachedServices.length > 0;
    loadCatalog({ silent: hasLoadedServices });
  }, [loadCatalog]);

  function handleCloseServiceSheet() {
    setSheetOpen(false);
    setEditing(null);
    loadCatalog({ silent: true });
  }

  function handleCloseProductSheet() {
    setProductSheetOpen(false);
    setEditingProduct(null);
    loadCatalog({ silent: true });
  }

  async function handleSeedCatalog() {
    setBootstrapping(true);
    try {
      const res = await bootstrapInitialServicesCatalogAction();
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success('Catálogo base do JM BarberClub carregado com sucesso!');
        invalidateCache(cacheKeys.bootstrapStatus());
        await loadCatalog({ silent: false });
      }
    } catch {
      toast.error('Erro ao carregar catálogo inicial.');
    } finally {
      setBootstrapping(false);
    }
  }

  async function handleSeedConvenience() {
    if (!isChief) return;
    setSeedingConvenience(true);
    try {
      const res = await seedDefaultConvenienceProducts();
      if (Array.isArray(res?.items) && res.items.length > 0) {
        setProducts((prev) => {
          const byName = new Map(
            prev.map((p) => [String(p.name || '').toLowerCase().trim(), p])
          );
          for (const item of res.items) {
            byName.set(String(item.name || '').toLowerCase().trim(), item);
          }
          const merged = Array.from(byName.values());
          setCache(PRODUCTS_KEY, merged);
          return merged;
        });
      }
      toast.success('Catálogo de Conveniência carregado!');
      await loadCatalog({ silent: true });
    } catch {
      toast.error('Erro ao carregar catálogo de Conveniência.');
    } finally {
      setSeedingConvenience(false);
    }
  }

  function handleReorder(newOrder) {
    const sequencedOrder = newOrder.map((s, idx) => {
      const seq = idx + 1;
      return {
        ...s,
        ordem: seq,
        position: seq,
        display_order: seq,
      };
    });
    setServices(sequencedOrder);
    setCache(SERVICES_KEY, sequencedOrder);
    setSaveStatus('saving');

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const ids = sequencedOrder.map((s) => s.id);
        await reorderServices(ids);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (err) {
        console.error('Falha ao persistir ordenação:', err);
        setSaveStatus(null);
      }
    }, 400);
  }

  if (!canManage) {
    return (
      <div className="flex flex-col items-center justify-center px-8 pt-24 text-center gap-3">
        <Lock className="text-zinc-600" size={28} />
        <p className="text-zinc-500 text-sm">
          Você não tem permissão para gerenciar serviços e produtos. Fale com o barbeiro
          chefe para liberar esse acesso.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-32">
      {/* Seletor Serviços / Produtos / Conveniência (Conveniência restrito ao Barbeiro Chefe) */}
      <div
        className={`grid ${
          isChief ? 'grid-cols-3' : 'grid-cols-2'
        } gap-1.5 bg-surface border border-zinc-800 rounded-xl p-1 mb-4`}
      >
        <button
          type="button"
          onClick={() => setActiveTab('services')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'services'
              ? 'bg-accent text-white shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Scissors size={14} />
          <span>Serviços ({services.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('products')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'products'
              ? 'bg-accent text-white shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Package size={14} />
          <span>Produtos ({regularProducts.length})</span>
        </button>

        {isChief && (
          <button
            type="button"
            onClick={() => setActiveTab('convenience')}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'convenience'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Coffee size={14} />
            <span>Conveniência ({convenienceProducts.length})</span>
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => loadCatalog({ silent: false })}
            className="flex items-center gap-1 rounded-lg bg-rose-500/20 px-2.5 py-1 font-semibold text-white active:scale-95"
          >
            <RefreshCw size={12} /> Recarregar
          </button>
        </div>
      )}

      {activeTab === 'services' ? (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-zinc-400 text-xs font-medium">
              {services.length} serviço{services.length !== 1 ? 's' : ''} no catálogo
            </p>
            <div className="flex items-center gap-2">
              {saveStatus === 'saving' && (
                <span className="flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-full px-2.5 py-1 animate-pulse">
                  <Loader2 size={12} className="animate-spin text-accent" /> Salvando ordem…
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-900/60 rounded-full px-2.5 py-1">
                  <Check size={12} /> Ordem salva
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setSheetOpen(true);
                }}
                className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none shadow-sm"
              >
                <Plus size={14} /> Novo Serviço
              </button>
            </div>
          </div>

          {services.length > 1 && (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-3 px-1">
              <ArrowUpDown size={12} className="text-accent-light shrink-0" />
              <span>
                Segure a alça <strong className="text-zinc-400 font-semibold">⠿</strong> e arraste
                para definir a ordem oficial
              </span>
            </div>
          )}

          {loading && services.length === 0 ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-[104px] rounded-2xl bg-surface animate-pulse" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-zinc-800 bg-surface/60 p-6 flex flex-col items-center justify-center text-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
                <Scissors size={22} />
              </div>
              <div className="space-y-1 max-w-xs">
                <h3 className="text-white font-bold text-sm">Catálogo de Serviços Vazio</h3>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  O banco de dados está limpo. Você pode cadastrar seus serviços um por um
                  manualmente ou carregar o catálogo oficial do JM BarberClub.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full max-w-xs">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setSheetOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 h-10 rounded-xl bg-accent hover:bg-accent-light text-white text-xs font-semibold shadow-sm active:scale-95 transition-all"
                >
                  <Plus size={14} /> Cadastrar Manualmente
                </button>
                <button
                  type="button"
                  disabled={bootstrapping}
                  onClick={handleSeedCatalog}
                  className="w-full flex items-center justify-center gap-1.5 h-10 rounded-xl bg-elevated border border-zinc-700 hover:border-zinc-600 text-zinc-200 text-xs font-semibold active:scale-95 transition-all disabled:opacity-50"
                >
                  {bootstrapping ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-accent" /> Carregando…
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} className="text-amber-400" /> Catálogo Padrão (13)
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <Reorder.Group
              axis="y"
              values={services}
              onReorder={handleReorder}
              className="space-y-3 touch-pan-y"
              style={{ touchAction: 'pan-y' }}
            >
              {services.map((service) => (
                <ReorderableServiceRow
                  key={service.id}
                  service={service}
                  onEdit={(srv) => {
                    setEditing(srv);
                    setSheetOpen(true);
                  }}
                />
              ))}
            </Reorder.Group>
          )}
        </>
      ) : activeTab === 'convenience' && isChief ? (
        <>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 mb-3 flex items-center justify-between gap-2 text-xs text-emerald-300">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Coffee size={13} className="text-emerald-400 shrink-0" />
              Exclusivo Chefe
            </span>
            <span className="font-mono text-[10px] text-emerald-400 font-bold">
              100% Caixa • 0% Colab.
            </span>
          </div>

          <div className="flex items-center justify-between mb-3">
            <p className="text-zinc-400 text-xs font-medium">
              {convenienceProducts.length} {convenienceProducts.length === 1 ? 'item' : 'itens'}
            </p>
            <button
              type="button"
              onClick={() => {
                setDefaultProductCategory('conveniencia');
                setEditingProduct(null);
                setProductSheetOpen(true);
              }}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:scale-95 transition-all touch-manipulation select-none shadow-sm"
            >
              <Plus size={14} /> Novo Item
            </button>
          </div>

          {loading && convenienceProducts.length === 0 ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-[96px] rounded-2xl bg-surface animate-pulse" />
              ))}
            </div>
          ) : convenienceProducts.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 flex flex-col items-center justify-center text-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Coffee size={20} />
              </div>
              <div className="space-y-1 max-w-xs">
                <h3 className="text-white font-bold text-sm">Conveniência Vazia</h3>
                <p className="text-zinc-400 text-xs">
                  Bebidas e snacks (100% Caixa).
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-2 w-full max-w-xs">
                <button
                  type="button"
                  onClick={() => {
                    setDefaultProductCategory('conveniencia');
                    setEditingProduct(null);
                    setProductSheetOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm active:scale-95 transition-all"
                >
                  <Plus size={14} /> Novo Item
                </button>
                <button
                  type="button"
                  disabled={seedingConvenience}
                  onClick={handleSeedConvenience}
                  className="w-full flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-zinc-600 text-zinc-200 text-xs font-semibold active:scale-95 transition-all disabled:opacity-50"
                >
                  {seedingConvenience ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-emerald-400" /> Carregando…
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} className="text-emerald-400" /> Carregar Bebidas & Snacks Padrão
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {convenienceProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setDefaultProductCategory('conveniencia');
                    setEditingProduct(product);
                    setProductSheetOpen(true);
                  }}
                  className="w-full text-left rounded-2xl border border-zinc-800/90 bg-surface hover:border-emerald-500/40 p-3 flex items-center gap-3.5 transition-all active:scale-[0.99]"
                >
                  <div className="h-20 w-20 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover object-center rounded-xl"
                      />
                    ) : (
                      <Coffee size={22} className="text-emerald-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold text-sm truncate">
                        {product.name}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold">
                        Conveniência
                      </span>
                      {!product.is_active && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                          Inativo
                        </span>
                      )}
                    </div>

                    {product.description && (
                      <p className="text-zinc-400 text-xs line-clamp-1 mt-0.5">
                        {product.description}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 font-medium">
                        Stock: {product.stock_quantity} un.
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 pl-2">
                    <span className="text-white font-bold text-sm">
                      R$ {Number(product.price || 0).toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-zinc-400 text-xs font-medium">
              {regularProducts.length} produto{regularProducts.length !== 1 ? 's' : ''} registado
              {regularProducts.length !== 1 ? 's' : ''}
            </p>
            <button
              type="button"
              onClick={() => {
                setDefaultProductCategory('barbearia');
                setEditingProduct(null);
                setProductSheetOpen(true);
              }}
              className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none shadow-sm"
            >
              <Plus size={14} /> Novo Produto
            </button>
          </div>

          {loading && regularProducts.length === 0 ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-[96px] rounded-2xl bg-surface animate-pulse" />
              ))}
            </div>
          ) : regularProducts.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-zinc-800 bg-surface/60 p-6 flex flex-col items-center justify-center text-center gap-4">
              <div className="h-12 w-12 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
                <Package size={22} />
              </div>
              <div className="space-y-1 max-w-xs">
                <h3 className="text-white font-bold text-sm">Nenhum Produto Registado</h3>
                <p className="text-zinc-400 text-xs leading-relaxed">
                  Registe pomadas, óleos para barba, pentes e outros produtos com preço, stock e
                  foto guardada no Supabase Storage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDefaultProductCategory('barbearia');
                  setEditingProduct(null);
                  setProductSheetOpen(true);
                }}
                className="flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-accent hover:bg-accent-light text-white text-xs font-semibold shadow-sm active:scale-95 transition-all"
              >
                <Plus size={14} /> Registar Primeiro Produto
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {regularProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setDefaultProductCategory('barbearia');
                    setEditingProduct(product);
                    setProductSheetOpen(true);
                  }}
                  className="w-full text-left rounded-2xl border border-zinc-800/90 bg-surface hover:border-zinc-700 p-3 flex items-center gap-3.5 transition-all active:scale-[0.99]"
                >
                  <div className="h-20 w-20 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center">
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover object-center rounded-xl"
                      />
                    ) : (
                      <Package size={22} className="text-zinc-600" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold text-sm truncate">
                        {product.name}
                      </span>
                      {!product.is_active && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                          Inativo
                        </span>
                      )}
                    </div>

                    {product.description && (
                      <p className="text-zinc-400 text-xs line-clamp-1 mt-0.5">
                        {product.description}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 font-medium">
                        Stock: {product.stock_quantity} un.
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 pl-2">
                    <span className="text-white font-bold text-sm">
                      R$ {Number(product.price || 0).toFixed(2).replace('.', ',')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <ServiceFormSheet
        key={editing?.id || (sheetOpen ? 'new-service' : 'none')}
        open={sheetOpen}
        onClose={handleCloseServiceSheet}
        service={editing}
      />

      <ProductFormSheet
        key={
          editingProduct?.id ||
          (productSheetOpen ? `new-product-${defaultProductCategory}` : 'none')
        }
        open={productSheetOpen}
        onClose={handleCloseProductSheet}
        product={editingProduct}
        defaultCategory={defaultProductCategory}
      />
    </div>
  );
}
