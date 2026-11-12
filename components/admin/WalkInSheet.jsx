"use client";

import { endSession } from "@/lib/session";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Clock,
  Zap,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Phone,
  User,
  History,
} from "lucide-react";
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
import { invalidateCache } from "@/lib/admin-cache";
import { dayOfWeekFromDate } from "@/lib/constants/schedule";
import {
  generateFullDaySlotsWithStatus,
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
 * (ex: janela das 09:55 às 10:20 -> prioriza 09:55 e sub-slots de 10 em 10 min que comportem o serviço).
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

  // Gera opções de encaixe a cada 10 minutos dentro do intervalo [startMin, endMin)
  for (let cursor = startMin + 10; cursor < endMin; cursor += 10) {
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
  // 'today_slot' = Escolher horário (hoje) | 'future_date' = Marcar dia (qualquer data passada/futura) | 'now' = Agora
  const [timingMode, setTimingMode] = useState("today_slot");
  const [selectedDate, setSelectedDate] = useState(() => todayInShop());
  const [manualTime, setManualTime] = useState("");
  const [focusWindowOnly, setFocusWindowOnly] = useState(false);
  const [rpcSlots, setRpcSlots] = useState(null);
  const [rpcSlotDetails, setRpcSlotDetails] = useState(null);
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
      const baseDate = initialDate ? String(initialDate).slice(0, 10) : currentToday;

      setBarberId(targetBarber);
      setServiceId("");
      setClientName("");
      setClientPhone("");

      if (windowContext?.startTime) {
        const cleanDate = windowContext.date || baseDate;
        if (cleanDate !== currentToday) {
          setTimingMode("future_date");
          setSelectedDate(cleanDate);
        } else {
          setTimingMode("today_slot");
          setSelectedDate(currentToday);
        }
        setManualTime(windowContext.startTime);
        setFocusWindowOnly(false);
      } else if (baseDate !== currentToday) {
        // Se a agenda já estava posicionada num dia anterior ou futuro, abre direto nessa data com a grelha visível
        setTimingMode("future_date");
        setSelectedDate(baseDate);
        setManualTime("");
        setFocusWindowOnly(false);
      } else {
        // Abre por padrão exibindo a grelha completa de slots do expediente (09:00 até o fecho)
        setTimingMode("today_slot");
        setSelectedDate(currentToday);
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
      setRpcSlotDetails(null);
      setResolvedConfig(null);
      setIsDayOff(false);
      setError("");
    }
  }, [open, barber.id, windowContext, initialDate]);

  const effectiveDate = useMemo(() => {
    if (timingMode === "future_date") return selectedDate || today;
    return today;
  }, [timingMode, selectedDate, today]);

  const isRetroactiveDate = useMemo(
    () => Boolean(effectiveDate && effectiveDate < today),
    [effectiveDate, today]
  );

  // Verifica se o modal continua focado na mesma data da janela livre clicada
  const isMatchingWindowDate = useMemo(() => {
    if (!windowContext?.startTime) return false;
    return effectiveDate === windowContext.date && timingMode !== "now";
  }, [windowContext, effectiveDate, timingMode]);

  // Filtra e ordena serviços habilitados para o barbeiro selecionado
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

  // Lista rápida de dias para a mini agenda horizontal (inclui dias anteriores: Anteontem, Ontem, Hoje, Amanhã e próximos dias)
  const quickDays = useMemo(() => {
    const base = todayInShop();
    const offsets = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return offsets.map((offset) => {
      const iso = addDaysStr(base, offset);
      const [, m, d] = iso.split("-").map(Number);
      const dt = new Date(`${iso}T12:00:00Z`);
      const dow = SHORT_WEEKDAYS_PT[dt.getUTCDay()];
      const month = SHORT_MONTHS_PT[(m || 1) - 1];
      let tag = dow;
      if (offset === -2) tag = "Anteontem";
      else if (offset === -1) tag = "Ontem";
      else if (offset === 0) tag = "Hoje";
      else if (offset === 1) tag = "Amanhã";
      return {
        iso,
        offset,
        isPastDate: offset < 0,
        dayNum: String(d).padStart(2, "0"),
        month,
        dow,
        tag,
      };
    });
  }, [today]);

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
    if (barberId) {
      listSchedule(barberId)
        .then((rows) => setScheduleRows(rows || []))
        .catch(() => setScheduleRows([]));
    }
  }, [barberId]);

  // Consulta dinâmica do motor de disponibilidade do Supabase para o barbeiro, data e serviço escolhidos
  useEffect(() => {
    let cancelled = false;
    if (timingMode !== "now" && barberId && effectiveDate) {
      setLoadingSlots(true);
      setIsDayOff(false);

      Promise.all([
        getAvailableSlotsForBarber({
          barberId,
          date: effectiveDate,
          serviceId: serviceId || null,
        }),
        effectiveDate === todayInShop()
          ? Promise.resolve({ data: existingAppointmentsRef.current })
          : listAppointmentsByDate(effectiveDate, barberId),
      ])
        .then(([slotRes, apptRes]) => {
          if (cancelled) return;
          if (serviceId && slotRes?.durationMinutes) {
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
            setRpcSlotDetails([]);
          } else {
            if (Array.isArray(slotRes?.slots)) {
              setRpcSlots(slotRes.slots);
            } else {
              setRpcSlots(null);
            }
            if (Array.isArray(slotRes?.slotDetails)) {
              setRpcSlotDetails(slotRes.slotDetails);
            } else {
              setRpcSlotDetails(null);
            }
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
            setRpcSlotDetails(null);
            setTargetDateAppointments([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingSlots(false);
        });
    } else {
      setRpcSlots(null);
      setRpcSlotDetails(null);
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

  // Horário de abertura e fecho para o dia selecionado (ex: 09:00 até 20:30, ou 09:00 até 12:30 no Domingo)
  const scheduleBounds = useMemo(() => {
    const dow = effectiveDate ? dayOfWeekFromDate(effectiveDate) : 2;
    const defaultStart = "09:00";
    const defaultEnd = dow === 0 ? "12:30" : "20:30";
    return {
      startTime: daySchedule?.start_time ? String(daySchedule.start_time).slice(0, 5) : defaultStart,
      endTime: daySchedule?.end_time ? String(daySchedule.end_time).slice(0, 5) : defaultEnd,
    };
  }, [daySchedule, effectiveDate]);

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

  // Mantém o horário de início da janela pré-selecionado quando aberto a partir da timeline
  useEffect(() => {
    if (isMatchingWindowDate && windowSpecificSlots.length > 0) {
      setManualTime((prev) =>
        prev && windowSpecificSlots.includes(prev) ? prev : windowSpecificSlots[0]
      );
    }
  }, [isMatchingWindowDate, windowSpecificSlots]);

  // Grelha completa de slots do dia (das 09:00 / abertura até ao fecho da barbearia)
  // Sem qualquer trava ou escurecimento de horários anteriores ao relógio atual — bloqueia apenas ocupações reais
  const allDaySlotEntries = useMemo(() => {
    if (timingMode === "now") return [];
    if (isDayOff) return [];

    let baseEntries = [];
    if (Array.isArray(rpcSlotDetails) && rpcSlotDetails.length > 0) {
      baseEntries = rpcSlotDetails.map((e) => ({
        ...e,
        isPast: false,
        isFuture: true,
      }));
    } else if (Array.isArray(rpcSlots) && rpcSlots.length > 0) {
      baseEntries = rpcSlots.map((timeStr) => ({
        time: timeStr,
        isPast: false,
        isFuture: true,
      }));
    } else {
      const sourceAppointments =
        effectiveDate === todayInShop() ? existingAppointments : targetDateAppointments;
      const busyRanges = extractBusyRangesFromAppointments(sourceAppointments, barberId);
      const serviceDur =
        effectiveServiceInfo?.durationMinutes ??
        selectedService?.duration_minutes ??
        selectedService?.default_duration_minutes ??
        30;

      const fallbackSchedule =
        daySchedule && daySchedule.active
          ? daySchedule
          : {
              active: true,
              start_time: scheduleBounds.startTime,
              end_time: scheduleBounds.endTime,
            };

      baseEntries = generateFullDaySlotsWithStatus(fallbackSchedule, busyRanges, serviceDur, {
        nowTime: null,
      });
    }

    if (windowSpecificSlots.length > 0) {
      const byTime = new Map(baseEntries.map((e) => [e.time, e]));
      windowSpecificSlots.forEach((ws) => {
        if (!byTime.has(ws)) {
          byTime.set(ws, { time: ws, isPast: false, isFuture: true });
        }
      });
      return Array.from(byTime.values()).sort((a, b) => a.time.localeCompare(b.time));
    }

    return baseEntries;
  }, [
    timingMode,
    selectedService,
    effectiveServiceInfo,
    isDayOff,
    rpcSlotDetails,
    rpcSlots,
    daySchedule,
    scheduleBounds,
    effectiveDate,
    existingAppointments,
    targetDateAppointments,
    barberId,
    windowSpecificSlots,
  ]);

  // Slots exibidos na grelha: por padrão exibe TODOS os horários livres das 09:00 (ou abertura) até o fecho
  const displayedSlotEntries = useMemo(() => {
    if (isMatchingWindowDate && focusWindowOnly && windowSpecificSlots.length > 0) {
      return windowSpecificSlots.map((t) => ({
        time: t,
        isPast: false,
        isFuture: true,
      }));
    }
    return allDaySlotEntries;
  }, [
    isMatchingWindowDate,
    focusWindowOnly,
    windowSpecificSlots,
    allDaySlotEntries,
  ]);

  // Permite navegar para qualquer dia (passado, ontem, hoje ou futuro) sem bloqueio
  function handleStepDate(deltaDays) {
    const base = selectedDate || todayInShop();
    const next = addDaysStr(base, deltaDays);
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
          ? "Escolha a data e um horário disponível na grelha."
          : 'Escolha um horário disponível na grelha ou marque "Agora".'
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      // No modo de encaixe do dia ("today_slot" ou "now") ou em datas retroativas, usa o fluxo direto de encaixe
      const isWalkInBooking =
        timingMode === "now" || timingMode === "today_slot" || effectiveDate < today;
      const response = await createWalkInAppointment({
        barber_id: barberId,
        service_id: serviceId,
        client_name: clientName,
        client_phone: clientPhone,
        date: effectiveDate,
        time: timingMode === "now" ? null : manualTime,
        is_walk_in: isWalkInBooking,
      });

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (response?.error) {
        setError(response.error);
        return;
      }

      // Invalida o cache de clientes para que o novo cliente salvo pelo telefone apareça imediatamente na aba Clientes
      invalidateCache("clients:");

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
          ? isRetroactiveDate
            ? "Lançar corte de dia anterior"
            : "Agendar / Encaixar em outra data"
          : "Novo atendimento / Encaixe"
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
                  {windowContext.endTime ? ` – ${windowContext.endTime}` : ""}
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

        {/* Campos do Cliente (Telefone como Chave Primária para registo automático em Clientes) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <FormField label="Nome do cliente">
            <div className="relative">
              <User
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <TextInput
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ex: João Silva"
                className="pl-8"
              />
            </div>
          </FormField>

          <FormField label="Telemóvel / WhatsApp (salva em Clientes)">
            <div className="relative">
              <Phone
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <TextInput
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                placeholder="(83) 99999-9999"
                className="pl-8 font-mono tabular-nums"
              />
            </div>
          </FormField>
        </div>

        <div className="mb-4">
          <span className="block text-xs font-medium text-zinc-400 mb-1.5">
            Momento / Horário
          </span>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            <button
              type="button"
              onClick={() => {
                setTimingMode("today_slot");
                setSelectedDate(today);
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
              <span className="truncate">Hoje (Horários)</span>
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
              <span className="truncate">Outra Data</span>
            </button>

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
          </div>

          {/* Atalho rápido para lançar corte pendente de Ontem quando está em Hoje */}
          {timingMode === "today_slot" && (
            <div className="flex items-center justify-between gap-2 mb-2.5 px-1">
              <span className="text-[11px] text-zinc-400">
                Exibindo expediente completo de hoje ({formatShortDDMM(today)})
              </span>
              <button
                type="button"
                onClick={() => {
                  setTimingMode("future_date");
                  setSelectedDate(addDaysStr(today, -1));
                  setManualTime("");
                }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2 py-0.5 active:scale-95 transition-all"
              >
                <History size={11} />
                <span>Lançar Ontem / Dia Anterior</span>
              </button>
            </div>
          )}

          {/* Mini Agenda / Seletor de Data (permite selecionar dias anteriores e datas futuras) */}
          {timingMode === "future_date" && (
            <div className="rounded-2xl bg-[#050505] border border-zinc-800/90 p-3 mb-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <CalendarDays size={15} className="text-accent shrink-0" />
                  <span className="text-xs font-semibold text-white truncate">
                    {formatDateReadable(selectedDate)}
                  </span>
                  {isRetroactiveDate && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 shrink-0">
                      Retroativo
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleStepDate(-1)}
                    aria-label="Dia anterior"
                    title="Voltar 1 dia (permite dias anteriores)"
                    className="w-8 h-8 rounded-lg bg-[#0d0d0d] border border-zinc-800 flex items-center justify-center text-zinc-300 hover:border-zinc-700 active:scale-95 transition-all"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <input
                    type="date"
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
                    title="Avançar 1 dia"
                    className="w-8 h-8 rounded-lg bg-[#0d0d0d] border border-zinc-800 flex items-center justify-center text-zinc-300 hover:border-zinc-700 active:scale-95 transition-all"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>

              {/* Faixa horizontal de dias rápidos (Mini Agenda incluindo dias passados: Anteontem, Ontem, Hoje, Amanhã...) */}
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
                      className={`shrink-0 min-w-[60px] py-2 px-2.5 rounded-xl border text-center transition-all touch-manipulation active:scale-95 ${
                        isSelected
                          ? "bg-accent border-accent text-white shadow-sm"
                          : d.isPastDate
                          ? "bg-[#0c0a06] border-amber-500/25 text-amber-200/85 hover:border-amber-500/50"
                          : "bg-[#0b0b0b] border-zinc-800/90 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <span
                        className={`block text-[10px] font-semibold uppercase tracking-wide ${
                          isSelected
                            ? "text-white/90"
                            : d.isPastDate
                            ? "text-amber-400"
                            : "text-zinc-500"
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

          {/* Grelha de Horários Disponíveis (Das 09:00 / Abertura até o Fechamento, sem ocultar horários anteriores ao relógio) */}
          {timingMode !== "now" && (
            <div className="rounded-2xl bg-[#050505] border border-zinc-800/80 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  {isMatchingWindowDate && focusWindowOnly
                    ? `Horários na janela (${windowContext.startTime}${
                        windowContext.endTime ? `–${windowContext.endTime}` : ""
                      })`
                    : `Expediente (${scheduleBounds.startTime} às ${scheduleBounds.endTime} • ${formatShortDDMM(
                        effectiveDate
                      )})`}
                </span>

                {isMatchingWindowDate && (
                  <button
                    type="button"
                    onClick={() => setFocusWindowOnly((prev) => !prev)}
                    className="text-[11px] font-semibold text-accent-light hover:underline shrink-0"
                  >
                    {focusWindowOnly
                      ? `Ver expediente (${scheduleBounds.startTime}–${scheduleBounds.endTime})`
                      : `Focar janela (${windowContext.startTime})`}
                  </button>
                )}

                {!isMatchingWindowDate && !loadingSlots && displayedSlotEntries.length > 0 && (
                  <span className="text-[11px] font-medium text-emerald-400">
                    {displayedSlotEntries.length} horários livres
                  </span>
                )}
              </div>

              {loadingSlots && !focusWindowOnly ? (
                <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5 py-3 text-xs text-zinc-200 font-medium">
                  <Loader2 size={14} className="animate-spin text-accent-light" />
                  <span>Consultando horários do expediente…</span>
                </div>
              ) : displayedSlotEntries.length === 0 ? (
                <div className="rounded-xl border border-amber-500/35 bg-zinc-900/95 px-3.5 py-3 flex items-start gap-2.5">
                  <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-100">
                      Sem horário disponível
                    </p>
                    <p className="text-[11px] text-zinc-300 mt-0.5 leading-relaxed">
                      {isDayOff || (daySchedule && !daySchedule.active)
                        ? "O profissional selecionado não possui expediente ativo nesta data."
                        : "Todos os slots entre a abertura e o fecho já estão ocupados por agendamentos reais."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-56 overflow-y-auto pr-0.5">
                  {displayedSlotEntries.map((entry) => {
                    const slot = entry.time;
                    const isWindowSlot = windowSpecificSlots.includes(slot);
                    const isSelected = manualTime === slot;

                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setManualTime(slot)}
                        title={`Horário livre disponível às ${slot}`}
                        className={`py-2 px-1.5 rounded-lg text-xs font-mono tabular-nums font-semibold border transition-all touch-manipulation select-none active:scale-95 text-center flex flex-col items-center justify-center ${
                          isSelected
                            ? "bg-accent border-accent text-white shadow-md shadow-red-600/30 ring-1 ring-accent-light"
                            : isWindowSlot
                            ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200 hover:border-emerald-400"
                            : "bg-[#0c1210] border-emerald-500/35 text-white hover:border-emerald-400 hover:bg-emerald-950/30 shadow-[0_0_10px_rgba(16,185,129,0.06)]"
                        }`}
                      >
                        <span>{slot}</span>
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
              ? isRetroactiveDate
                ? `Registar corte em ${formatShortDDMM(effectiveDate)} às ${manualTime}`
                : `Agendar para ${formatShortDDMM(effectiveDate)} às ${manualTime}`
              : isRetroactiveDate
              ? "Registar corte retroativo"
              : "Agendar atendimento"
            : manualTime && timingMode !== "now"
            ? `Confirmar encaixe às ${manualTime}`
            : "Registrar atendimento"}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
