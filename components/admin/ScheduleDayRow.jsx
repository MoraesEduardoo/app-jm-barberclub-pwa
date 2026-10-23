"use client";

import { useState, useEffect } from "react";
import { Coffee } from "lucide-react";

/**
 * ScheduleDayRow:
 * Linha de expediente diário 100% responsiva para mobile e desktop.
 * Evita overflow de seletores de horário e botões nativos em telas menores,
 * agrupando os inputs de início e término em um container compacto e fluido.
 */
export default function ScheduleDayRow({ day, entry, onChange }) {
  const active = entry?.active ?? false;
  const hasLunch = entry?.has_lunch_break ?? false;

  // Estados locais para evitar re-renders pesados e travamentos ao digitar horários
  const [start, setStart] = useState(entry?.start_time?.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(entry?.end_time?.slice(0, 5) ?? "19:00");
  const [lunchStart, setLunchStart] = useState(
    entry?.lunch_start?.slice(0, 5) ?? "12:00",
  );
  const [lunchEnd, setLunchEnd] = useState(
    entry?.lunch_end?.slice(0, 5) ?? "13:00",
  );

  // Sincroniza se os dados externos mudarem
  useEffect(() => {
    setStart(entry?.start_time?.slice(0, 5) ?? "09:00");
    setEnd(entry?.end_time?.slice(0, 5) ?? "19:00");
    setLunchStart(entry?.lunch_start?.slice(0, 5) ?? "12:00");
    setLunchEnd(entry?.lunch_end?.slice(0, 5) ?? "13:00");
  }, [entry]);

  function emit(partial) {
    onChange({
      active,
      start_time: start,
      end_time: end,
      has_lunch_break: hasLunch,
      lunch_start: lunchStart,
      lunch_end: lunchEnd,
      ...partial,
    });
  }

  return (
    <div className="bg-surface border border-zinc-800/90 rounded-2xl p-3.5 sm:p-4 transition-all shadow-sm">
      {/* Linha Principal: Dia + Switch + Horários */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        {/* Switch do dia e nome */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => emit({ active: !active })}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-all touch-manipulation active:scale-95 ${
              active ? "bg-accent" : "bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                active ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>

          <div className="min-w-0">
            <p className={`text-sm font-semibold tracking-tight ${active ? "text-white" : "text-zinc-500"}`}>
              {day.label}
            </p>
            {!active && <p className="text-zinc-500 text-[11px] font-medium">Fechado</p>}
          </div>
        </div>

        {/* Inputs de Horário com visual compacto, responsivo e sem transbordo */}
        {active && (
          <div className="flex items-center gap-1.5 self-end sm:self-auto w-full sm:w-auto justify-end">
            <div className="flex items-center gap-1.5 bg-zinc-900/90 border border-zinc-800 rounded-xl px-2.5 py-1.5 shadow-inner">
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                onBlur={() => emit({ start_time: start })}
                aria-label={`Abertura ${day.label}`}
                className="bg-transparent text-white text-xs sm:text-sm font-bold w-[70px] sm:w-[76px] text-center focus:outline-none focus:ring-1 focus:ring-accent rounded touch-manipulation"
              />
              <span className="text-zinc-500 text-xs font-semibold select-none">–</span>
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                onBlur={() => emit({ end_time: end })}
                aria-label={`Fechamento ${day.label}`}
                className="bg-transparent text-white text-xs sm:text-sm font-bold w-[70px] sm:w-[76px] text-center focus:outline-none focus:ring-1 focus:ring-accent rounded touch-manipulation"
              />
            </div>
          </div>
        )}
      </div>

      {/* Linha de Intervalo de Almoço */}
      {active && (
        <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={hasLunch}
              onClick={() => emit({ has_lunch_break: !hasLunch })}
              className={`relative shrink-0 w-8 h-4.5 rounded-full transition-all touch-manipulation active:scale-95 ${
                hasLunch ? "bg-accent" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                  hasLunch ? "translate-x-3.5" : "translate-x-0"
                }`}
              />
            </button>
            <div className="flex items-center gap-1.5 text-zinc-400 text-xs font-medium">
              <Coffee size={13} className={hasLunch ? "text-accent-light" : "text-zinc-500"} />
              <span>Intervalo de almoço</span>
            </div>
          </div>

          {hasLunch && (
            <div className="flex items-center gap-1.5 bg-zinc-900/90 border border-zinc-800 rounded-xl px-2.5 py-1.5 self-end sm:self-auto shadow-inner">
              <input
                type="time"
                value={lunchStart}
                onChange={(e) => setLunchStart(e.target.value)}
                onBlur={() => emit({ lunch_start: lunchStart })}
                aria-label={`Início do almoço ${day.label}`}
                className="bg-transparent text-white text-xs sm:text-sm font-bold w-[70px] sm:w-[76px] text-center focus:outline-none focus:ring-1 focus:ring-accent rounded touch-manipulation"
              />
              <span className="text-zinc-500 text-xs font-semibold select-none">–</span>
              <input
                type="time"
                value={lunchEnd}
                onChange={(e) => setLunchEnd(e.target.value)}
                onBlur={() => emit({ lunch_end: lunchEnd })}
                aria-label={`Fim do almoço ${day.label}`}
                className="bg-transparent text-white text-xs sm:text-sm font-bold w-[70px] sm:w-[76px] text-center focus:outline-none focus:ring-1 focus:ring-accent rounded touch-manipulation"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
