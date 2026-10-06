"use client";

/**
 * App do CLIENTE (jm-barberclubV2 / chat de agendamento) — seletor de foto de referência.
 * Só LÊ: usa a anon key e a policy pública da tabela (apenas fotos ativas).
 * Sincroniza em tempo real (Supabase Realtime) e também ao voltar para o app.
 *
 * Uso:
 *   <HaircutGalleryPicker
 *     supabase={supabase}                       // seu cliente Supabase (anon)
 *     selectedId={referencePhoto?.id}
 *     onSelect={(photo) => setReferencePhoto(photo)}   // photo = { id, title, category, image_url } | null
 *   />
 * Ao criar o agendamento, envie:  reference_photo_id: referencePhoto?.id ?? null
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ImageOff, Loader2, RefreshCcw } from "lucide-react";

const BUCKET = "haircut-gallery";
const CATEGORIES = [
  { value: "todos", label: "Todos" },
  { value: "degrade", label: "Degradê" },
  { value: "social", label: "Social" },
  { value: "barba", label: "Barba" },
  { value: "infantil", label: "Infantil" },
  { value: "outros", label: "Outros" },
];

export default function HaircutGalleryPicker({ supabase, selectedId = null, onSelect, allowSkip = true }) {
  const [photos, setPhotos] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [filter, setFilter] = useState("todos");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setStatus("loading");
      try {
        const { data, error } = await supabase
          .from("haircut_gallery")
          .select("id, title, category, image_path")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;

        setPhotos(
          data.map((p) => ({
            ...p,
            image_url: supabase.storage.from(BUCKET).getPublicUrl(p.image_path).data.publicUrl,
          })),
        );
        setStatus("ready");
      } catch {
        if (!silent) setStatus("error");
      }
    },
    [supabase],
  );

  useEffect(() => {
    load();
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(true), 300);
    };
    const channel = supabase
      .channel("haircut-gallery-client")
      .on("postgres_changes", { event: "*", schema: "public", table: "haircut_gallery" }, refresh)
      .subscribe();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const shown = useMemo(
    () => (filter === "todos" ? photos : photos.filter((p) => p.category === filter)),
    [photos, filter],
  );

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-zinc-500 text-sm">
        <Loader2 size={16} className="animate-spin" /> Carregando estilos…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-zinc-400 text-sm">Não foi possível carregar as fotos.</p>
        <button
          onClick={() => load()}
          className="flex items-center gap-1.5 h-10 rounded-lg border border-zinc-700 px-4 text-sm font-medium text-white active:bg-zinc-900"
        >
          <RefreshCcw size={14} /> Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-3">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setFilter(c.value)}
            aria-pressed={filter === c.value}
            className={`shrink-0 h-8 rounded-full px-3.5 text-xs font-medium border ${
              filter === c.value ? "bg-red-600 border-red-600 text-white" : "bg-zinc-900 border-zinc-800 text-zinc-300"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <ImageOff className="text-zinc-600" size={26} />
          <p className="text-zinc-500 text-sm">Nenhuma foto nesta categoria ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {shown.map((p) => {
            const active = p.id === selectedId;
            return (
              <button
                key={p.id}
                onClick={() => onSelect?.(active ? null : p)}
                aria-pressed={active}
                className={`relative aspect-[4/5] overflow-hidden rounded-xl border-2 text-left transition-colors ${
                  active ? "border-red-600" : "border-zinc-800"
                }`}
              >
                <img src={p.image_url} alt={p.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2.5 pt-8">
                  <p className="truncate text-xs font-semibold text-white">{p.title}</p>
                </div>
                {active && (
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white">
                    <Check size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {allowSkip && (
        <button
          onClick={() => onSelect?.(null)}
          className="mt-3 w-full h-11 rounded-lg border border-zinc-800 text-sm font-medium text-zinc-400 active:bg-zinc-900"
        >
          Prefiro não escolher uma referência
        </button>
      )}
    </div>
  );
}
