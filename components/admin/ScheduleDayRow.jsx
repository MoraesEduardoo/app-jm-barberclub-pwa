"use client";

export default function ScheduleDayRow({ day, entry, onChange }) {
  const active = entry?.active ?? false;
  const start = entry?.start_time?.slice(0, 5) ?? "09:00";
  const end = entry?.end_time?.slice(0, 5) ?? "19:00";

  return (
    <div className="flex items-center gap-3 bg-surface border border-zinc-800 rounded-xl px-4 py-3.5">
      <button
        role="switch"
        aria-checked={active}
        onClick={() =>
          onChange({ active: !active, start_time: start, end_time: end })
        }
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
            onChange={(e) =>
              onChange({
                active: true,
                start_time: e.target.value,
                end_time: end,
              })
            }
            className="bg-elevated border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white w-[74px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="text-zinc-600 text-xs">–</span>
          <input
            type="time"
            value={end}
            onChange={(e) =>
              onChange({
                active: true,
                start_time: start,
                end_time: e.target.value,
              })
            }
            className="bg-elevated border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white w-[74px] focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}
    </div>
  );
}
