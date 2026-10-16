"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EyeOff, ImageOff, Plus, RefreshCcw, Sparkles } from "lucide-react";
import { listGallery } from "@/lib/actions/gallery";
import { endSession } from "@/lib/session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { GALLERY_CATEGORIES, GALLERY_TABLE, categoryLabel } from "@/lib/constants/gallery";
import GalleryUploadSheet from "@/components/admin/GalleryUploadSheet";
import GalleryItemSheet from "@/components/admin/GalleryItemSheet";
import Link from "next/link";

export default function GaleriaPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("todos");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++requestRef.current;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const res = await listGallery();
      if (!mountedRef.current || requestId !== requestRef.current) return;
      if (res?.error === "AUTH_EXPIRED") return endSession();
      if (res?.error) {
        if (!silent) setError(res.error);
        return;
      }
      setItems(Array.isArray(res?.items) ? res.items : []);
      setError("");
    } catch {
      if (mountedRef.current && !silent) {
        setError("Não foi possível carregar a galeria no momento.");
      }
    } finally {
      if (mountedRef.current && requestId === requestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Sincronização em tempo real caso o banco suporte Postgres Changes
  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load({ silent: true }), 300);
    };

    try {
      const supabase = getSupabaseBrowserClient();
      const channel = supabase
        .channel("haircut-gallery-panel")
        .on("postgres_changes", { event: "*", schema: "public", table: GALLERY_TABLE }, refresh)
        .subscribe();

      const onVisible = () => document.visibilityState === "visible" && refresh();
      document.addEventListener("visibilitychange", onVisible);

      return () => {
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisible);
        supabase.removeChannel(channel);
      };
    } catch {
      // Ignora erro de realtime se offline
    }
  }, [load]);

  const visibleItems = useMemo(
    () => (filter === "todos" ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  );

  return (
    <div className="px-4 pt-4 pb-24">
      {/* Barra superior de status e botão de upload */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-zinc-400 text-xs font-medium">
          {items.length} foto{items.length !== 1 ? "s" : ""} no catálogo
        </p>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none shadow-sm"
        >
          <Plus size={14} /> Adicionar
        </button>
      </div>

      {/* Filtro por Categorias Oficiais */}
      <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 scroll-touch no-scrollbar">
        {[{ value: "todos", label: "Todos" }, ...GALLERY_CATEGORIES].map((c) => {
          const active = filter === c.value;
          return (
            <button
              key={c.value}
              onClick={() => setFilter(c.value)}
              aria-pressed={active}
              className={`shrink-0 h-8 rounded-full px-3.5 text-xs font-medium border transition-all touch-manipulation select-none active:scale-95 ${
                active
                  ? "bg-accent text-white border-accent shadow-md shadow-red-900/30"
                  : "bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700 active:bg-zinc-800"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-2.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-xl bg-surface border border-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 pt-12 text-center px-4">
          <div className="h-12 w-12 rounded-full bg-red-950/40 border border-red-900/50 flex items-center justify-center text-accent-light">
            <ImageOff size={22} />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">Não foi possível carregar as fotos</p>
            <p className="text-zinc-400 text-xs mt-1 max-w-xs">{error}</p>
          </div>
          <button
            onClick={() => load()}
            className="flex items-center gap-1.5 h-9 rounded-lg border border-zinc-700 bg-surface px-4 text-xs font-medium text-white active:bg-zinc-800 transition-all"
          >
            <RefreshCcw size={13} /> Tentar novamente
          </button>
        </div>
      ) : items.length === 0 ? (
        /* Estado vazio amigável quando a tabela está vazia (0 fotos no catálogo) */
        <div className="flex flex-col items-center justify-center pt-12 px-4 text-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-surface border border-zinc-800 flex items-center justify-center text-zinc-500 shadow-sm">
            <Sparkles size={26} className="text-accent-light" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">0 fotos no catálogo</p>
            <p className="text-zinc-400 text-xs mt-1 max-w-xs">
              Nenhuma foto cadastrada ainda. Toque no botão abaixo para adicionar as referências de corte da barbearia.
            </p>
          </div>
          <button
            onClick={() => setUploadOpen(true)}
            className="mt-2 flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full px-4 py-2 active:scale-95 transition-all shadow-md shadow-accent/20"
          >
            <Plus size={14} /> Adicionar foto
          </button>
        </div>
      ) : visibleItems.length === 0 ? (
        /* Estado quando a categoria filtrada não possui fotos */
        <div className="flex flex-col items-center justify-center pt-12 px-4 text-center gap-2">
          <ImageOff className="text-zinc-600 mb-1" size={26} />
          <p className="text-zinc-400 text-xs">
            Nenhuma foto cadastrada na categoria <strong className="text-white">{categoryLabel(filter)}</strong>.
          </p>
          <button
            onClick={() => setFilter("todos")}
            className="text-accent-light text-xs font-medium hover:underline mt-1"
          >
            Ver todas as fotos
          </button>
        </div>
      ) : (
        /* Grid das fotos organizadas por categoria */
        <div className="grid grid-cols-2 gap-2.5">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelected(item)}
              className="relative aspect-[4/5] rounded-xl overflow-hidden border border-zinc-800 bg-surface text-left active:scale-[0.98] active:opacity-85 transition-all touch-manipulation select-none group"
            >
              <img
                src={item.image_url}
                alt={item.title}
                loading="lazy"
                decoding="async"
                className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 ${
                  item.is_active ? "" : "opacity-40"
                }`}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 pt-8">
                <p className="text-white text-xs font-semibold truncate">{item.title}</p>
                <p className="text-zinc-400 text-[10px] truncate mt-0.5">
                  {categoryLabel(item.category)}
                  {item.barber_name ? ` · ${item.barber_name}` : ""}
                </p>
              </div>
              {!item.is_active && (
                <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/80 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-zinc-300 border border-white/10">
                  <EyeOff size={10} /> Oculta
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Sheets de Upload e Edição */}
      <GalleryUploadSheet
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => load({ silent: true })}
      />

      <GalleryItemSheet
        item={selected}
        onClose={() => setSelected(null)}
        onChanged={() => load({ silent: true })}
        onRemoved={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
      />
    </div>
  );
}
