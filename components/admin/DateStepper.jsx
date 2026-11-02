"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { todayInShop, addDaysStr } from "@/lib/dates";
import { getWeekScheduleStatus } from "@/lib/actions/schedule";

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
 * Carrossel semanal (segunda a domingo) com indicadores dinâmicos de expediente:
 *  - Bolinha verde: dia de expediente útil ativo (`barber_schedules` + sem bloqueio total)
 *  - Bolinha cinza escura/apagada: estabelecimento/profissional fechado ou sem expediente ativo
 */
export default function DateStepper({ value, onChange, barberId = null }) {
  const today = todayInShop();
  const [statusMap, setStatusMap] = useState({});

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

  const fromDate = weekDays[0]?.dateStr;
  const toDate = weekDays[6]?.dateStr;

  useEffect(() => {
    let active = true;
    if (!fromDate || !toDate) return;

    getWeekScheduleStatus({ fromDate, toDate, barberId })
      .then((res) => {
        if (active && res && typeof res === "object") {
          setStatusMap((prev) => ({ ...prev, ...res }));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [fromDate, toDate, barberId]);

  const rangeLabel = `${formatShort(weekDays[0].dateStr)} a ${formatShort(weekDays[6].dateStr)}`;

  return (
    <div className="w-full bg-surface border border-zinc-800 rounded-xl p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between px-1 gap-2">
        <div className="min-w-0">
          <span className="text-white text-sm font-medium block truncate">{rangeLabel}</span>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Aberto
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 inline-block" />
              Fechado
            </span>
          </div>
        </div>

        <div className="flex gap-1.5 shrink-0">
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
          const dayStatus = statusMap[dateStr];
          const isOpen = dayStatus ? Boolean(dayStatus.isOpen) : true;

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onChange(dateStr)}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              title={isOpen ? "Expediente ativo" : "Fechado / Sem expediente"}
              className={`flex flex-col items-center justify-center py-2 rounded-xl border transition-all touch-manipulation select-none active:scale-95 ${
                isSelected
                  ? "bg-red-600 border-red-600 text-white shadow-md shadow-red-900/30"
                  : isOpen
                  ? "bg-zinc-900/45 border-zinc-800/60 text-zinc-300 active:bg-zinc-800"
                  : "bg-zinc-950/60 border-zinc-900 text-zinc-600 active:bg-zinc-900"
              }`}
            >
              <span
                className={`text-[10px] font-semibold ${
                  isSelected
                    ? "text-white/90"
                    : isOpen
                    ? "text-zinc-500"
                    : "text-zinc-600"
                }`}
              >
                {label}
              </span>
              <span
                className={`text-sm font-bold mt-0.5 ${
                  !isSelected && !isOpen ? "text-zinc-500" : ""
                }`}
              >
                {dayNum}
              </span>

              {/* Indicador dinâmico de expediente: bolinha verde (aberto) vs. cinza escura/apagada (fechado) */}
              <span
                className={`w-1.5 h-1.5 rounded-full mt-1.5 transition-all ${
                  isOpen
                    ? isSelected
                      ? "bg-emerald-400 ring-2 ring-black/35 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                      : "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]"
                    : isSelected
                    ? "bg-zinc-900/90 ring-1 ring-white/25"
                    : "bg-zinc-700/70"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
