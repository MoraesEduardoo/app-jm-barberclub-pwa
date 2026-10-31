"use client";

import { endSession } from "@/lib/session";
import { useEffect, useMemo, useState } from "react";
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

export default function WalkInSheet({
  open,
  onClose,
  barber,
  team,
  canPickBarber,
  existingAppointments,
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
  const [rpcSlots, setRpcSlots] = useState(null);
  const [isDayOff, setIsDayOff] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [targetDateAppointments, setTargetDateAppointments] = useState([]);
  const [resolvedConfig, setResolvedConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      const currentToday = todayInShop();
      listServices().then((data) =>
        setServices((data || []).filter((s) => s.active !== false && s.is_active !== false))
      );
      setBarberId(barber.id);
      setServiceId("");
      setClientName("");
      setClientPhone("");
      setTimingMode("now");
      setSelectedDate(addDaysStr(currentToday, 1));
      setManualTime("");
      setRpcSlots(null);
      setResolvedConfig(null);
      setIsDayOff(false);
      setError("");
    }
  }, [open, barber.id]);

  const effectiveDate = useMemo(() => {
    if (timingMode === "future_date") return selectedDate || today;
    return today;
  }, [timingMode, selectedDate, today]);

  // Filtra serviços habilitados para o barbeiro selecionado
  const availableServicesForBarber = useMemo(() => {
    return services.filter((s) => {
      const cfg = s.barber_durations?.[barberId];
      if (cfg && cfg.is_active === false) return false;
      if (s.barber_id && String(s.barber_id) !== String(barberId)) return false;
      return true;
    });
  }, [services, barberId]);

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

  // Limpa horário manual selecionado quando mudar data, barbeiro, serviço ou modo
  useEffect(() => {
    setManualTime("");
  }, [timingMode, effectiveDate, barberId, serviceId]);

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
          ? Promise.resolve({ data: existingAppointments })
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
  }, [timingMode, barberId, serviceId, effectiveDate, existingAppointments]);

  const daySchedule = useMemo(() => {
    if (!scheduleRows || scheduleRows.length === 0 || !effectiveDate) return null;
    const dow = dayOfWeekFromDate(effectiveDate);
    return scheduleRows.find((r) => r.day_of_week === dow) || null;
  }, [scheduleRows, effectiveDate]);

  const availableSlots = useMemo(() => {
    if (timingMode === "now" || !selectedService) return [];
    if (isDayOff) return [];
    if (Array.isArray(rpcSlots) && rpcSlots.length > 0) {
      return rpcSlots;
    }
    if (!daySchedule || !daySchedule.active) return [];

    const sourceAppointments =
      effectiveDate === todayInShop() ? existingAppointments : targetDateAppointments;
    const busyRanges = extractBusyRangesFromAppointments(sourceAppointments, barberId);
    const serviceDur =
      effectiveServiceInfo?.durationMinutes ??
      selectedService.duration_minutes ??
      selectedService.default_duration_minutes ??
      30;
    const isTargetToday = effectiveDate === todayInShop();

    return generateAvailableSlots(daySchedule, busyRanges, serviceDur, {
      nowTime: isTargetToday ? roundUpToNextSlot() : null,
    });
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
  ]);

  function handleStepDate(deltaDays) {
    const minDate = todayInShop();
    const next = addDaysStr(selectedDate || minDate, deltaDays);
    if (next < minDate) return;
    setSelectedDate(next);
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
      title={timingMode === "future_date" ? "Agendar atendimento" : "Novo atendimento"}
    >
      <form onSubmit={handleSubmit}>
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
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} — R$ {Number(prc).toFixed(2).replace(".", ",")} ({dur} min)
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
              onClick={() => setTimingMode("now")}
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
              onClick={() => setTimingMode("today_slot")}
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
                      if (e.target.value) setSelectedDate(e.target.value);
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
                      onClick={() => setSelectedDate(d.iso)}
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
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Horários disponíveis ({formatShortDDMM(effectiveDate)})
                </span>
                {selectedService && !loadingSlots && availableSlots.length > 0 && (
                  <span className="text-[11px] font-medium text-zinc-500">
                    {availableSlots.length} {availableSlots.length === 1 ? "vaga" : "vagas"} (
                    {effectiveServiceInfo?.durationMinutes ?? 30} min)
                  </span>
                )}
              </div>

              {!selectedService ? (
                <p className="text-zinc-500 text-xs py-2">
                  Selecione o serviço acima para consultar os horários livres.
                </p>
              ) : loadingSlots ? (
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
                  {availableSlots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setManualTime(slot)}
                      className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-all touch-manipulation select-none active:scale-95 text-center ${
                        manualTime === slot
                          ? "bg-accent border-accent text-white shadow-sm"
                          : "bg-[#0b0b0b] border-zinc-800 text-zinc-300 active:bg-zinc-800"
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
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
            : "Registrar atendimento"}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
