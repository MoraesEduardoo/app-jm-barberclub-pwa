"use client";

import { endSession } from "@/lib/session";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock, Zap, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { todayInShop, addDaysStr } from "@/lib/dates";
import { FormField, TextInput, PrimaryButton } from "./FormField";
import { listServices } from "@/lib/actions/services";
import { listSchedule } from "@/lib/actions/schedule";
import {
  createWalkInAppointment,
  getAvailableSlotsForBarber,
  getBarberServiceDuration,
  listAppointmentsByDate,
} from "@/lib/actions/appointments";
import { dayOfWeekFromDate } from "@/lib/constants/schedule";
import {
  generateAvailableSlots,
  roundUpToNextSlot,
  extractBusyRangesFromAppointments,
} from "@/lib/slots";

const SHORT_WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const SHORT_MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function formatDateReadable(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dateObj = new Date(`${dateStr}T12:00:00Z`);
  const dow = SHORT_WEEKDAYS_PT[dateObj.getUTCDay()];
  const month = SHORT_MONTHS_PT[m - 1] || "";
  return `${dow}, ${String(d).padStart(2, "0")} de ${month}`;
}

function formatShortDDMM(dateStr) {
  if (!dateStr) return "";
  const [, m, d] = String(dateStr).slice(0, 10).split("-");
  if (!m || !d) return dateStr;
  return `${d}/${m}`;
}

function parseHHMMToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).slice(0, 5).split(":").map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

function formatMinutesToHHMM(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Gera os horários que cabem especificamente dentro da janela livre clicada na timeline
 * (ex: janela das 09:55 às 10:20 -> prioriza 09:55 e sub-slots de 5 em 5 min que comportem o serviço).
 */
function buildSlotsForClickedWindow(windowCtx, serviceDurationMinutes) {
  if (!windowCtx?.startTime) return [];
  const startTime = String(windowCtx.startTime).slice(0, 5);
  const startMin = parseHHMMToMinutes(startTime);
  if (startMin === null) return [startTime];

  const rawEndMin = windowCtx.endTime ? parseHHMMToMinutes(windowCtx.endTime) : null;
  const gapMin = Number(windowCtx.gapMinutes) || (rawEndMin !== null ? rawEndMin - startMin : 30);
  const endMin = rawEndMin !== null && rawEndMin > startMin ? rawEndMin : startMin + Math.max(15, gapMin);

  const dur = Number(serviceDurationMinutes) > 0 ? Number(serviceDurationMinutes) : Math.min(20, gapMin);
  const slots = [startTime];

  // Gera opções de encaixe a cada 5 minutos dentro do intervalo [startMin, endMin)
  for (let cursor = startMin + 5; cursor < endMin; cursor += 5) {
    if (cursor + dur <= endMin || (slots.length < 3 && cursor + 10 <= endMin)) {
      const candidate = formatMinutesToHHMM(cursor);
      if (!slots.includes(candidate)) {
        slots.push(candidate);
      }
    }
  }

  return slots;
}

export default function WalkInSheet({
  open,
  onClose,
  barber,
  team,
  canPickBarber,
  existingAppointments,
  initialDate = null,
  initialTime = null,
  initialWindow = null,
}) {
  const today = todayInShop();

  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState(barber.id);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  // 'now' = Agora | 'today_slot' = Escolher horário (hoje) | 'future_date' = Marcar dia (qualquer data)
  const [timingMode, setTimingMode] = useState("now");
  const [selectedDate, setSelectedDate] = useState(() => addDaysStr(todayInShop(), 1));
  const [manualTime, setManualTime] = useState("");
  const [focusWindowOnly, setFocusWindowOnly] = useState(false);
  const [rpcSlots, setRpcSlots] = useState(null);
  const [isDayOff, setIsDayOff] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [targetDateAppointments, setTargetDateAppointments] = useState([]);
  const [resolvedConfig, setResolvedConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const existingAppointmentsRef = useRef(existingAppointments);

  useEffect(() => {
    existingAppointmentsRef.current = existingAppointments;
  }, [existingAppointments]);

  // Normaliza o contexto da janela livre clicada na timeline
  const windowContext = useMemo(() => {
    const rawStart = initialWindow?.startTime || initialTime || "";
    if (!rawStart) return null;
    const startTime = String(rawStart).slice(0, 5);
    const endTime = initialWindow?.endTime ? String(initialWindow.endTime).slice(0, 5) : null;
    const gapMinutes = Number(initialWindow?.gapMinutes) || null;
    const targetBarberId = initialWindow?.barberId || barber?.id || null;
    const targetDate = initialWindow?.date
      ? String(initialWindow.date).slice(0, 10)
      : initialDate
      ? String(initialDate).slice(0, 10)
      : todayInShop();

    return {
      startTime,
      endTime,
      gapMinutes,
      barberId: targetBarberId,
      date: targetDate,
    };
  }, [initialWindow, initialTime, initialDate, barber?.id]);

  useEffect(() => {
    if (open) {
      const currentToday = todayInShop();
      const targetBarber = windowContext?.barberId || barber.id;
      setBarberId(targetBarber);
      setServiceId("");
      setClientName("");
      setClientPhone("");

      if (windowContext?.startTime) {
        const cleanDate = windowContext.date || currentToday;
        if (cleanDate !== currentToday) {
          setTimingMode("future_date");
          setSelectedDate(cleanDate);
        } else {
          setTimingMode("today_slot");
          setSelectedDate(addDaysStr(currentToday, 1));
        }
        setManualTime(windowContext.startTime);
        setFocusWindowOnly(true);
      } else {
        setTimingMode("now");
        setSelectedDate(addDaysStr(currentToday, 1));
        setManualTime("");
        setFocusWindowOnly(false);
      }

      listServices()
        .then((data) => {
          const activeList = (data || []).filter(
            (s) => s && s.active !== false && s.is_active !== false
          );
          setServices(activeList);
        })
        .catch(() => {
          setServices([]);
        });

      setRpcSlots(null);
      setResolvedConfig(null);
      setIsDayOff(false);
      setError("");
    }
  }, [open, barber.id, windowContext]);

  const effectiveDate = useMemo(() => {
    if (timingMode === "future_date") return selectedDate || today;
    return today;
  }, [timingMode, selectedDate, today]);

  // Verifica se o modal continua focado na mesma data da janela livre clicada
  const isMatchingWindowDate = useMemo(() => {
    if (!windowContext?.startTime) return false;
    return effectiveDate === windowContext.date && timingMode !== "now";
  }, [windowContext, effectiveDate, timingMode]);

  // Filtra e ordena serviços habilitados para o barbeiro selecionado
  // (priorizando os serviços que cabem na duração da janela livre quando aplicável)
  const availableServicesForBarber = useMemo(() => {
    const filtered = services.filter((s) => {
      const cfg = s.barber_durations?.[barberId];
      if (cfg && cfg.is_active === false) return false;
      if (s.barber_id && String(s.barber_id) !== String(barberId)) return false;
      return true;
    });

    if (!windowContext?.gapMinutes) return filtered;

    return [...filtered].sort((a, b) => {
      const durA =
        a.barber_durations?.[barberId]?.effective_duration ??
        a.duration_minutes ??
        a.default_duration_minutes ??
        30;
      const durB =
        b.barber_durations?.[barberId]?.effective_duration ??
        b.duration_minutes ??
        b.default_duration_minutes ??
        30;
      const fitsA = durA <= windowContext.gapMinutes ? 0 : 1;
      const fitsB = durB <= windowContext.gapMinutes ? 0 : 1;
      if (fitsA !== fitsB) return fitsA - fitsB;
      return durA - durB;
    });
  }, [services, barberId, windowContext?.gapMinutes]);

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) || null,
    [services, serviceId]
  );

  // Calcula duração e preço efetivos para o par (barberId, serviceId)
  const effectiveServiceInfo = useMemo(() => {
    if (!selectedService) return null;
    const localCfg = selectedService.barber_durations?.[barberId];
    const defaultDur =
      selectedService.duration_minutes ?? selectedService.default_duration_minutes ?? 30;
    const defaultPrice = Number(selectedService.price || 0);

    const customDur =
      resolvedConfig &&
      String(resolvedConfig.barberId) === String(barberId) &&
      String(resolvedConfig.serviceId) === String(serviceId)
        ? resolvedConfig.customDuration
        : localCfg?.custom_duration ?? null;

    const durationMinutes =
      resolvedConfig &&
      String(resolvedConfig.barberId) === String(barberId) &&
      String(resolvedConfig.serviceId) === String(serviceId) &&
      resolvedConfig.durationMinutes
        ? resolvedConfig.durationMinutes
        : customDur ?? defaultDur;

    const price =
      resolvedConfig &&
      String(resolvedConfig.barberId) === String(barberId) &&
      String(resolvedConfig.serviceId) === String(serviceId) &&
      resolvedConfig.price !== undefined
        ? resolvedConfig.price
        : localCfg?.effective_price ?? defaultPrice;

    return {
      durationMinutes,
      customDuration: customDur,
      defaultDuration: defaultDur,
      price,
    };
  }, [selectedService, barberId, serviceId, resolvedConfig]);

  // Lista rápida de 14 dias para a mini agenda horizontal no modo "Marcar dia"
  const quickDays = useMemo(() => {
    const base = todayInShop();
    return Array.from({ length: 14 }, (_, idx) => {
      const iso = addDaysStr(base, idx);
      const [, m, d] = iso.split("-").map(Number);
      const dt = new Date(`${iso}T12:00:00Z`);
      const dow = SHORT_WEEKDAYS_PT[dt.getUTCDay()];
      const month = SHORT_MONTHS_PT[(m || 1) - 1];
      let tag = dow;
      if (idx === 0) tag = "Hoje";
      else if (idx === 1) tag = "Amanhã";
      return {
        iso,
        dayNum: String(d).padStart(2, "0"),
        month,
        dow,
        tag,
      };
    });
  }, [open]);

  // No momento exato em que o barbeiro seleciona o serviço e o profissional,
  // consulta barber_services (barber_id + service_id) para buscar custom_duration
  useEffect(() => {
    let cancelled = false;
    if (!barberId || !serviceId) {
      setResolvedConfig(null);
      return;
    }

    getBarberServiceDuration({ barberId, serviceId })
      .then((res) => {
        if (!cancelled && res) {
          setResolvedConfig({
            barberId,
            serviceId,
            ...res,
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [barberId, serviceId]);

  // Carrega o expediente semanal do barbeiro selecionado
  useEffect(() => {
    if (timingMode !== "now" && barberId) {
      listSchedule(barberId)
        .then((rows) => setScheduleRows(rows || []))
        .catch(() => setScheduleRows([]));
    }
  }, [timingMode, barberId]);

  // Consulta dinâmica do motor de disponibilidade do Supabase para o barbeiro, data e serviço escolhidos
  useEffect(() => {
    let cancelled = false;
    if (timingMode !== "now" && barberId && serviceId && effectiveDate) {
      setLoadingSlots(true);
      setIsDayOff(false);

      Promise.all([
        getAvailableSlotsForBarber({
          barberId,
          date: effectiveDate,
          serviceId,
        }),
        effectiveDate === todayInShop()
          ? Promise.resolve({ data: existingAppointmentsRef.current })
          : listAppointmentsByDate(effectiveDate, barberId),
      ])
        .then(([slotRes, apptRes]) => {
          if (cancelled) return;
          if (slotRes?.durationMinutes) {
            setResolvedConfig({
              barberId,
              serviceId,
              durationMinutes: slotRes.durationMinutes,
              customDuration: slotRes.customDuration ?? null,
              defaultDuration: slotRes.defaultDuration ?? 30,
              price: slotRes.price,
            });
          }

          if (slotRes?.isDayOff) {
            setIsDayOff(true);
            setRpcSlots([]);
          } else if (Array.isArray(slotRes?.slots)) {
            setRpcSlots(slotRes.slots);
          } else {
            setRpcSlots(null);
          }

          if (Array.isArray(apptRes?.data)) {
            setTargetDateAppointments(apptRes.data);
          } else {
            setTargetDateAppointments([]);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRpcSlots(null);
            setTargetDateAppointments([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingSlots(false);
        });
    } else {
      setRpcSlots(null);
      setIsDayOff(false);
      setLoadingSlots(false);
    }

    return () => {
      cancelled = true;
    };
  }, [timingMode, barberId, serviceId, effectiveDate]);

  const daySchedule = useMemo(() => {
    if (!scheduleRows || scheduleRows.length === 0 || !effectiveDate) return null;
    const dow = dayOfWeekFromDate(effectiveDate);
    return scheduleRows.find((r) => r.day_of_week === dow) || null;
  }, [scheduleRows, effectiveDate]);

  // Slots específicos da janela livre clicada (ex: 09:55 às 10:20)
  const windowSpecificSlots = useMemo(() => {
    if (!isMatchingWindowDate || !windowContext?.startTime) return [];
    const serviceDur =
      effectiveServiceInfo?.durationMinutes ??
      selectedService?.duration_minutes ??
      selectedService?.default_duration_minutes ??
      null;
    return buildSlotsForClickedWindow(windowContext, serviceDur);
  }, [isMatchingWindowDate, windowContext, effectiveServiceInfo, selectedService]);

  // Mantém o horário de início da janela pré-selecionado quando em modo de encaixe de janela
  useEffect(() => {
    if (isMatchingWindowDate && windowSpecificSlots.length > 0) {
      setManualTime((prev) =>
        prev && windowSpecificSlots.includes(prev) ? prev : windowSpecificSlots[0]
      );
    }
  }, [isMatchingWindowDate, windowSpecificSlots]);

  // Todos os slots disponíveis do dia (motor geral)
  const allDaySlots = useMemo(() => {
    if (timingMode === "now" || !selectedService) return [];
    if (isDayOff) return [];
    let baseSlots = [];
    if (Array.isArray(rpcSlots) && rpcSlots.length > 0) {
      baseSlots = rpcSlots;
    } else if (daySchedule && daySchedule.active) {
      const sourceAppointments =
        effectiveDate === todayInShop() ? existingAppointments : targetDateAppointments;
      const busyRanges = extractBusyRangesFromAppointments(sourceAppointments, barberId);
      const serviceDur =
        effectiveServiceInfo?.durationMinutes ??
        selectedService.duration_minutes ??
        selectedService.default_duration_minutes ??
        30;
      const isTargetToday = effectiveDate === todayInShop();

      baseSlots = generateAvailableSlots(daySchedule, busyRanges, serviceDur, {
        nowTime: isTargetToday && !isMatchingWindowDate ? roundUpToNextSlot() : null,
      });
    }

    if (windowSpecificSlots.length > 0) {
      const merged = [...windowSpecificSlots];
      baseSlots.forEach((s) => {
        if (!merged.includes(s)) merged.push(s);
      });
      return merged;
    }
    return baseSlots;
  }, [
    timingMode,
    selectedService,
    effectiveServiceInfo,
    isDayOff,
    rpcSlots,
    daySchedule,
    effectiveDate,
    existingAppointments,
    targetDateAppointments,
    barberId,
    isMatchingWindowDate,
    windowSpecificSlots,
  ]);

  // Slots exibidos no seletor: filtra prioritariamente para a janela clicada quando focusWindowOnly está ativo
  const availableSlots = useMemo(() => {
    if (isMatchingWindowDate && focusWindowOnly && windowSpecificSlots.length > 0) {
      return windowSpecificSlots;
    }
    return allDaySlots;
  }, [isMatchingWindowDate, focusWindowOnly, windowSpecificSlots, allDaySlots]);

  function handleStepDate(deltaDays) {
    const minDate = todayInShop();
    const next = addDaysStr(selectedDate || minDate, deltaDays);
    if (next < minDate) return;
    setSelectedDate(next);
    setFocusWindowOnly(false);
    setManualTime("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!serviceId) {
      setError("Escolha o serviço realizado.");
      return;
    }
    if (timingMode !== "now" && !manualTime) {
      setError(
        timingMode === "future_date"
          ? "Escolha a data e um horário disponível para agendar."
          : 'Escolha um horário disponível ou marque "Agora".'
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await createWalkInAppointment({
        barber_id: barberId,
        service_id: serviceId,
        client_name: clientName,
        client_phone: clientPhone,
        date: effectiveDate,
        time: timingMode === "now" ? null : manualTime,
        is_walk_in: timingMode === "now",
      });

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (response?.error) {
        setError(response.error);
        return;
      }

      onClose({
        created: true,
        date: effectiveDate,
        time: timingMode === "now" ? null : manualTime,
        mode: timingMode,
      });
    } catch (err) {
      setError(err.message || "Ocorreu um erro de conexão.");
    } finally {
      setSaving(false);
    }
  }

  const selectedBarberName =
    team.find((m) => String(m.id) === String(barberId))?.name || barber?.name || "Profissional";

  return (
    <BottomSheet
      open={open}
      onClose={() => onClose()}
      title={
        isMatchingWindowDate && windowContext?.startTime
          ? `Encaixe às ${windowContext.startTime}`
          : timingMode === "future_date"
          ? "Agendar atendimento"
          : "Novo atendimento"
      }
    >
      <form onSubmit={handleSubmit}>
        {/* Banner de Contexto da Janela Livre Clicada */}
        {isMatchingWindowDate && windowContext?.startTime && (
          <div className="mb-3.5 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Clock size={14} className="text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-emerald-200 truncate">
                  Janela selecionada: {windowContext.startTime}
                  {windowContext.endTime ? ` às ${windowContext.endTime}` : ""}
                  {windowContext.gapMinutes ? ` (${windowContext.gapMinutes} min livres)` : ""}
                </p>
                <p className="text-[11px] text-zinc-400 truncate">
                  Profissional: <strong className="text-zinc-200">{selectedBarberName}</strong>
                </p>
              </div>
            </div>
            <span className="shrink-0 font-mono tabular-nums text-xs font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-1 rounded-lg">
              {manualTime || windowContext.startTime}
            </span>
          </div>
        )}

        {canPickBarber && team.length > 0 && (
          <FormField label="Barbeiro">
            <select
              value={barberId}
              onChange={(e) => setBarberId(e.target.value)}
              className="w-full h-12 rounded-lg bg-elevated border border-zinc-700 px-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-accent touch-manipulation"
            >
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </FormField>
        )}

        <FormField label="Serviço">
          {availableServicesForBarber.length === 0 ? (
            <div className="rounded-xl bg-amber-950/30 border border-amber-500/30 p-3 text-xs text-amber-200 space-y-2">
              <p>Nenhum serviço disponível para este profissional.</p>
              <a
                href="/admin/servicos"
                className="inline-flex items-center gap-1 text-accent-light font-semibold underline"
              >
                Ir para Catálogo de Serviços →
              </a>
            </div>
          ) : (
            <div className="space-y-1.5">
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                required
                className="w-full h-12 rounded-lg bg-elevated border border-zinc-700 px-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-accent touch-manipulation"
              >
                <option value="">Selecione…</option>
                {availableServicesForBarber.map((s) => {
                  const bCfg = s.barber_durations?.[barberId];
                  const dur =
                    bCfg?.effective_duration ??
                    s.duration_minutes ??
                    s.default_duration_minutes ??
                    30;
                  const prc = bCfg?.effective_price ?? Number(s.price || 0);
                  const fitsWindow =
                    isMatchingWindowDate &&
                    windowContext?.gapMinutes &&
                    Number(dur) <= Number(windowContext.gapMinutes);
                  return (
                    <option key={s.id} value={s.id}>
                      {fitsWindow ? "✓ " : ""}
                      {s.name} — R$ {Number(prc).toFixed(2).replace(".", ",")} ({dur} min
                      {fitsWindow ? " • cabe na janela" : ""})
                    </option>
                  );
                })}
              </select>

              {effectiveServiceInfo && (
                <div className="flex items-center justify-between px-1 text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1">
                    <Clock size={12} className="text-accent-light" />
                    <span>
                      Duração com <strong className="text-zinc-200">{selectedBarberName}</strong>:{" "}
                      <strong className="text-accent-light">
                        {effectiveServiceInfo.durationMinutes} min
                      </strong>
                    </span>
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {effectiveServiceInfo.customDuration != null
                      ? "Tempo personalizado"
                      : "Tempo padrão"}
                  </span>
                </div>
              )}
            </div>
          )}
        </FormField>

        <FormField label="Nome do cliente (opcional)">
          <TextInput
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Cliente avulso"
          />
        </FormField>

        <FormField label="Telefone (opcional)">
          <TextInput
            type="tel"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            placeholder="(83) 99999-9999"
          />
        </FormField>

        <div className="mb-4">
          <span className="block text-xs font-medium text-zinc-400 mb-1.5">
            Momento / Horário
          </span>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            <button
              type="button"
              onClick={() => {
                setTimingMode("now");
                setManualTime("");
              }}
              className={`h-11 px-2 rounded-xl text-xs font-semibold border transition-all touch-manipulation select-none active:scale-95 flex items-center justify-center gap-1.5 ${
                timingMode === "now"
                  ? "bg-accent border-accent text-white shadow-sm"
                  : "bg-[#080808] border-zinc-800 text-zinc-400 active:bg-zinc-900"
              }`}
            >
              <Zap size={14} className="shrink-0" />
              <span>Agora</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTimingMode("today_slot");
                if (windowContext?.startTime && windowContext.date === today) {
                  setManualTime((prev) => prev || windowContext.startTime);
                }
              }}
              className={`h-11 px-2 rounded-xl text-xs font-semibold border transition-all touch-manipulation select-none active:scale-95 flex items-center justify-center gap-1.5 ${
                timingMode === "today_slot"
                  ? "bg-accent border-accent text-white shadow-sm"
                  : "bg-[#080808] border-zinc-800 text-zinc-400 active:bg-zinc-900"
              }`}
            >
              <Clock size={14} className="shrink-0" />
              <span className="truncate">Escolher horário</span>
            </button>

            <button
              type="button"
              onClick={() => setTimingMode("future_date")}
              className={`h-11 px-2 rounded-xl text-xs font-semibold border transition-all touch-manipulation select-none active:scale-95 flex items-center justify-center gap-1.5 ${
                timingMode === "future_date"
                  ? "bg-accent border-accent text-white shadow-sm"
                  : "bg-[#080808] border-zinc-800 text-zinc-400 active:bg-zinc-900"
              }`}
            >
              <CalendarDays size={14} className="shrink-0" />
              <span className="truncate">Marcar dia</span>
            </button>
          </div>

          {/* Mini Agenda / Seletor de Data quando "Marcar dia" está ativo */}
          {timingMode === "future_date" && (
            <div className="rounded-2xl bg-[#050505] border border-zinc-800/90 p-3 mb-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <CalendarDays size={15} className="text-accent shrink-0" />
                  <span className="text-xs font-semibold text-white truncate">
                    {formatDateReadable(selectedDate)}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleStepDate(-1)}
                    disabled={selectedDate <= today}
                    aria-label="Dia anterior"
                    className="w-8 h-8 rounded-lg bg-[#0d0d0d] border border-zinc-800 flex items-center justify-center text-zinc-300 disabled:opacity-30 active:scale-95 transition-all"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <input
                    type="date"
                    min={today}
                    value={selectedDate}
                    onChange={(e) => {
                      if (e.target.value) {
                        setSelectedDate(e.target.value);
                        setFocusWindowOnly(false);
                        setManualTime("");
                      }
                    }}
                    className="h-8 rounded-lg bg-[#0d0d0d] border border-zinc-800 px-2 text-xs font-medium text-zinc-200 focus:outline-none focus:border-accent [color-scheme:dark]"
                  />
                  <button
                    type="button"
                    onClick={() => handleStepDate(1)}
                    aria-label="Próximo dia"
                    className="w-8 h-8 rounded-lg bg-[#0d0d0d] border border-zinc-800 flex items-center justify-center text-zinc-300 active:scale-95 transition-all"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              {/* Faixa horizontal de dias rápidos (Mini Agenda) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar select-none">
                {quickDays.map((d) => {
                  const isSelected = d.iso === selectedDate;
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      onClick={() => {
                        setSelectedDate(d.iso);
                        if (d.iso !== windowContext?.date) {
                          setFocusWindowOnly(false);
                          setManualTime("");
                        }
                      }}
                      className={`shrink-0 min-w-[58px] py-2 px-2.5 rounded-xl border text-center transition-all touch-manipulation active:scale-95 ${
                        isSelected
                          ? "bg-accent border-accent text-white shadow-sm"
                          : "bg-[#0b0b0b] border-zinc-800/90 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <span
                        className={`block text-[10px] font-semibold uppercase tracking-wide ${
                          isSelected ? "text-white/90" : "text-zinc-500"
                        }`}
                      >
                        {d.tag}
                      </span>
                      <span className="block text-sm font-bold leading-tight mt-0.5">
                        {d.dayNum}
                      </span>
                      <span
                        className={`block text-[10px] ${
                          isSelected ? "text-white/80" : "text-zinc-500"
                        }`}
                      >
                        {d.month}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Seletor de Horários Disponíveis (para "Escolher horário" hoje ou "Marcar dia") */}
          {timingMode !== "now" && (
            <div className="rounded-2xl bg-[#050505] border border-zinc-800/80 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {isMatchingWindowDate && focusWindowOnly
                    ? `Horários na janela (${windowContext.startTime}${
                        windowContext.endTime ? `–${windowContext.endTime}` : ""
                      })`
                    : `Horários disponíveis (${formatShortDDMM(effectiveDate)})`}
                </span>

                {isMatchingWindowDate && selectedService ? (
                  <button
                    type="button"
                    onClick={() => setFocusWindowOnly((prev) => !prev)}
                    className="text-[11px] font-semibold text-accent-light hover:underline shrink-0"
                  >
                    {focusWindowOnly
                      ? "Ver todos do dia"
                      : `Focar janela (${windowContext.startTime})`}
                  </button>
                ) : (
                  selectedService &&
                  !loadingSlots &&
                  availableSlots.length > 0 && (
                    <span className="text-[11px] font-medium text-zinc-500">
                      {availableSlots.length} {availableSlots.length === 1 ? "vaga" : "vagas"} (
                      {effectiveServiceInfo?.durationMinutes ?? 30} min)
                    </span>
                  )
                )}
              </div>

              {!selectedService && !isMatchingWindowDate ? (
                <p className="text-zinc-500 text-xs py-2">
                  Selecione o serviço acima para consultar os horários livres.
                </p>
              ) : loadingSlots && !focusWindowOnly ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400 py-3">
                  <Loader2 size={14} className="animate-spin text-accent" />
                  <span>Consultando disponibilidade na agenda…</span>
                </div>
              ) : availableSlots.length === 0 ? (
                <p className="text-zinc-500 text-xs py-2">
                  {isDayOff || (daySchedule && !daySchedule.active)
                    ? "O profissional selecionado não possui expediente ativo nesta data."
                    : timingMode === "future_date"
                    ? "Nenhum horário livre disponível para esta data e serviço."
                    : "Nenhum horário livre hoje para este serviço."}
                </p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
                  {availableSlots.map((slot) => {
                    const isWindowSlot = windowSpecificSlots.includes(slot);
                    const isSelected = manualTime === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setManualTime(slot)}
                        className={`py-2 px-2 rounded-lg text-xs font-mono tabular-nums font-semibold border transition-all touch-manipulation select-none active:scale-95 text-center ${
                          isSelected
                            ? "bg-accent border-accent text-white shadow-sm"
                            : isWindowSlot
                            ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-200 hover:border-emerald-400"
                            : "bg-[#0b0b0b] border-zinc-800 text-zinc-300 active:bg-zinc-800"
                        }`}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-accent-light text-xs mb-3">{error}</p>}

        <PrimaryButton type="submit" disabled={saving}>
          {saving
            ? "Salvando…"
            : timingMode === "future_date"
            ? manualTime
              ? `Agendar para ${formatShortDDMM(effectiveDate)} às ${manualTime}`
              : "Agendar atendimento"
            : manualTime && timingMode !== "now"
            ? `Confirmar encaixe às ${manualTime}`
            : "Registrar atendimento"}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
