"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { todayInShop, addDaysStr } from "@/lib/dates";

// Rótulos fixos: não dependem do Intl/ICU do aparelho, então o texto é idêntico
// no servidor (SSR) e no navegador (sem erro de hidratação).
const WEEKDAYS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MONTHS = [
  "jan.", "fev.", "mar.", "abr.", "mai.", "jun.",
  "jul.", "ago.", "set.", "out.", "nov.", "dez.",
];

/** 0 = domingo … 6 = sábado, calculado em UTC ao meio-dia (imune a fuso). */
function weekdayIndex(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

/** Segunda-feira da semana que contém `dateStr`. */
function mondayOf(dateStr) {
  return addDaysStr(dateStr, -((weekdayIndex(dateStr) + 6) % 7));
}

/** "2026-09-28" -> "28 de set." */
function formatShort(dateStr) {
  const [, month, day] = dateStr.split("-");
  return `${day} de ${MONTHS[Number(month) - 1]}`;
}

const NAV_BTN =
  "h-8 w-8 flex items-center justify-center rounded-lg bg-zinc-800/60 text-zinc-300 transition-all active:scale-95 active:bg-zinc-700 touch-manipulation select-none";

/**
 * Carrossel semanal (segunda a domingo).
 *  - value:    data selecionada "YYYY-MM-DD"
 *  - onChange: recebe a nova data "YYYY-MM-DD" (o pai dispara a busca no Supabase)
 */
export default function DateStepper({ value, onChange }) {
  const today = todayInShop();

  const weekDays = useMemo(() => {
    const monday = mondayOf(value);
    return Array.from({ length: 7 }, (_, i) => {
      const dateStr = addDaysStr(monday, i);
      return {
        dateStr,
        label: WEEKDAYS[weekdayIndex(dateStr)],
        dayNum: Number(dateStr.slice(8, 10)),
      };
    });
  }, [value]);

  const rangeLabel = `${formatShort(weekDays[0].dateStr)} a ${formatShort(weekDays[6].dateStr)}`;

  return (
    <div className="w-full bg-surface border border-zinc-800 rounded-xl p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-white text-sm font-medium">{rangeLabel}</span>

        <div className="flex gap-1.5">
          {/* Mantém o mesmo dia da semana ao trocar de semana */}
          <button
            type="button"
            onClick={() => onChange(addDaysStr(value, -7))}
            className={NAV_BTN}
            aria-label="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => onChange(addDaysStr(value, 7))}
            className={NAV_BTN}
            aria-label="Próxima semana"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {weekDays.map(({ dateStr, label, dayNum }) => {
          const isSelected = dateStr === value;
          const isToday = dateStr === today;

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onChange(dateStr)}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all touch-manipulation select-none active:scale-95 ${
                isSelected
                  ? "bg-red-600 border-red-600 text-white shadow-md shadow-red-900/30"
                  : "bg-zinc-900/45 border-zinc-800/60 text-zinc-400 active:bg-zinc-800"
              }`}
            >
              <span
                className={`text-[10px] font-semibold ${
                  isSelected ? "text-white/90" : "text-zinc-500"
                }`}
              >
                {label}
              </span>
              <span className="text-sm font-bold mt-0.5">{dayNum}</span>

              {/* Ponto marca o dia de hoje (branco se selecionado, verde se não) */}
              <span
                className={`w-1 h-1 rounded-full mt-1 ${
                  isToday ? (isSelected ? "bg-white" : "bg-emerald-500") : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
