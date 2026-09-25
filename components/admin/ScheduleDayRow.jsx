"use client";

import { useState, useEffect } from "react";
import { Coffee } from "lucide-react";

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
    <div className="bg-surface border border-zinc-800 rounded-xl px-4 py-3.5">
      <div className="flex items-center gap-3">
        <button
          role="switch"
          aria-checked={active}
          onClick={() => emit({ active: !active })}
          className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${
            active ? "bg-accent" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              active ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>

        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-medium ${active ? "text-white" : "text-zinc-500"}`}
          >
            {day.label}
          </p>
          {!active && <p className="text-zinc-600 text-xs">Fechado</p>}
        </div>

        {active && (
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              onBlur={() => emit({ start_time: start })}
              className="bg-elevated border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white w-[74px] focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span className="text-zinc-600 text-xs">–</span>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              onBlur={() => emit({ end_time: end })}
              className="bg-elevated border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white w-[74px] focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        )}
      </div>

      {active && (
        <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center gap-3">
          <button
            role="switch"
            aria-checked={hasLunch}
            onClick={() => emit({ has_lunch_break: !hasLunch })}
            className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
              hasLunch ? "bg-accent" : "bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                hasLunch ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>

          <div className="flex-1 flex items-center gap-1.5 text-zinc-400 text-xs">
            <Coffee size={13} className={hasLunch ? "text-accent-light" : ""} />
            Almoço
          </div>

          {hasLunch && (
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="time"
                value={lunchStart}
                onChange={(e) => setLunchStart(e.target.value)}
                onBlur={() => emit({ lunch_start: lunchStart })}
                className="bg-elevated border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white w-[74px] focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-zinc-600 text-xs">–</span>
              <input
                type="time"
                value={lunchEnd}
                onChange={(e) => setLunchEnd(e.target.value)}
                onBlur={() => emit({ lunch_end: lunchEnd })}
                className="bg-elevated border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white w-[74px] focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
