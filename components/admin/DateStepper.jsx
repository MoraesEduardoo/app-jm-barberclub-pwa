"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { todayInShop, addDaysStr } from "@/lib/dates";

export default function DateStepper({ value, onChange }) {
  const today = todayInShop();

  const currentDateObj = new Date(`${value}T00:00:00`);

  const getMonday = (d) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
  };

  const currentMonday = getMonday(currentDateObj);

  const weekDays = Array.from({ length: 7 }).map((_, index) => {
    const dayDate = new Date(currentMonday);
    dayDate.setDate(currentMonday.getDate() + index);

    const year = dayDate.getFullYear();
    const month = String(dayDate.getMonth() + 1).padStart(2, "0");
    const day = String(dayDate.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${day}`;

    const labelShort = dayDate
      .toLocaleDateString("pt-BR", { weekday: "short" })
      .replace(".", "")
      .toUpperCase();
    const dayNum = dayDate.getDate();

    return { dateStr, labelShort, dayNum };
  });

  const startDateStr = weekDays[0].dateStr;
  const endDateStr = weekDays[6].dateStr;
  const startFormatted = new Date(
    `${startDateStr}T00:00:00`,
  ).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const endFormatted = new Date(`${endDateStr}T00:00:00`).toLocaleDateString(
    "pt-BR",
    { day: "2-digit", month: "short" },
  );

  return (
    <div className="w-full bg-surface border border-zinc-800 rounded-xl p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-white text-xs font-medium flex items-center gap-1.5">
          📅 {startFormatted} a {endFormatted}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => onChange(addDaysStr(value, -7))}
            className="h-7 w-7 flex items-center justify-center rounded-lg bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 transition-colors"
            aria-label="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => onChange(addDaysStr(value, 7))}
            className="h-7 w-7 flex items-center justify-center rounded-lg bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 transition-colors"
            aria-label="Próxima semana"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {weekDays.map((item) => {
          const isSelected = item.dateStr === value;
          const isToday = item.dateStr === today;

          return (
            <button
              key={item.dateStr}
              onClick={() => onChange(item.dateStr)}
              className={`flex flex-col items-center justify-center py-2 rounded-xl transition-all ${
                isSelected
                  ? "bg-red-600 text-white shadow-md shadow-red-900/30" // Destaque em vermelho alinhado à identidade visual
                  : "bg-zinc-900/40 border border-zinc-800/60 text-zinc-400 hover:bg-zinc-800/50"
              }`}
            >
              <span
                className={`text-[9px] font-semibold ${isSelected ? "text-white/90" : "text-zinc-400"}`}
              >
                {item.labelShort}
              </span>
              <span className="text-xs font-bold mt-0.5">{item.dayNum}</span>

              <div
                className={`w-1 h-1 rounded-full mt-1 ${
                  isSelected
                    ? "bg-white"
                    : isToday
                      ? "bg-emerald-500"
                      : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
