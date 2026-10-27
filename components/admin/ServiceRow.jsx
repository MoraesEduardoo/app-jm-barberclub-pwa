'use client';

import { useState } from 'react';
import { Clock, ChevronRight, PauseCircle, GripVertical, Scissors, Users, UserCheck } from 'lucide-react';

export default function ServiceRow({ service, onClick, dragControls, isDragging = false }) {
  const [imgError, setImgError] = useState(false);
  const priceDisplay = Number(service.price || 0).toFixed(2).replace('.', ',');
  const duration = service.default_duration_minutes || service.duration_minutes || 30;
  const hasValidImage = Boolean(service.image_url && !imgError);

  return (
    <div
      className={`w-full flex items-center gap-3 sm:gap-4 bg-surface border rounded-2xl p-3 sm:p-3.5 transition-all select-none touch-pan-y ${
        isDragging
          ? 'border-accent shadow-2xl shadow-accent/20 bg-zinc-900 ring-2 ring-accent/40'
          : 'border-zinc-800/90 hover:border-zinc-700 active:bg-zinc-900/80'
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
        className="cursor-grab active:cursor-grabbing p-1.5 -ml-1 text-zinc-500 hover:text-zinc-300 active:text-accent touch-none transition-colors shrink-0 flex items-center justify-center min-h-[44px]"
        style={{ touchAction: 'none' }}
        title="Segure e arraste para reordenar"
        aria-label="Arrastar para reordenar"
      >
        <GripVertical size={18} />
      </div>

      {/* Foto Ilustrativa Oficial do Serviço (w-20 h-20 no mobile, w-24 h-24 em telas maiores) */}
      <button
        type="button"
        onClick={onClick}
        title="Clique para editar serviço e foto"
        className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 active:scale-95 transition-transform shadow-inner group"
      >
        {hasValidImage ? (
          <img
            src={service.image_url}
            alt={service.name}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover object-center rounded-xl group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-600 gap-1 p-2 text-center">
            <Scissors size={20} className="text-zinc-500" />
            <span className="text-[10px] font-medium text-zinc-500 leading-none">+ foto</span>
          </div>
        )}
      </button>

      {/* Conteúdo clicável do serviço organizado de forma fluida ao lado da foto maior */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 flex flex-col justify-between min-w-0 min-h-[80px] sm:min-h-[88px] py-0.5 text-left touch-manipulation focus:outline-none"
      >
        {/* Linha 1: Nome do Serviço + Status Inativo */}
        <div className="flex items-start justify-between gap-2 w-full">
          <p className="text-white font-semibold text-[15px] sm:text-base leading-snug line-clamp-2">
            {service.name}
          </p>
          {!service.active && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-400 bg-zinc-800/90 border border-zinc-700 rounded-md px-1.5 py-0.5 shrink-0">
              <PauseCircle size={10} /> Inativo
            </span>
          )}
        </div>

        {/* Linha 2: Tempo, Categoria e Profissional atribuído */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-zinc-400 text-xs my-1">
          <span className="inline-flex items-center gap-1 text-zinc-300 font-medium">
            <Clock size={12} className="text-accent-light shrink-0" />
            {duration} min
          </span>

          {service.category && (
            <>
              <span className="text-zinc-600" aria-hidden="true">•</span>
              <span className="capitalize text-zinc-400">
                {service.category}
              </span>
            </>
          )}

          <span className="text-zinc-600" aria-hidden="true">•</span>
          <span
            className={`inline-flex items-center gap-1 text-[11px] ${
              !service.is_all_barbers && service.assigned_barber_name
                ? 'text-accent-light font-medium'
                : 'text-zinc-400'
            }`}
          >
            {!service.is_all_barbers && service.assigned_barber_name ? (
              <>
                <UserCheck size={11} className="shrink-0" />
                <span className="truncate max-w-[110px] sm:max-w-none">{service.assigned_barber_name}</span>
              </>
            ) : (
              <>
                <Users size={11} className="shrink-0" />
                <span>Toda equipe</span>
              </>
            )}
          </span>
        </div>

        {/* Linha 3: Preço em destaque + Indicador de edição */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/60 w-full">
          <span className="text-accent-light font-bold text-sm sm:text-[15px] tabular-nums">
            R$ {priceDisplay}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-zinc-500">
            Editar
            <ChevronRight size={15} className="text-zinc-500" />
          </span>
        </div>
      </button>
    </div>
  );
}
