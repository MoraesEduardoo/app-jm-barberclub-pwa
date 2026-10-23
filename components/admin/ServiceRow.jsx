'use client';

import { Clock, ChevronRight, PauseCircle, GripVertical, Scissors } from 'lucide-react';

/**
 * ServiceRow:
 * Card otimizado de exibição de serviços com espaçamento respirável,
 * hierarquia tipográfica clara e badges informativos de fácil leitura mobile.
 */
export default function ServiceRow({ service, onClick, dragControls, isDragging = false }) {
  const priceDisplay = Number(service.price || 0).toFixed(2).replace('.', ',');

  return (
    <div
      className={`w-full flex items-center justify-between gap-3 bg-surface border rounded-2xl p-3.5 sm:p-4 transition-all select-none touch-pan-y shadow-sm ${
        isDragging
          ? 'border-accent shadow-2xl shadow-accent/20 bg-zinc-900 ring-2 ring-accent/40'
          : 'border-zinc-800/90 hover:border-zinc-700/80 active:bg-zinc-900/80'
      }`}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Alça de arrastar para reordenação oficial */}
      <div
        onPointerDown={(e) => {
          if (dragControls) {
            e.preventDefault();
            dragControls.start(e);
          }
        }}
        className="cursor-grab active:cursor-grabbing p-1.5 -ml-1 text-zinc-500 hover:text-zinc-300 active:text-accent touch-none transition-colors shrink-0 flex items-center justify-center rounded-lg"
        style={{ touchAction: 'none' }}
        title="Segure e arraste para reordenar"
        aria-label="Arrastar para reordenar"
      >
        <GripVertical size={18} />
      </div>

      {/* Foto Ilustrativa Oficial do Serviço */}
      <button
        type="button"
        onClick={onClick}
        title="Clique para editar serviço e foto"
        className="relative h-14 w-14 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
      >
        {service.image_url ? (
          <img
            src={service.image_url}
            alt={service.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-600">
            <Scissors size={18} className="text-zinc-500" />
            <span className="text-[9px] mt-0.5 text-zinc-500 font-medium">+foto</span>
          </div>
        )}
      </button>

      {/* Informações detalhadas do serviço */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 flex items-center justify-between gap-3 text-left min-w-0 touch-manipulation focus:outline-none"
      >
        <div className="flex-1 min-w-0 pr-1 space-y-1.5">
          {/* Título do Serviço e Status */}
          <div className="flex items-center gap-2">
            <p className="text-white font-bold text-sm tracking-tight truncate leading-snug">
              {service.name}
            </p>
            {!service.active && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-zinc-500 bg-zinc-800/90 border border-zinc-700/50 rounded-full px-2 py-0.5 shrink-0">
                <PauseCircle size={10} /> Pausado
              </span>
            )}
          </div>

          {/* Badges de Metadados: Duração, Categoria e Atribuição */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {/* Duração em minutos */}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 bg-zinc-900/90 border border-zinc-800 rounded-md px-2 py-0.5 shrink-0">
              <Clock size={11} className="text-zinc-500" />
              <span>{service.default_duration_minutes} min</span>
            </span>

            {/* Categoria do serviço */}
            {service.category && (
              <span className="inline-flex items-center text-[11px] font-medium text-zinc-400 capitalize bg-zinc-900/90 border border-zinc-800 rounded-md px-2 py-0.5 shrink-0">
                {service.category}
              </span>
            )}

            {/* Barbeiro vinculado ou Toda Equipe */}
            <span
              className={`inline-flex items-center gap-1 text-[11px] rounded-md px-2 py-0.5 border font-medium shrink-0 ${
                !service.is_all_barbers && service.assigned_barber_name
                  ? 'text-accent-light bg-accent/15 border-accent/40'
                  : 'text-zinc-400 bg-zinc-900/90 border-zinc-800'
              }`}
            >
              {!service.is_all_barbers && service.assigned_barber_name
                ? `👤 ${service.assigned_barber_name}`
                : '👥 Toda equipe'}
            </span>
          </div>
        </div>

        {/* Preço e Chevron */}
        <div className="flex items-center gap-2 shrink-0 pl-1">
          <div className="text-right">
            <span className="text-accent-light font-bold text-base tracking-tight block">
              R$ {priceDisplay}
            </span>
          </div>
          <ChevronRight size={16} className="text-zinc-600 shrink-0" />
        </div>
      </button>
    </div>
  );
}
