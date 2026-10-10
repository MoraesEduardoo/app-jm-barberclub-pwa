"use client";

/**
 * =========================================================================================
 * ARQUIVO: /client-app/HaircutGalleryPicker.jsx
 * APP DO CLIENTE (jm-barberclubV2 / Chatbot de Agendamento)
 * =========================================================================================
 * 
 * DIAGNÓSTICO DO ERRO DE DUPLICAÇÃO DE IMAGENS:
 * Anteriormente, no fluxo do chatbot, ao renderizar os cards de serviços/cortes com fotos da
 * galeria (`haircut_gallery`), ocorria uma colisão de imagem:
 *   - O card "Degradê" e o card "Degradê + Sobrancelha" exibiam a MESMA imagem do card 1.
 * 
 * CAUSA RAIZ:
 * 1. Mapeamento por substring frouxa (.includes()): O nome "Degradê + Sobrancelha" contém
 *    a substring "Degradê". Comparações parciais faziam o Array.prototype.find() retornar
 *    a foto do "Degradê" para ambos os cards.
 * 2. Fallback cego: Se um serviço composto não possuía foto cadastrada, o código fazia
 *    fallback para photos[0] ou para a primeira foto da categoria, multiplicando a imagem.
 * 3. Ausência de prioridade de ID / Chave Estrangeira: Não havia checagem de vínculo por ID.
 * 
 * SOLUÇÃO APLICADA:
 * 1. Vínculo Estrito por ID / Foreign Key (Prioridade 1):
 *    Verifica vínculos diretos como `service.haircut_gallery_id`, `service.gallery_id`,
 *    `service.reference_photo_id` ou `photo.service_id === service.id`.
 * 2. Vínculo por Nome Exato Normalizado (Prioridade 2):
 *    Usa comparação ESTRITA (===) após normalização de acentos, caixa e espaçamentos.
 *    "degrade + sobrancelha" NUNCA é igual a "degrade".
 * 3. Prevenção de Duplicação:
 *    Rastreia fotos já atribuídas para evitar que uma mesma foto seja repetida em cards diferentes.
 * 4. Fallback Individualizado:
 *    Se um corte/serviço não tiver foto correspondente na galeria, renderiza um placeholder
 *    limpo, elegante e individual com ícone temático, sem NUNCA repetir a foto de outro card.
 * =========================================================================================
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ImageOff, Loader2, RefreshCcw, Scissors, Sparkles } from "lucide-react";

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

/**
 * Normaliza strings para comparação fonética/textual estrita:
 * - Remove acentos (diacríticos) via NFD (ex.: "Degradê" -> "degrade")
 * - Converte para minúsculas
 * - Remove caracteres especiais exceto alfanuméricos e '+'
 * - Colapsa espaços em branco múltiplos
 */
export function normalizeName(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove marcas diacríticas/acentos
    .toLowerCase()
    .replace(/[^\w\s+]/g, "") // Mantém caracteres alfa-numéricos, espaços e '+'
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Gera conjunto de chaves canônicas para match exato (ex.: trata variações " + " vs " e " vs " com ").
 * IMPORTANTE: Nunca permite match parcial de substring simples (ex.: "degrade" !== "degrade + sobrancelha").
 */
function createSearchKeys(str) {
  const base = normalizeName(str);
  if (!base) return new Set();

  const keys = new Set([base]);
  // Normaliza conectivos comuns entre termos compostos
  const withPlus = base.replace(/\b(e|com)\b/g, "+").replace(/\s+/g, " ").trim();
  keys.add(withPlus);
  const withAnd = base.replace(/\+/g, " e ").replace(/\s+/g, " ").trim();
  keys.add(withAnd);

  return keys;
}

/**
 * Mapeia cada serviço/corte com seu registro exclusivo na galeria.
 * Garante que NÃO haja fotos duplicadas entre serviços diferentes.
 * Se não houver foto, define has_photo: false para renderizar o fallback individual.
 */
export function mapServicesWithGallery(services = [], photos = []) {
  if (!Array.isArray(services) || services.length === 0) return [];
  if (!Array.isArray(photos) || photos.length === 0) {
    return services.map((s) => ({
      ...s,
      has_photo: false,
      photo_id: null,
      image_url: null,
      photo_title: null,
    }));
  }

  const assignedPhotoIds = new Set();

  return services.map((service) => {
    // 1. Prioridade 1: Match por ID / Chave Estrangeira explícita
    let matched = photos.find((p) => {
      if (assignedPhotoIds.has(p.id)) return false;
      const serviceGalleryId = service.haircut_gallery_id || service.gallery_id || service.reference_photo_id;
      if (serviceGalleryId && String(serviceGalleryId) === String(p.id)) return true;
      if (p.service_id && String(p.service_id) === String(service.id)) return true;
      return false;
    });

    // 2. Prioridade 2: Match Exato de Título / Nome Normalizado
    // (Comparações estritas onde "Degradê + Sobrancelha" NÃO dá match com "Degradê")
    if (!matched) {
      const serviceKeys = createSearchKeys(service.name || service.title || "");
      matched = photos.find((p) => {
        if (assignedPhotoIds.has(p.id)) return false;
        const photoKeys = createSearchKeys(p.title || "");
        for (const sKey of serviceKeys) {
          if (photoKeys.has(sKey)) return true;
        }
        return false;
      });
    }

    if (matched) {
      assignedPhotoIds.add(matched.id);
      return {
        ...service,
        has_photo: true,
        photo_id: matched.id,
        image_url: matched.image_url,
        photo_title: matched.title,
      };
    }

    // 3. Fallback Individualizado: Sem correspondência encontrada na galeria.
    // NUNCA reaproveita fotos de outros cortes para evitar cartões com imagem errada.
    return {
      ...service,
      has_photo: false,
      photo_id: null,
      image_url: null,
      photo_title: null,
    };
  });
}

/**
 * Componente principal do Chatbot / App do Cliente
 * Suporta:
 *  - Modo Serviços (quando `services` são passados via props ou `fetchServices={true}`):
 *    Renderiza os serviços cadastrados na barbearia mapeados com suas fotos exclusivas da galeria.
 *  - Modo Galeria (quando o cliente escolhe fotos de referência livremente no catálogo).
 */
export default function HaircutGalleryPicker({
  supabase,
  services = null,
  fetchServices = false,
  mode = "auto", // 'auto' | 'services' | 'gallery'
  selectedId = null,
  onSelect,
  onSelectService,
  allowSkip = true,
}) {
  const [photos, setPhotos] = useState([]);
  const [internalServices, setInternalServices] = useState(services || []);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [filter, setFilter] = useState("todos");

  // Atualiza serviços se prop externa mudar
  useEffect(() => {
    if (services) setInternalServices(services);
  }, [services]);

  // Carrega fotos da tabela `haircut_gallery` (e opcionalmente serviços de `services`)
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setStatus("loading");
      try {
        if (!supabase) {
          throw new Error("Cliente Supabase não fornecido ao HaircutGalleryPicker.");
        }

        // 1. Busca fotos ativas da galeria
        const { data: galleryData, error: galleryError } = await supabase
          .from(GALLERY_TABLE)
          .select("id, title, category, image_path, is_active, service_id")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(200);

        if (galleryError) throw galleryError;

        const formattedPhotos = (galleryData || []).map((p) => ({
          ...p,
          image_url: supabase.storage.from(GALLERY_BUCKET).getPublicUrl(p.image_path).data.publicUrl,
        }));

        setPhotos(formattedPhotos);

        // 2. Se necessário, busca a lista de serviços ativos
        if (fetchServices && (!services || services.length === 0)) {
          const { data: servicesData, error: servicesError } = await supabase
            .from("services")
            .select("id, name, price, default_duration_minutes, active")
            .eq("active", true)
            .order("name", { ascending: true });

          if (!servicesError && servicesData) {
            setInternalServices(servicesData);
          }
        }

        setStatus("ready");
      } catch (err) {
        console.error("[HaircutGalleryPicker] Erro ao carregar dados:", err);
        if (!silent) setStatus("error");
      }
    },
    [supabase, fetchServices, services],
  );

  // Sincronização Realtime com o Supabase
  useEffect(() => {
    load();
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load(true), 300);
    };

    if (supabase) {
      const channel = supabase
        .channel("haircut-gallery-client")
        .on("postgres_changes", { event: "*", schema: "public", table: GALLERY_TABLE }, refresh)
        .subscribe();

      const onVisible = () => document.visibilityState === "visible" && refresh();
      document.addEventListener("visibilitychange", onVisible);

      return () => {
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisible);
        supabase.removeChannel(channel);
      };
    }
  }, [supabase, load]);

  // Decide se o componente atua no modo de Serviços com Fotos ou Catálogo de Fotos
  const isServicesMode = useMemo(() => {
    if (mode === "services") return true;
    if (mode === "gallery") return false;
    return Boolean(internalServices && internalServices.length > 0);
  }, [mode, internalServices]);

  // Lista mapeada com garantia de vínculo exclusivo (sem duplicação de imagem)
  const mappedServicesList = useMemo(() => {
    if (!isServicesMode) return [];
    return mapServicesWithGallery(internalServices, photos);
  }, [isServicesMode, internalServices, photos]);

  // Fotos exibidas no modo galeria direta
  const shownPhotos = useMemo(
    () => (filter === "todos" ? photos : photos.filter((p) => p.category === filter)),
    [photos, filter],
  );

  // Formatação de moeda BRL para exibição de serviços
  const formatPrice = (val) => {
    if (typeof val !== "number") return null;
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-zinc-500 text-sm">
        <Loader2 size={16} className="animate-spin text-red-500" /> Carregando opções de cortes…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-zinc-400 text-sm">Não foi possível carregar as opções da barbearia.</p>
        <button
          type="button"
          onClick={() => load()}
          className="flex items-center gap-1.5 h-10 rounded-lg border border-zinc-700 px-4 text-sm font-medium text-white active:bg-zinc-900 transition-colors"
        >
          <RefreshCcw size={14} /> Tentar novamente
        </button>
      </div>
    );
  }

  // =========================================================================
  // RENDERIZAÇÃO: MODO SERVIÇOS / CORTES DO CHATBOT COM VÍNCULO EXCLUSIVO
  // =========================================================================
  if (isServicesMode) {
    if (mappedServicesList.length === 0) {
      return (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <ImageOff className="text-zinc-600" size={26} />
          <p className="text-zinc-500 text-sm">Nenhum serviço disponível no momento.</p>
        </div>
      );
    }

    return (
      <div className="w-full">
        <div className="grid grid-cols-2 gap-3">
          {mappedServicesList.map((service) => {
            const active = String(service.id) === String(selectedId);
            const priceLabel = formatPrice(service.price);
            const durationLabel = service.default_duration_minutes
              ? `${service.default_duration_minutes} min`
              : null;

            return (
              <button
                key={service.id}
                type="button"
                onClick={() => {
                  const payload = active ? null : service;
                  onSelectService?.(payload);
                  onSelect?.(payload);
                }}
                aria-pressed={active}
                className={`group relative flex flex-col overflow-hidden rounded-xl border-2 text-left transition-all duration-200 select-none touch-manipulation active:scale-[0.98] ${
                  active
                    ? "border-red-600 bg-zinc-900 shadow-lg shadow-red-950/30"
                    : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                }`}
              >
                {/* CONTAINER DE IMAGEM OU PLACEHOLDER INDIVIDUALIZADO */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-900">
                  {service.has_photo && service.image_url ? (
                    <img
                      src={service.image_url}
                      alt={service.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    /* FALLBACK INDIVIDUALIZADO: NUNCA duplica a foto de outro corte */
                    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950 p-3 text-center border-b border-zinc-800/80">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800/80 border border-zinc-700/50 text-zinc-400 mb-1.5 shadow-inner">
                        <Scissors size={20} className="text-zinc-400 group-hover:text-red-500 transition-colors" />
                      </div>
                      <span className="text-[10px] font-medium tracking-wide uppercase text-zinc-500">
                        Foto em breve
                      </span>
                    </div>
                  )}

                  {/* Gradiente escuro para legibilidade */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

                  {/* Badge de Seleção Ativa */}
                  {active && (
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow-md">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                </div>

                {/* METADADOS DO SERVIÇO / CORTE */}
                <div className="flex flex-col p-2.5">
                  <p className="truncate text-xs font-semibold text-white group-hover:text-red-400 transition-colors">
                    {service.name}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    {priceLabel && (
                      <span className="font-bold text-red-500">{priceLabel}</span>
                    )}
                    {durationLabel && (
                      <span className="text-zinc-400">{durationLabel}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {allowSkip && (
          <button
            type="button"
            onClick={() => {
              onSelectService?.(null);
              onSelect?.(null);
            }}
            className="mt-3 w-full h-11 rounded-lg border border-zinc-800 text-sm font-medium text-zinc-400 active:bg-zinc-900 transition-colors"
          >
            Prefiro escolher na hora
          </button>
        )}
      </div>
    );
  }

  // =========================================================================
  // RENDERIZAÇÃO: MODO CATÁLOGO DIRETO DA GALERIA (FOTOS DE REFERÊNCIA)
  // =========================================================================
  return (
    <div className="w-full">
      <div className="flex gap-2 overflow-x-auto pb-3">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setFilter(c.value)}
            aria-pressed={filter === c.value}
            className={`shrink-0 h-8 rounded-full px-3.5 text-xs font-medium border transition-colors ${
              filter === c.value
                ? "bg-red-600 border-red-600 text-white"
                : "bg-zinc-900 border-zinc-800 text-zinc-300"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {shownPhotos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <ImageOff className="text-zinc-600" size={26} />
          <p className="text-zinc-500 text-sm">Nenhuma foto nesta categoria ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {shownPhotos.map((p) => {
            const active = String(p.id) === String(selectedId);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect?.(active ? null : p)}
                aria-pressed={active}
                className={`relative aspect-[4/5] overflow-hidden rounded-xl border-2 text-left transition-colors select-none ${
                  active ? "border-red-600 shadow-md shadow-red-950/40" : "border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <img
                  src={p.image_url}
                  alt={p.title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2.5 pt-8">
                  <p className="truncate text-xs font-semibold text-white">{p.title}</p>
                </div>
                {active && (
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow-md">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {allowSkip && (
        <button
          type="button"
          onClick={() => onSelect?.(null)}
          className="mt-3 w-full h-11 rounded-lg border border-zinc-800 text-sm font-medium text-zinc-400 active:bg-zinc-900 transition-colors"
        >
          Prefiro não escolher uma referência
        </button>
      )}
    </div>
  );
}
