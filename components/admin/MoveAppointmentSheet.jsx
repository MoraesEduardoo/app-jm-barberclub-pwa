"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpDown,
  CalendarDays,
  Check,
  Clock,
  Loader2,
  AlertCircle,
  Scissors,
  User,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import { PrimaryButton } from "./FormField";
import {
  getMoveAppointmentDayContext,
  moveAppointmentTime,
} from "@/lib/actions/appointments";
import { getWeekScheduleStatus, listSchedule } from "@/lib/actions/schedule";
import { dayOfWeekFromDate } from "@/lib/constants/schedule";
import { addDaysStr, formatDateBR, todayInShop } from "@/lib/dates";
import {
  getAppointmentStartTime,
  getAppointmentDuration,
  getAppointmentEndTime,
  timeStrToMinutes,
  minutesToTimeStr,
} from "./AppointmentCard";

const QUICK_DELTAS = [-30, -20, -10, 10, 20, 30];
const SHORT_WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function formatDateWithWeekday(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(String(dateStr))) {
    return String(dateStr || "--/--");
  }
  const clean = String(dateStr).slice(0, 10);
  const dt = new Date(`${clean}T12:00:00Z`);
  const dow = SHORT_WEEKDAYS_PT[dt.getUTCDay()] || "";
  return `${dow}, ${formatDateBR(clean, false)}`;
}

function buildBusyIntervalsFromList(list, appointment, targetBarberId) {
  if (!Array.isArray(list) || !appointment) return [];
  return list
    .filter((a) => {
      if (!a || String(a.id) === String(appointment.id)) return false;
      const st = String(a.status || "confirmado").toLowerCase().trim();
      if (st === "cancelado" || st === "cancelled") return false;
      if (targetBarberId) {
        const aBarber = a.barber_id || a.barbers?.id || null;
        if (aBarber && String(aBarber) !== String(targetBarberId)) return false;
      }
      return true;
    })
    .map((a) => {
      const sStr = getAppointmentStartTime(a);
      const sMin = timeStrToMinutes(sStr);
      const dur = getAppointmentDuration(a);
      const eStr = getAppointmentEndTime(a, sStr, dur);
      const eMin = timeStrToMinutes(eStr);
      if (sMin === null || eMin === null) return null;
      return {
        id: a.id,
        clientName: a.client_name || "Cliente",
        startStr: sStr,
        endStr: eStr,
        startMin: sMin,
        endMin: eMin > sMin ? eMin : sMin + dur,
      };
    })
    .filter(Boolean);
}

export default function MoveAppointmentSheet({
  open,
  onClose,
  appointment,
  existingAppointments = [],
  closingTime = "20:30",
  onMoved,
}) {
  const today = todayInShop();
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [scheduleBounds, setScheduleBounds] = useState({
    startTime: "09:00",
    endTime: closingTime || "20:30",
  });
  const [isDayOff, setIsDayOff] = useState(false);
  const [closedReason, setClosedReason] = useState("");
  const [dayBusyIntervals, setDayBusyIntervals] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [quickWeekStatus, setQuickWeekStatus] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const currentAppointmentDate = useMemo(
    () =>
      appointment?.appointment_date
        ? String(appointment.appointment_date).slice(0, 10)
        : today,
    [appointment, today]
  );

  const currentStartTime = useMemo(
    () => (appointment ? getAppointmentStartTime(appointment) : ""),
    [appointment]
  );
  const durationMin = useMemo(
    () => (appointment ? getAppointmentDuration(appointment) : 30),
    [appointment]
  );
  const currentEndTime = useMemo(
    () =>
      appointment
        ? getAppointmentEndTime(appointment, currentStartTime, durationMin)
        : "",
    [appointment, currentStartTime, durationMin]
  );

  const barberId = appointment?.barber_id || appointment?.barbers?.id || null;

  // Dias rápidos a partir da data atual (hoje + próximos 13 dias)
  const quickDays = useMemo(() => {
    const base = todayInShop();
    const list = [];
    for (let offset = 0; offset < 14; offset++) {
      const iso = addDaysStr(base, offset);
      const dt = new Date(`${iso}T12:00:00Z`);
      const dowIdx = dt.getUTCDay();
      const weekdayShort = SHORT_WEEKDAYS_PT[dowIdx] || "";
      list.push({
        iso,
        label: offset === 0 ? "Hoje" : offset === 1 ? "Amanhã" : weekdayShort,
        dayNum: iso.slice(8, 10),
        monthNum: iso.slice(5, 7),
        weekdayShort,
        isOriginal: iso === currentAppointmentDate,
      });
    }
    return list;
  }, [currentAppointmentDate]);

  // Inicializa data e horário ao abrir o modal e carrega status da quinzena para os atalhos de dia
  useEffect(() => {
    if (!open || !appointment) {
      setError("");
      setSaving(false);
      return;
    }

    setError("");
    setSelectedDate(currentAppointmentDate);
    setSelectedTime(currentStartTime || "09:00");
    setIsDayOff(false);
    setClosedReason("");

    const fromDate = todayInShop();
    const toDate = addDaysStr(fromDate, 13);
    getWeekScheduleStatus({ fromDate, toDate, barberId })
      .then((res) => {
        if (res && typeof res === "object") {
          setQuickWeekStatus(res);
        }
      })
      .catch(() => {});
  }, [open, appointment, currentAppointmentDate, currentStartTime, barberId]);

  // Carrega dinamicamente o expediente real, bloqueios e agendamentos ocupados para a data selecionada
  useEffect(() => {
    if (!open || !appointment || !selectedDate) return;
    let cancelled = false;

    const dow = dayOfWeekFromDate(selectedDate);
    const defaultClose = dow === "domingo" ? "12:30" : closingTime || "20:30";
    const isSameOriginalDay = selectedDate === currentAppointmentDate;

    // Feedback instantâneo para o mesmo dia usando a lista já carregada
    if (isSameOriginalDay) {
      setDayBusyIntervals(
        buildBusyIntervalsFromList(existingAppointments, appointment, barberId)
      );
      setScheduleBounds({
        startTime: "09:00",
        endTime: defaultClose,
      });
      setIsDayOff(false);
      setClosedReason("");
    } else {
      setLoadingDay(true);
      setDayBusyIntervals([]);
    }

    const fetchDayData = async () => {
      try {
        const res = barberId
          ? await getMoveAppointmentDayContext({
              appointmentId: appointment.id,
              barberId,
              targetDate: selectedDate,
            })
          : null;

        if (cancelled) return;

        if (res?.ok) {
          const nextBounds = {
            startTime: res.startTime || "09:00",
            endTime: res.endTime || defaultClose,
          };
          setScheduleBounds(nextBounds);
          setIsDayOff(Boolean(res.isDayOff));
          setClosedReason(res.closedReason || "");
          setDayBusyIntervals(Array.isArray(res.busyIntervals) ? res.busyIntervals : []);
          return;
        }

        // Fallback se getMoveAppointmentDayContext não responder
        if (barberId) {
          const rows = await listSchedule(barberId);
          if (cancelled) return;
          const dayRow = (rows || []).find((r) => r.day_of_week === dow);
          if (dayRow) {
            setScheduleBounds({
              startTime: dayRow.start_time
                ? String(dayRow.start_time).slice(0, 5)
                : "09:00",
              endTime: dayRow.end_time
                ? String(dayRow.end_time).slice(0, 5)
                : defaultClose,
            });
            setIsDayOff(dayRow.active === false);
            setClosedReason(
              dayRow.active === false
                ? "A barbearia / profissional não funciona neste dia."
                : ""
            );
          }
        }
      } catch {
        // Mantém fallback atual sem travar o modal
      } finally {
        if (!cancelled) {
          setLoadingDay(false);
        }
      }
    };

    fetchDayData();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    appointment,
    selectedDate,
    currentAppointmentDate,
    barberId,
    closingTime,
    existingAppointments,
  ]);

  // Valida qualquer horário candidato (HH:MM) contra dia fechado, expediente e colisões na data selecionada
  const validateCandidateTime = useMemo(() => {
    const openMin = timeStrToMinutes(scheduleBounds.startTime) ?? 9 * 60;
    const closeMin = timeStrToMinutes(scheduleBounds.endTime) ?? 20 * 60 + 30;

    return (candidateTimeStr) => {
      const startMin = timeStrToMinutes(candidateTimeStr);
      if (startMin === null) {
        return {
          valid: false,
          endTime: "",
          reason: "Selecione um horário válido.",
        };
      }

      const endMin = startMin + durationMin;
      const endTime = minutesToTimeStr(endMin);

      if (isDayOff) {
        return {
          valid: false,
          endTime,
          reason:
            closedReason ||
            "A barbearia / profissional não funciona nesta data.",
        };
      }

      if (startMin < openMin) {
        return {
          valid: false,
          endTime,
          reason: `Antes da abertura do expediente (${scheduleBounds.startTime}).`,
        };
      }

      if (endMin > closeMin) {
        return {
          valid: false,
          endTime,
          reason: `O término (${endTime}) ultrapassa o fim do expediente (${scheduleBounds.endTime}).`,
        };
      }

      const conflict = dayBusyIntervals.find(
        (other) => startMin < other.endMin && endMin > other.startMin
      );
      if (conflict) {
        return {
          valid: false,
          endTime,
          conflictClient: conflict.clientName,
          reason: `Conflito com ${conflict.clientName} (${conflict.startStr} – ${conflict.endStr}).`,
        };
      }

      return {
        valid: true,
        endTime,
        reason: null,
      };
    };
  }, [scheduleBounds, durationMin, dayBusyIntervals, isDayOff, closedReason]);

  const isDateChanged = Boolean(
    selectedDate && currentAppointmentDate && selectedDate !== currentAppointmentDate
  );

  // Lista fluida de todos os horários disponíveis de 10 em 10 min na data selecionada
  const availableDaySlots = useMemo(() => {
    if (isDayOff) return [];
    const openMin = timeStrToMinutes(scheduleBounds.startTime) ?? 9 * 60;
    const closeMin = timeStrToMinutes(scheduleBounds.endTime) ?? 20 * 60 + 30;
    const slots = [];

    for (let cursor = openMin; cursor + durationMin <= closeMin; cursor += 10) {
      const timeStr = minutesToTimeStr(cursor);
      const check = validateCandidateTime(timeStr);
      if (check.valid) {
        slots.push({
          time: timeStr,
          endTime: check.endTime,
          isCurrent: !isDateChanged && timeStr === currentStartTime,
        });
      }
    }

    return slots;
  }, [
    isDayOff,
    scheduleBounds,
    durationMin,
    validateCandidateTime,
    isDateChanged,
    currentStartTime,
  ]);

  // Ao trocar para outro dia, se o horário anterior não for válido naquele dia, seleciona o 1º horário livre
  useEffect(() => {
    if (!open || loadingDay || isDayOff) return;
    if (!isDateChanged) return;
    if (availableDaySlots.length === 0) return;

    const currentCheck = validateCandidateTime(selectedTime);
    if (!currentCheck.valid) {
      setSelectedTime(availableDaySlots[0].time);
    }
  }, [
    open,
    loadingDay,
    isDayOff,
    isDateChanged,
    availableDaySlots,
    selectedTime,
    validateCandidateTime,
  ]);

  // Atalhos rápidos de deslocamento (-30m, -20m, -10m, +10m, +20m, +30m)
  const quickShiftOptions = useMemo(() => {
    if (isDayOff) return [];
    const baseMin = timeStrToMinutes(currentStartTime);
    if (baseMin === null) return [];

    return QUICK_DELTAS.map((delta) => {
      const targetMin = baseMin + delta;
      if (targetMin < 0 || targetMin >= 24 * 60) return null;
      const timeStr = minutesToTimeStr(targetMin);
      const check = validateCandidateTime(timeStr);
      return {
        delta,
        label: delta > 0 ? `+${delta} min` : `${delta} min`,
        time: timeStr,
        endTime: check.endTime,
        valid: check.valid,
        reason: check.reason,
      };
    }).filter(Boolean);
  }, [isDayOff, currentStartTime, validateCandidateTime]);

  if (!appointment) return null;

  const serviceName =
    appointment.service || appointment.services?.name || "Serviço";
  const barberName = appointment.barbers?.name || "";
  const selectedValidation = validateCandidateTime(selectedTime);
  const isUnchanged = !isDateChanged && selectedTime === currentStartTime;

  async function handleConfirmMove(e) {
    if (e) e.preventDefault();
    if (!selectedTime || !selectedDate || isUnchanged) return;

    if (!selectedValidation.valid) {
      setError(selectedValidation.reason || "Data ou horário indisponível.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await moveAppointmentTime({
        appointmentId: appointment.id,
        newStartTime: selectedTime,
        newDate: selectedDate,
      });

      if (res?.error) {
        setError(res.error);
        setSaving(false);
        return;
      }

      if (onMoved) {
        onMoved(res);
      }
      onClose();
    } catch {
      setError("Não foi possível reposicionar o atendimento. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Mover / Reorganizar Atendimento"
    >
      <form onSubmit={handleConfirmMove} className="space-y-4">
        {/* Cartão de Identificação do Atendimento + Comparativo Data/Horário */}
        <div className="rounded-2xl bg-zinc-950 border border-zinc-800/90 p-3.5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <User size={13} className="text-blue-400 shrink-0" />
                <h3 className="text-sm font-bold text-white truncate">
                  {appointment.client_name || "Cliente"}
                </h3>
              </div>
              <p className="text-xs text-zinc-300 font-medium truncate mt-0.5 flex items-center gap-1">
                <Scissors size={11} className="text-accent-light shrink-0" />
                <span className="truncate">{serviceName}</span>
                {barberName ? (
                  <span className="text-zinc-500 font-normal"> · {barberName}</span>
                ) : null}
              </p>
            </div>

            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 font-mono tabular-nums text-[11px] font-semibold text-zinc-300">
              <Clock size={11} className="text-accent-light" />
              {durationMin} min
            </span>
          </div>

          {/* Comparativo Visual: Data & Horário Atual -> Nova Data & Novo Horário */}
          <div className="pt-2.5 border-t border-zinc-800/80 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-black border border-zinc-800/90 px-3 py-2">
              <span className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                Horário Atual
              </span>
              <span className="mt-0.5 block text-[11px] font-medium text-zinc-400">
                {formatDateWithWeekday(currentAppointmentDate)}
              </span>
              <span className="mt-0.5 block font-mono tabular-nums text-xs sm:text-sm font-bold text-zinc-300">
                {currentStartTime || "--:--"} – {currentEndTime || "--:--"}
              </span>
            </div>

            <div
              className={`rounded-xl border px-3 py-2 transition-colors ${
                !selectedValidation.valid
                  ? "bg-rose-950/25 border-rose-500/40"
                  : isUnchanged
                  ? "bg-black border-zinc-800/90"
                  : "bg-emerald-950/25 border-emerald-500/45"
              }`}
            >
              <span className="block text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                Novo Horário
              </span>
              <span
                className={`mt-0.5 block text-[11px] font-semibold ${
                  !selectedValidation.valid
                    ? "text-rose-300"
                    : isDateChanged
                    ? "text-emerald-300"
                    : "text-zinc-400"
                }`}
              >
                {formatDateWithWeekday(selectedDate)}
              </span>
              <span
                className={`mt-0.5 flex items-center gap-1 font-mono tabular-nums text-xs sm:text-sm font-bold ${
                  !selectedValidation.valid
                    ? "text-rose-300"
                    : isUnchanged
                    ? "text-white"
                    : "text-emerald-400"
                }`}
              >
                <span>{selectedTime || "--:--"}</span>
                <ArrowRight size={12} className="opacity-70 shrink-0" />
                <span>{selectedValidation.endTime || "--:--"}</span>
              </span>
            </div>
          </div>

          {/* Seletor de Nova Data (Dia) integrado ao bloco principal */}
          <div className="pt-2.5 border-t border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="move-target-date"
                className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5"
              >
                <CalendarDays size={12} className="text-accent-light" />
                <span>Alterar Dia</span>
              </label>

              <input
                id="move-target-date"
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) {
                    setError("");
                    setSelectedDate(e.target.value.slice(0, 10));
                  }
                }}
                className="h-8 rounded-lg bg-black border border-zinc-800 px-2.5 text-xs font-mono tabular-nums font-semibold text-white focus:outline-none focus:border-accent [color-scheme:dark]"
              />
            </div>

            {/* Faixa rápida de dias próximos com indicador de aberto/fechado */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar select-none">
              {quickDays.map((d) => {
                const isSelected = d.iso === selectedDate;
                const dayStat = quickWeekStatus[d.iso];
                const isOpen = dayStat ? Boolean(dayStat.isOpen) : true;

                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => {
                      setError("");
                      setSelectedDate(d.iso);
                    }}
                    title={
                      isOpen
                        ? `${d.weekdayShort}, ${d.dayNum}/${d.monthNum} — Expediente aberto`
                        : `${d.weekdayShort}, ${d.dayNum}/${d.monthNum} — Fechado / Sem expediente`
                    }
                    className={`shrink-0 min-w-[54px] py-1.5 px-2 rounded-xl border text-center transition-all touch-manipulation active:scale-95 flex flex-col items-center ${
                      isSelected
                        ? "bg-accent border-accent text-white shadow-sm ring-1 ring-accent-light"
                        : isOpen
                        ? "bg-black border-zinc-800/90 text-zinc-300 hover:border-zinc-700"
                        : "bg-zinc-950/50 border-zinc-900 text-zinc-600 opacity-75"
                    }`}
                  >
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wide ${
                        isSelected
                          ? "text-white/95"
                          : isOpen
                          ? "text-zinc-400"
                          : "text-zinc-600"
                      }`}
                    >
                      {d.label}
                    </span>
                    <span className="font-mono tabular-nums text-xs font-bold mt-0.5">
                      {d.dayNum}/{d.monthNum}
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full mt-1 ${
                        isOpen
                          ? isSelected
                            ? "bg-emerald-300"
                            : "bg-emerald-500"
                          : isSelected
                          ? "bg-zinc-900/90"
                          : "bg-zinc-700"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Atalhos Rápidos de Deslocamento (+/- 10, 20, 30 min) */}
        {quickShiftOptions.length > 0 && !loadingDay && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Ajuste rápido
              </span>
              <span className="text-[10px] text-zinc-500">
                Recalcula o término automaticamente
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {quickShiftOptions.map((opt) => {
                const isSelected = selectedTime === opt.time;
                return (
                  <button
                    key={opt.delta}
                    type="button"
                    disabled={!opt.valid}
                    title={opt.valid ? `Mover para ${opt.time} – ${opt.endTime}` : opt.reason}
                    onClick={() => {
                      setError("");
                      setSelectedTime(opt.time);
                    }}
                    className={`py-2 px-2 rounded-xl border text-center transition-all touch-manipulation select-none ${
                      isSelected
                        ? "bg-accent border-accent text-white shadow-sm ring-1 ring-accent-light"
                        : opt.valid
                        ? "bg-zinc-950 border-zinc-800 text-zinc-200 hover:border-zinc-700 active:scale-95"
                        : "bg-zinc-950/40 border-zinc-900 text-zinc-600 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <span className="block text-[10px] font-bold">{opt.label}</span>
                    <span className="block font-mono tabular-nums text-[11px] text-zinc-400 mt-0.5">
                      {opt.time}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Seletor Fluido de Horários Livres da Data Selecionada */}
        <div className="rounded-2xl bg-zinc-950 border border-zinc-800/90 p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5 min-w-0 truncate">
              <Clock size={12} className="text-accent-light shrink-0" />
              <span className="truncate">
                {isDayOff
                  ? `Fechado em ${formatDateBR(selectedDate, false)}`
                  : `Horários Livres (${scheduleBounds.startTime} às ${scheduleBounds.endTime})`}
              </span>
            </span>
            {!loadingDay && !isDayOff && (
              <span className="text-[11px] font-medium text-emerald-400 font-mono tabular-nums shrink-0">
                {availableDaySlots.length} opções
              </span>
            )}
          </div>

          {loadingDay ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-3.5 flex items-center gap-2 text-xs text-zinc-200">
              <Loader2 size={14} className="animate-spin text-accent-light shrink-0" />
              <span>Consultando agenda de {formatDateBR(selectedDate, false)}…</span>
            </div>
          ) : isDayOff ? (
            <div className="rounded-xl border border-rose-500/35 bg-rose-950/25 px-3 py-3 flex items-start gap-2.5 text-xs text-rose-200">
              <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Dia fechado / Sem atendimento</p>
                <p className="text-[11px] text-rose-200/80 mt-0.5">
                  {closedReason ||
                    "A barbearia ou o profissional não funciona nesta data. Selecione outro dia acima."}
                </p>
              </div>
            </div>
          ) : availableDaySlots.length === 0 ? (
            <div className="rounded-xl border border-amber-500/35 bg-zinc-900/90 px-3 py-3 flex items-start gap-2.5 text-xs text-zinc-200">
              <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Nenhum horário livre comporta {durationMin} min</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Todos os períodos do expediente de {formatDateBR(selectedDate, false)} estão ocupados.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-56 overflow-y-auto pr-0.5">
              {availableDaySlots.map((slot) => {
                const isSelected = selectedTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => {
                      setError("");
                      setSelectedTime(slot.time);
                    }}
                    className={`py-2 px-2 rounded-xl border text-left transition-all touch-manipulation select-none active:scale-95 flex flex-col justify-between ${
                      isSelected
                        ? "bg-accent/20 border-accent text-white shadow-sm ring-1 ring-accent"
                        : slot.isCurrent
                        ? "bg-zinc-900 border-zinc-700 text-zinc-200"
                        : "bg-black border-zinc-800/90 text-zinc-200 hover:border-emerald-500/50 hover:bg-emerald-950/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 w-full">
                      <span className="font-mono tabular-nums text-xs font-bold text-white">
                        {slot.time}
                      </span>
                      {isSelected ? (
                        <Check size={12} className="text-accent-light shrink-0" />
                      ) : slot.isCurrent ? (
                        <span className="text-[9px] font-bold uppercase px-1 py-0.2 rounded bg-zinc-800 text-zinc-400">
                          Atual
                        </span>
                      ) : null}
                    </div>
                    <span className="font-mono tabular-nums text-[10px] text-zinc-400 mt-0.5">
                      até {slot.endTime}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Campo de Horário Exato Personalizado */}
          {!isDayOff && (
            <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-3">
              <label
                htmlFor="custom-move-time"
                className="text-[11px] font-medium text-zinc-400"
              >
                Ou defina um horário exato:
              </label>
              <input
                id="custom-move-time"
                type="time"
                step="600"
                value={selectedTime}
                onChange={(e) => {
                  setError("");
                  if (e.target.value) {
                    setSelectedTime(e.target.value.slice(0, 5));
                  }
                }}
                className="h-9 rounded-xl bg-black border border-zinc-800 px-3 text-xs font-mono tabular-nums font-bold text-white focus:outline-none focus:border-accent [color-scheme:dark]"
              />
            </div>
          )}
        </div>

        {/* Alerta de Validação Instantânea (Dia fechado, Fim do Expediente ou Conflito) */}
        {!loadingDay && !selectedValidation.valid && selectedValidation.reason && !isDayOff && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2.5 flex items-start gap-2 text-xs text-rose-200">
            <AlertCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />
            <span>{selectedValidation.reason}</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2.5 flex items-start gap-2 text-xs text-rose-200">
            <AlertCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <PrimaryButton
          type="submit"
          disabled={saving || loadingDay || isUnchanged || !selectedValidation.valid}
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={15} className="animate-spin" />
              <span>Movendo atendimento…</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <ArrowUpDown size={15} />
              <span>
                {isUnchanged
                  ? "Selecione uma nova data ou horário"
                  : isDateChanged
                  ? `Confirmar dia ${formatDateBR(selectedDate, false)} às ${selectedTime} (até ${selectedValidation.endTime})`
                  : `Confirmar às ${selectedTime} (até ${selectedValidation.endTime})`}
              </span>
            </span>
          )}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
