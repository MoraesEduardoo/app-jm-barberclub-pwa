'use client';

import { Clock, ChevronRight, PauseCircle, GripVertical } from 'lucide-react';

export default function ServiceRow({ service, onClick, dragControls, isDragging = false }) {
  const priceDisplay = Number(service.price || 0).toFixed(2).replace('.', ',');

  return (
    <div
      className={`w-full flex items-center justify-between gap-2.5 bg-surface border rounded-xl px-3 py-3 transition-all select-none ${
        isDragging
          ? 'border-accent shadow-2xl shadow-accent/20 bg-zinc-900 ring-2 ring-accent/40'
          : 'border-zinc-800 hover:border-zinc-700 active:bg-zinc-900/80'
      }`}
    >
      {/* Alça de arrastar flutuante (Drag Handle) */}
      <div
        onPointerDown={(e) => {
          if (dragControls) {
            e.preventDefault();
            dragControls.start(e);
          }
        }}
        className="cursor-grab active:cursor-grabbing p-1.5 -ml-1 text-zinc-500 hover:text-zinc-300 active:text-accent touch-none transition-colors"
        title="Segure e arraste para reordenar"
        aria-label="Arrastar para reordenar"
      >
        <GripVertical size={18} />
      </div>

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
