'use client';

import { Clock, ChevronRight, PauseCircle } from 'lucide-react';

export default function ServiceRow({ service, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 bg-surface border border-zinc-800 rounded-xl px-4 py-3.5 active:bg-zinc-900 transition-colors"
    >
      <div className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-white font-medium text-sm truncate">{service.name}</p>
          {!service.active && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-800 rounded-full px-1.5 py-0.5">
              <PauseCircle size={10} /> inativo
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-zinc-500 text-xs mt-1">
          <Clock size={12} />
          <span>{service.default_duration_minutes} min</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-accent-light font-semibold text-sm">
          R$ {Number(service.price).toFixed(2).replace('.', ',')}
        </span>
        <ChevronRight size={16} className="text-zinc-600" />
      </div>
    </button>
  );
}
