"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ImageOff, Loader2, RefreshCcw } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

/**
 * =========================================================================================
 * ARQUIVO: /client-app/HaircutGalleryPicker.jsx
 * CÓDIGO RESTAURADO AO ESTADO ORIGINAL ESTÁVEL
 * =========================================================================================
 * Componente do aplicativo do cliente / fluxo de agendamento:
 * - Lista as fotos ativas cadastradas na tabela `haircut_gallery` no Supabase.
 * - Permite ao cliente navegar pelas categorias (Degradê, Social, Barba, etc.).
 * - O cliente seleciona a foto de referência desejada para o seu corte ou opta por pular.
 * - Ao selecionar, o ID da foto (`reference_photo_id`) é gravado no agendamento.
 * =========================================================================================
 */

export const GALLERY_BUCKET = "haircut-gallery";
export const GALLERY_TABLE = "haircut_gallery";

export const CATEGORIES = [
  { value: "todos", label: "Todos" },
  { value: "degrade", label: "Degradê" },
  { value: "social", label: "Social" },
  { value: "barba", label: "Barba" },
  { value: "infantil", label: "Infantil" },
  { value: "outros", label: "Outros" },
];

function getPublicImageUrl(supabase, path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const { data } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path);
  return data?.publicUrl || "";
}

export default function HaircutGalleryPicker({
  value = null,
  onChange,
  onSelect,
  allowSkip = true,
  onSkip,
  className = "",
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("todos");

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    return createClient(url, anonKey);
  }, []);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      setError("Configuração do Supabase ausente.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data, error: fetchErr } = await supabase
        .from(GALLERY_TABLE)
        .select("id, title, category, barber_id, image_path, created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(100);

      if (fetchErr) throw fetchErr;

      const formatted = (data || []).map((row) => ({
        ...row,
        image_url: getPublicImageUrl(supabase, row.image_path),
      }));

      setItems(formatted);
    } catch (err) {
      console.error("[HaircutGalleryPicker]", err);
      setError("Não foi possível carregar a galeria de cortes.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Sincronização em tempo real com a tabela haircut_gallery
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel("haircut-gallery-picker")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: GALLERY_TABLE },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  const filteredItems = useMemo(() => {
    if (category === "todos") return items;
    return items.filter((item) => item.category === category);
  }, [items, category]);

  const selectedId = value?.id || value;

  function handleSelect(item) {
    if (onChange) onChange(item.id);
    if (onSelect) onSelect(item);
  }

  function handleClear() {
    if (onChange) onChange(null);
    if (onSelect) onSelect(null);
    if (onSkip) onSkip();
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Filtro de Categorias */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2 scroll-touch no-scrollbar">
        {CATEGORIES.map((cat) => {
          const active = category === cat.value;
          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => setCategory(cat.value)}
              className={`shrink-0 h-8 rounded-full px-3.5 text-xs font-medium border transition-all touch-manipulation select-none ${
                active
                  ? "bg-red-600 text-white border-red-600 shadow-sm shadow-red-900/40"
                  : "bg-zinc-900 border-zinc-800 text-zinc-300 active:bg-zinc-800"
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Conteúdo: Loading, Erro, Vazio ou Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2.5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-xl bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-zinc-400 text-xs">{error}</p>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs text-white"
          >
            <RefreshCcw size={12} /> Tentar novamente
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <ImageOff className="text-zinc-600" size={24} />
          <p className="text-zinc-500 text-xs">
            {items.length === 0
              ? "Nenhuma foto de corte disponível no momento."
              : "Nenhuma foto encontrada nesta categoria."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 max-h-[55vh] overflow-y-auto pr-1">
          {filteredItems.map((item) => {
            const isSelected = selectedId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className={`relative aspect-[4/5] rounded-xl overflow-hidden border text-left transition-all touch-manipulation select-none active:scale-[0.98] ${
                  isSelected
                    ? "border-red-600 ring-2 ring-red-600/50 shadow-md shadow-red-900/30"
                    : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                }`}
              >
                <img
                  src={item.image_url}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />

                {/* Gradiente e Título */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 pt-6">
                  <p className="text-white text-xs font-semibold truncate">{item.title}</p>
                </div>

                {/* Badge de Selecionado */}
                {isSelected && (
                  <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg">
                    <Check size={14} className="stroke-[3]" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Ação de Pular / Sem foto de referência */}
      {allowSkip && (
        <button
          type="button"
          onClick={handleClear}
          className="mt-1 w-full h-10 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white text-xs font-medium transition-colors"
        >
          {selectedId ? "Remover foto selecionada" : "Continuar sem foto de referência"}
        </button>
      )}
    </div>
  );
}
