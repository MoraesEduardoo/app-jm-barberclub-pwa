'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, delta) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

export default function DateStepper({ value, onChange }) {
  const today = toISODate(new Date());
  const label = new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
  });

  return (
    <div className="flex items-center justify-between gap-2 bg-surface border border-zinc-800 rounded-xl px-2 py-2">
      <button
        onClick={() => onChange(addDays(value, -1))}
        className="h-9 w-9 flex items-center justify-center rounded-lg active:bg-zinc-800 text-zinc-400"
        aria-label="Dia anterior"
      >
        <ChevronLeft size={18} />
      </button>

      <div className="flex flex-col items-center">
        <span className="text-white text-sm font-medium capitalize">{label}</span>
        {value === today && <span className="text-accent-light text-[10px] font-medium">Hoje</span>}
      </div>

      <button
        onClick={() => onChange(addDays(value, 1))}
        className="h-9 w-9 flex items-center justify-center rounded-lg active:bg-zinc-800 text-zinc-400"
        aria-label="Próximo dia"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
