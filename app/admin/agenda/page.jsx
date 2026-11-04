"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { UserPlus, AlertCircle, RefreshCcw, Sparkles, Clock } from "lucide-react";
import { useBarber } from "@/lib/barber-context";
import { useNotifications } from "@/lib/notifications";
import { endSession } from "@/lib/session";
import { todayInShop } from "@/lib/dates";
import { PERMISSION_KEYS } from "@/lib/auth";
import {
  listAppointmentsByDate,
  updateAppointmentStatus,
  confirmAppointment,
  rescheduleAppointment,
} from "@/lib/actions/appointments";
import {
  cacheKeys,
  getCache,
  hasCache,
  setCache,
  invalidateCache,
} from "@/lib/admin-cache";
import DateStepper from "@/components/admin/DateStepper";
import AppointmentCard, {
  getAppointmentStartTime,
  getAppointmentDuration,
  getAppointmentEndTime,
  timeStrToMinutes,
  minutesToTimeStr,
} from "@/components/admin/AppointmentCard";
import AppointmentActionSheet from "@/components/admin/AppointmentActionSheet";
import PaymentSheet from "@/components/admin/PaymentSheet";
import AddProductSheet from "@/components/admin/AddProductSheet";
import EditServiceSheet from "@/components/admin/EditServiceSheet";
import WalkInSheet from "@/components/admin/WalkInSheet";
import ClientCyclesSheet from "@/components/admin/ClientCyclesSheet";
import PreScheduleSheet from "@/components/admin/PreScheduleSheet";
import AgendaDashboardWidget from "@/components/admin/AgendaDashboardWidget";
import SystemBootstrapCard from "@/components/admin/SystemBootstrapCard";
import { isPreScheduledAppointment } from "@/lib/pre-scheduled";
import { toast } from "@/lib/toast";

const STATUS_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "confirmado", label: "Confirmados" },
  { key: "concluido", label: "Concluídos" },
];

/**
 * Monta os itens da Linha do Tempo Vertical intercalando agendamentos ordenados
 * e marcadores de horário (de 30 em 30 min) nos intervalos livres.
 */
function buildTimelineItems(appointmentsList) {
  if (!Array.isArray(appointmentsList) || appointmentsList.length === 0) {
    return [];
  }

  const sorted = [...appointmentsList].sort((a, b) => {
    const startA = timeStrToMinutes(getAppointmentStartTime(a));
    const startB = timeStrToMinutes(getAppointmentStartTime(b));
    if (startA === null && startB === null) return 0;
    if (startA === null) return 1;
    if (startB === null) return -1;
    return startA - startB;
  });

  const items = [];
  let prevEndMin = null;

  sorted.forEach((appt, idx) => {
    const startStr = getAppointmentStartTime(appt);
    const startMin = timeStrToMinutes(startStr);
    const durationMin = getAppointmentDuration(appt);
    const endStr = getAppointmentEndTime(appt, startStr, durationMin);
    const endMin = timeStrToMinutes(endStr);

    // Se houver janela livre >= 20 min entre o término anterior e o próximo início,
    // insere marcadores de referência de 30 em 30 min (ex: 14:30, 15:00, 15:30)
    if (prevEndMin !== null && startMin !== null && startMin - prevEndMin >= 20) {
      const gapMinutes = startMin - prevEndMin;
      const firstTick = Math.ceil(prevEndMin / 30) * 30;
      const ticks = [];
      let cursor = firstTick;
      while (cursor < startMin - 5 && ticks.length < 3) {
        ticks.push(minutesToTimeStr(cursor));
        cursor += 30;
      }
      if (ticks.length === 0) {
        ticks.push(minutesToTimeStr(prevEndMin));
      }

      items.push({
        type: "gap",
        key: `gap-${prevEndMin}-${startMin}-${idx}`,
        ticks,
        gapMinutes,
        fromTime: minutesToTimeStr(prevEndMin),
        toTime: startStr,
      });
    }

    items.push({
      type: "appointment",
      key: appt.id,
      appointment: appt,
    });

    if (endMin !== null) {
      prevEndMin = prevEndMin === null ? endMin : Math.max(prevEndMin, endMin);
    }
  });

  return items;
}

export default function AgendaPage() {
  const {
    can,
    scopeBarberId,
    selectedBarberId,
    selectBarber,
    viewedBarber,
    team,
    refreshTeam,
  } = useBarber();
  const { notifications } = useNotifications();
  const canViewAll = can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  const [date, setDate] = useState(() => todayInShop());
  const apptCacheKey = cacheKeys.appointments(date, scopeBarberId);

  // Inicializa sincronamente do cache em memória para renderização em 0ms ao trocar de aba
  const [appointments, setAppointments] = useState(
    () => getCache(apptCacheKey) || []
  );
  const [loading, setLoading] = useState(() => !hasCache(apptCacheKey));
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [productTarget, setProductTarget] = useState(null);
  const [editServiceTarget, setEditServiceTarget] = useState(null);
  const [preScheduleTarget, setPreScheduleTarget] = useState(null);
  const [filterMode, setFilterMode] = useState("all"); // 'all' | 'confirmado' | 'concluido' | 'pre_scheduled'
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [cyclesOpen, setCyclesOpen] = useState(false);
  const requestIdRef = useRef(0);

  /**
   * Atualiza estado local e sincroniza imediatamente o cache em memória da data/escopo atual.
   */
  const syncAppointmentsState = useCallback(
    (updater) => {
      setAppointments((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        setCache(cacheKeys.appointments(date, scopeBarberId), next);
        return next;
      });
    },
    [date, scopeBarberId]
  );

  /**
   * Busca os agendamentos do dia selecionado.
   * Quando já existe cache em memória, exibe os dados instantaneamente (0ms) e revalida com silent = true.
   */
  const load = useCallback(
    async ({ silent = false } = {}) => {
      const requestId = ++requestIdRef.current;
      const currentKey = cacheKeys.appointments(date, scopeBarberId);
      const cachedList = getCache(currentKey);
      const hasCachedData = Array.isArray(cachedList);

      if (hasCachedData) {
        setAppointments(cachedList);
        setLoading(false);
      } else if (!silent) {
        setLoading(true);
        setLoadError("");
      }

      try {
        const response = await listAppointmentsByDate(date, scopeBarberId);

        if (requestId !== requestIdRef.current) return;

        if (response?.error === "AUTH_EXPIRED") {
          endSession();
          return;
        }

        if (response?.error) {
          if (!silent && !hasCachedData) {
            setAppointments([]);
            setLoadError(response.error);
          }
          return;
        }

        const freshData = response?.data || [];
        setCache(currentKey, freshData);
        setAppointments(freshData);
        setLoadError("");
      } catch {
        if (requestId !== requestIdRef.current) return;
        if (!silent && !hasCachedData) {
          setAppointments([]);
          setLoadError("Sem conexão. Verifique a internet e tente de novo.");
        }
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [date, scopeBarberId]
  );

  useEffect(() => {
    const cached = getCache(apptCacheKey);
    if (Array.isArray(cached)) {
      setAppointments(cached);
      setLoading(false);
      load({ silent: true });
    } else {
      load({ silent: false });
    }
  }, [apptCacheKey, load]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const latestNotificationId = notifications[0]?.id;
  useEffect(() => {
    if (latestNotificationId) loadRef.current({ silent: true });
  }, [latestNotificationId]);

  async function executeStatusChange(id, status) {
    if (busyId) return;
    setBusyId(id);
    setActionError("");

    // Atualização otimista imediata no estado e no cache
    const previousAppointments = appointments;
    syncAppointmentsState((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a))
    );

    try {
      const response = await updateAppointmentStatus(id, status);

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (!response?.success) {
        syncAppointmentsState(previousAppointments);
        const msg = response?.error || "Não foi possível atualizar o status.";
        setActionError(msg);
        toast.error(msg);
        return;
      }

      invalidateCache("finance:");
      invalidateCache("cancellations:");
      invalidateCache("clients:");

      toast.success(
        status === "confirmado"
          ? "Agendamento confirmado com sucesso!"
          : "Agendamento cancelado e horário liberado na agenda!"
      );
    } catch {
      syncAppointmentsState(previousAppointments);
      const msg = "Sem conexão. Não foi possível atualizar o status.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  function handleChangeStatus(id, status) {
    if (busyId) return;
    executeStatusChange(id, status);
  }

  function handleClosePayment() {
    setPaymentTarget(null);
    invalidateCache("finance:");
    invalidateCache("clients:");
    load({ silent: true });
  }

  function handleCloseWalkIn(result) {
    setWalkInOpen(false);
    if (result?.created) {
      invalidateCache("appointments:");
      invalidateCache("finance:");
      invalidateCache("clients:");
      const targetDate = result.date;
      if (targetDate && targetDate !== date) {
        setDate(targetDate);
        const [, m, d] = String(targetDate).split("-");
        toast.success(
          `Agendamento marcado para ${d}/${m}${result.time ? ` às ${result.time}` : ""}!`
        );
        return;
      }
      toast.success(
        result.time
          ? `Atendimento agendado para ${result.time}!`
          : "Atendimento registrado com sucesso!"
      );
    }
    load({ silent: true });
  }

  async function handleConfirmPreScheduled(id) {
    const res = await confirmAppointment(id);
    if (res?.error) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    syncAppointmentsState((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "confirmado" } : a))
    );
    load({ silent: true });
  }

  async function handleReschedulePreScheduled({ id, newDate, newTime, newBarberId }) {
    const res = await rescheduleAppointment({ id, newDate, newTime, newBarberId });
    if (res?.error) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    invalidateCache("appointments:");
    load({ silent: true });
  }

  async function handleCancelPreScheduled(id, reason) {
    const res = await updateAppointmentStatus(id, "cancelado", { reason });
    if (res?.error) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    syncAppointmentsState((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "cancelado" } : a))
    );
    invalidateCache("cancellations:");
    load({ silent: true });
  }

  const isToday = date === todayInShop();
  const activeAppointments = appointments.filter((a) => {
    const st = (a.status || "confirmado").toLowerCase().trim();
    return st !== "cancelado" && st !== "cancelled";
  });
  const preScheduledCount = activeAppointments.filter(isPreScheduledAppointment).length;

  const filterCounts = {
    all: activeAppointments.length,
    confirmado: activeAppointments.filter((a) => {
      const st = (a.status || "confirmado").toLowerCase().trim();
      return (
        (st === "confirmado" ||
          st === "confirmed" ||
          st === "pendente" ||
          st === "pending" ||
          st === "agendado" ||
          st === "pre_scheduled") &&
        a.payment_status !== "pago" &&
        st !== "concluido" &&
        st !== "concluído" &&
        st !== "completed"
      );
    }).length,
    concluido: activeAppointments.filter((a) => {
      const st = (a.status || "confirmado").toLowerCase().trim();
      return (
        st === "concluido" ||
        st === "concluído" ||
        st === "completed" ||
        a.payment_status === "pago"
      );
    }).length,
  };

  const displayedAppointments = activeAppointments.filter((a) => {
    if (filterMode === "all") return true;
    if (filterMode === "pre_scheduled") return isPreScheduledAppointment(a);
    const st = (a.status || "confirmado").toLowerCase().trim();
    if (filterMode === "confirmado") {
      return (
        (st === "confirmado" ||
          st === "confirmed" ||
          st === "pendente" ||
          st === "pending" ||
          st === "agendado" ||
          st === "pre_scheduled") &&
        a.payment_status !== "pago" &&
        st !== "concluido" &&
        st !== "concluído" &&
        st !== "completed"
      );
    }
    if (filterMode === "concluido") {
      return (
        st === "concluido" ||
        st === "concluído" ||
        st === "completed" ||
        a.payment_status === "pago"
      );
    }
    return true;
  });

  const timelineItems = useMemo(
    () => buildTimelineItems(displayedAppointments),
    [displayedAppointments]
  );

  const selectedAppointment = useMemo(
    () => appointments.find((a) => a.id === selectedAppointmentId) || null,
    [appointments, selectedAppointmentId]
  );

  return (
    <div className="px-4 pt-4 pb-8 relative">
      {/* Assistente de Primeiro Acesso / Bootstrap quando o banco está limpo */}
      <SystemBootstrapCard
        onBootstrapChange={() => {
          refreshTeam({ force: true });
          load({ silent: true });
        }}
      />

      {/* Seletor Rápido de Equipe para Liderança (Chefe e Gerente) */}
      {canViewAll && team.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-1 no-scrollbar select-none">
          <button
            type="button"
            onClick={() => selectBarber(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all touch-manipulation ${
              !selectedBarberId
                ? "bg-accent text-black shadow-sm ring-1 ring-accent"
                : "bg-surface border border-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            Toda a equipe
          </button>
          {team.map((m) => {
            const isSelected = selectedBarberId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectBarber(m.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all touch-manipulation flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-accent text-black shadow-sm ring-1 ring-accent"
                    : "bg-surface border border-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                <span>{m.name.split(" ")[0]}</span>
                {m.role === "admin" && <span className="text-[10px]">Chefe</span>}
                {m.role === "manager" && <span className="text-[10px]">Ger.</span>}
              </button>
            );
          })}
        </div>
      )}

      <DateStepper value={date} onChange={setDate} barberId={scopeBarberId} />

      {/* Dashboard Dinâmico de Status Financeiro do Dia */}
      <div className="mt-3">
        <AgendaDashboardWidget appointments={appointments} isToday={isToday} />
      </div>

      {/* Filtros de Status da Agenda + Atalho de Lembretes de Retorno */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar select-none">
          {STATUS_FILTERS.map((f) => {
            const active = filterMode === f.key;
            const count = filterCounts[f.key] ?? 0;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilterMode(f.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all touch-manipulation ${
                  active
                    ? "bg-white text-black shadow-sm"
                    : "bg-surface border border-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setCyclesOpen(true)}
          className="shrink-0 flex items-center justify-center gap-1.5 h-8 px-3 rounded-xl bg-surface border border-zinc-800 text-xs font-semibold text-white active:scale-95 active:bg-elevated transition-all touch-manipulation select-none"
        >
          <Sparkles size={13} className="text-emerald-400" />
          Retorno
        </button>
      </div>

      {/* Banner & Filtro de Pré-Agendamentos Futuros (Chatbot) */}
      {preScheduledCount > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 p-3 rounded-2xl bg-gradient-to-r from-purple-950/40 via-purple-900/25 to-zinc-900 border border-purple-500/30 animate-in fade-in">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 flex items-center justify-center shrink-0 text-xs font-bold">
              <Sparkles size={13} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-white font-bold truncate">
                {preScheduledCount === 1
                  ? "1 pré-agendamento futuro"
                  : `${preScheduledCount} pré-agendamentos futuros`}
              </p>
              <p className="text-[10px] text-purple-300 truncate">
                Recorrência garantida via chatbot
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              setFilterMode((prev) => (prev === "pre_scheduled" ? "all" : "pre_scheduled"))
            }
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 touch-manipulation ${
              filterMode === "pre_scheduled"
                ? "bg-purple-600 text-white shadow-md shadow-purple-950/50"
                : "bg-purple-900/30 text-purple-300 border border-purple-500/30 hover:bg-purple-900/50"
            }`}
          >
            {filterMode === "pre_scheduled" ? "Ver todos" : "Filtrar"}
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2.5 text-xs text-red-300"
        >
          <AlertCircle size={14} className="mt-px shrink-0" />
          <p className="flex-1">{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError("")}
            className="text-red-400 font-medium"
          >
            Fechar
          </button>
        </div>
      )}

      {/* Visualização em Linha do Tempo Vertical */}
      <div className="mt-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-stretch gap-3">
                <div className="w-14 shrink-0 flex flex-col items-end pr-2 pt-2">
                  <div className="h-3.5 w-10 rounded bg-surface animate-pulse" />
                </div>
                <div className="flex-1 h-[84px] rounded-2xl bg-surface animate-pulse" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <p className="text-zinc-400 text-sm max-w-xs">{loadError}</p>
            <button
              type="button"
              onClick={() => load()}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-elevated border border-zinc-700 text-xs font-medium text-white active:bg-zinc-800"
            >
              <RefreshCcw size={14} /> Tentar de novo
            </button>
          </div>
        ) : displayedAppointments.length === 0 ? (
          <div className="text-center py-14 space-y-2">
            <p className="text-zinc-500 text-sm">
              {filterMode === "all"
                ? "Nenhum agendamento para essa data."
                : "Nenhum agendamento encontrado neste filtro."}
            </p>
            {filterMode !== "all" && (
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className="text-xs text-accent-light hover:underline font-semibold"
              >
                Mostrar todos os horários do dia
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* Cabeçalho discreto da Timeline */}
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <Clock size={12} className="text-accent-light" />
                <span>Linha do Tempo</span>
              </div>
              <span className="text-[11px] text-zinc-500">
                Toque no horário para abrir ações
              </span>
            </div>

            <div className="relative">
              {timelineItems.map((item, index) => {
                if (item.type === "gap") {
                  return (
                    <div
                      key={item.key}
                      className="relative flex items-center gap-3 sm:gap-4 py-1.5 select-none"
                    >
                      <div className="w-14 sm:w-16 shrink-0 flex flex-col items-end pr-2 relative">
                        <div className="absolute right-0 -top-2 -bottom-2 w-px border-r border-dashed border-zinc-800" />
                        <span className="absolute -right-[3px] top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-zinc-700" />
                        <div className="flex flex-col items-end gap-1">
                          {item.ticks.map((t) => (
                            <span
                              key={t}
                              className="font-mono tabular-nums text-[10px] font-medium text-zinc-600 leading-none"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0 py-1">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-dashed border-zinc-900 bg-zinc-950/40">
                          <span className="text-[11px] text-zinc-600 font-medium">
                            Janela livre ({item.fromTime} – {item.toTime})
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }

                const isLastItem = index === timelineItems.length - 1;
                return (
                  <AppointmentCard
                    key={item.key}
                    appointment={item.appointment}
                    isLast={isLastItem}
                    busy={busyId === item.appointment.id}
                    onSelect={(appt) => setSelectedAppointmentId(appt.id)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal / Drawer de Ações ao clicar no Card da Timeline */}
      <AppointmentActionSheet
        open={Boolean(selectedAppointment)}
        onClose={() => setSelectedAppointmentId(null)}
        appointment={selectedAppointment}
        busy={busyId === selectedAppointment?.id}
        onChangeStatus={handleChangeStatus}
        onOpenPayment={setPaymentTarget}
        onAddProduct={setProductTarget}
        onEditService={setEditServiceTarget}
        onOpenPreSchedule={setPreScheduleTarget}
        onProductRemoved={() => {
          invalidateCache(cacheKeys.products());
          invalidateCache("finance:");
          load({ silent: true });
        }}
      />

      <PaymentSheet
        open={Boolean(paymentTarget)}
        onClose={handleClosePayment}
        appointment={paymentTarget}
      />

      <EditServiceSheet
        open={Boolean(editServiceTarget)}
        onClose={() => setEditServiceTarget(null)}
        appointment={editServiceTarget}
        onSaved={(res) => {
          toast.success(
            res?.serviceName
              ? `Serviço alterado para "${res.serviceName}" e valor atualizado!`
              : "Serviço do atendimento atualizado com sucesso!"
          );
          if (editServiceTarget?.id && res?.serviceId) {
            syncAppointmentsState((prev) =>
              prev.map((a) =>
                a.id === editServiceTarget.id
                  ? {
                      ...a,
                      service_id: res.serviceId,
                      service: res.serviceName || a.service,
                      duration_minutes: res.durationMinutes ?? a.duration_minutes,
                      price: res.newTotal ?? a.price,
                      total_price: res.newTotal ?? a.total_price,
                      services: {
                        ...(a.services || {}),
                        id: res.serviceId,
                        name: res.serviceName || a.services?.name,
                        price: res.servicePrice ?? a.services?.price,
                        duration_minutes: res.durationMinutes ?? a.services?.duration_minutes,
                        default_duration_minutes:
                          res.durationMinutes ?? a.services?.default_duration_minutes,
                      },
                    }
                  : a
              )
            );
          }
          invalidateCache("finance:");
          load({ silent: true });
        }}
      />

      <AddProductSheet
        open={Boolean(productTarget)}
        onClose={() => setProductTarget(null)}
        appointment={productTarget}
        onAdded={(res) => {
          const count = res?.addedItems?.length || 1;
          toast.success(
            count > 1
              ? `${count} produtos adicionados e somados ao atendimento!`
              : "Produto adicionado e somado ao atendimento!"
          );
          if (productTarget?.id && res?.newTotal != null) {
            syncAppointmentsState((prev) =>
              prev.map((a) =>
                a.id === productTarget.id
                  ? {
                      ...a,
                      price: res.newTotal,
                      total_price: res.newTotal,
                      notes: res.updatedNotes,
                    }
                  : a
              )
            );
          }
          invalidateCache(cacheKeys.products());
          invalidateCache("finance:");
          load({ silent: true });
        }}
      />

      <PreScheduleSheet
        open={Boolean(preScheduleTarget)}
        onClose={() => setPreScheduleTarget(null)}
        appointment={preScheduleTarget}
        team={team}
        onConfirm={handleConfirmPreScheduled}
        onReschedule={handleReschedulePreScheduled}
        onCancel={handleCancelPreScheduled}
      />

      <button
        type="button"
        onClick={() => setWalkInOpen(true)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] right-4 z-30 flex items-center gap-2 h-12 pl-4 pr-5 rounded-full bg-accent text-white text-sm font-semibold shadow-accent-glow active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none"
      >
        <UserPlus size={18} />
        Sem hora
      </button>

      <WalkInSheet
        open={walkInOpen}
        onClose={handleCloseWalkIn}
        barber={viewedBarber}
        team={team}
        canPickBarber={canViewAll}
        existingAppointments={appointments}
      />

      <ClientCyclesSheet
        open={cyclesOpen}
        onClose={() => setCyclesOpen(false)}
        scopeBarberId={scopeBarberId}
      />
    </div>
  );
}
