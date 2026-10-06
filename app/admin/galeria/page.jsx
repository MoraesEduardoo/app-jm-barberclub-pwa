"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EyeOff, ImageOff, Plus, RefreshCcw } from "lucide-react";
import { listGallery } from "@/lib/actions/gallery";
import { endSession } from "@/lib/session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { GALLERY_CATEGORIES, GALLERY_TABLE, categoryLabel } from "@/lib/constants/gallery";
import GalleryUploadSheet from "@/components/admin/GalleryUploadSheet";
import GalleryItemSheet from "@/components/admin/GalleryItemSheet";

export default function GaleriaPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("todos");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0); // descarta respostas antigas (evita lista "voltando no tempo")

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
      setItems(res.items);
      setError("");
    } catch {
      if (mountedRef.current && !silent) setError("Não foi possível conectar. Verifique a internet.");
    } finally {
      if (mountedRef.current && requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Sincronização: qualquer mudança na tabela (de qualquer barbeiro) recarrega a lista.
  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load({ silent: true }), 300);
    };

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("haircut-gallery-panel")
      .on("postgres_changes", { event: "*", schema: "public", table: GALLERY_TABLE }, refresh)
      .subscribe();

    // Rede de segurança: ao voltar para o app (PWA em segundo plano), atualiza.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const visibleItems = useMemo(
    () => (filter === "todos" ? items : items.filter((i) => i.category === filter)),
    [items, filter],
  );

  return (
    <div className="px-4 pt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-zinc-500 text-xs">
          {items.length} foto{items.length !== 1 ? "s" : ""} no catálogo
        </p>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1.5 bg-accent text-white text-xs font-semibold rounded-full pl-2.5 pr-3 py-1.5 active:bg-accent-dark"
        >
          <Plus size={14} /> Adicionar
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4">
        {[{ value: "todos", label: "Todos" }, ...GALLERY_CATEGORIES].map((c) => {
          const active = filter === c.value;
          return (
            <button
              key={c.value}
              onClick={() => setFilter(c.value)}
              aria-pressed={active}
              className={`shrink-0 h-8 rounded-full px-3.5 text-xs font-medium border transition-colors ${
                active
                  ? "bg-accent text-white border-accent shadow-md shadow-red-900/30"
                  : "bg-zinc-900/45 border-zinc-800 text-zinc-300"
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
            <div key={i} className="aspect-[4/5] rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 pt-16 text-center">
          <p className="text-zinc-400 text-sm">{error}</p>
          <button
            onClick={() => load()}
            className="flex items-center gap-1.5 h-10 rounded-lg border border-zinc-700 px-4 text-sm font-medium text-white active:bg-zinc-900"
          >
            <RefreshCcw size={14} /> Tentar novamente
          </button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-col items-center gap-2 pt-16 text-center">
          <ImageOff className="text-zinc-600" size={28} />
          <p className="text-zinc-500 text-sm">
            {items.length === 0 ? "Nenhuma foto ainda. Toque em Adicionar." : "Nenhuma foto nesta categoria."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelected(item)}
              className="relative aspect-[4/5] rounded-xl overflow-hidden border border-zinc-800 bg-surface text-left active:opacity-80 transition-opacity"
            >
              <img
                src={item.image_url}
                alt={item.title}
                loading="lazy"
                decoding="async"
                className={`h-full w-full object-cover ${item.is_active ? "" : "opacity-40"}`}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2.5 pt-8">
                <p className="text-white text-xs font-semibold truncate">{item.title}</p>
                <p className="text-zinc-400 text-[10px] truncate">
                  {categoryLabel(item.category)}
                  {item.barber_name ? ` · ${item.barber_name}` : ""}
                </p>
              </div>
              {!item.is_active && (
                <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                  <EyeOff size={10} /> Oculta
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <GalleryUploadSheet open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => load({ silent: true })} />

      <GalleryItemSheet
        item={selected}
        onClose={() => setSelected(null)}
        onChanged={() => load({ silent: true })}
        onRemoved={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
      />
    </div>
  );
}
