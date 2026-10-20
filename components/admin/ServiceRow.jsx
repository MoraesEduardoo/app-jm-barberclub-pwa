'use client';

import { Clock, ChevronRight, PauseCircle, GripVertical, Scissors, Image as ImageIcon } from 'lucide-react';

export default function ServiceRow({ service, onClick, dragControls, isDragging = false }) {
  const priceDisplay = Number(service.price || 0).toFixed(2).replace('.', ',');

  return (
    <div
      className={`w-full flex items-center justify-between gap-2.5 bg-surface border rounded-xl px-3 py-2.5 transition-all select-none touch-pan-y ${
        isDragging
          ? 'border-accent shadow-2xl shadow-accent/20 bg-zinc-900 ring-2 ring-accent/40'
          : 'border-zinc-800 hover:border-zinc-700 active:bg-zinc-900/80'
      }`}
      style={{ touchAction: 'pan-y' }}
    >
      {/* Alça de arrastar flutuante (Drag Handle Exclusivo) */}
      <div
        onPointerDown={(e) => {
          if (dragControls) {
            e.preventDefault();
            dragControls.start(e);
          }
        }}
        className="cursor-grab active:cursor-grabbing p-2 -ml-1 text-zinc-500 hover:text-zinc-300 active:text-accent touch-none transition-colors shrink-0"
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
        className="relative h-12 w-12 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
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
            <Scissors size={16} />
            <span className="text-[9px] mt-0.5 text-zinc-500">+foto</span>
          </div>
        )}
      </button>

      {/* Conteúdo clicável do serviço (Abre modal de edição) */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 flex items-center justify-between gap-3 text-left min-w-0 touch-manipulation focus:outline-none"
      >
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2">
            <p className="text-white font-medium text-sm truncate">{service.name}</p>
            {!service.active && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-800 rounded-full px-1.5 py-0.5 shrink-0">
                <PauseCircle size={10} /> inativo
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-zinc-500 text-xs mt-1">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {service.default_duration_minutes} min
            </span>
            {service.category && (
              <span className="text-[11px] text-zinc-500 capitalize bg-zinc-900/90 border border-zinc-800/80 rounded px-1.5 py-0.5">
                {service.category}
              </span>
            )}
            <span
              className={`text-[11px] rounded px-1.5 py-0.5 border flex items-center gap-1 ${
                !service.is_all_barbers && service.assigned_barber_name
                  ? 'text-accent-light bg-accent/15 border-accent/40 font-medium'
                  : 'text-zinc-500 bg-zinc-900/90 border-zinc-800/80'
              }`}
            >
              {!service.is_all_barbers && service.assigned_barber_name
                ? `👤 ${service.assigned_barber_name}`
                : '👥 Toda equipe'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-accent-light font-semibold text-sm">
            R$ {priceDisplay}
          </span>
          <ChevronRight size={16} className="text-zinc-600" />
        </div>
      </button>
    </div>
  );
}
