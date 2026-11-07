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
 * Formata a duração total de uma janela livre para leitura rápida na timeline
 * Ex: 65 -> "1h05", 25 -> "25 min", 60 -> "1h"
 */
function formatAvailableGapDuration(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  if (mins < 60) {
    return `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) {
    return `${hours}h`;
  }
  return `${hours}h${String(rem).padStart(2, "0")}`;
}

/**
 * Monta o texto limpo, direto e elegante exibido na faixa de intervalo livre
 * Ex: "⏱️ Intervalo livre • 25 min"
 * Ex: "⏱️ Intervalo livre • 1h05"
 */
function formatFluidGapLabel(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const durationText = formatAvailableGapDuration(mins);
  return `⏱️ Intervalo livre • ${durationText}`;
}

/**
 * Determina o horário padrão de fecho da barbearia para a data selecionada
 * (Domingo: 12:30 | Segunda a Sábado: 20:30)
 */
function getShopClosingTimeForDate(dateStr) {
  if (!dateStr) return "20:30";
  const parts = String(dateStr).slice(0, 10).split("-").map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    const dt = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    if (dt.getDay() === 0) return "12:30";
  }
  return "20:30";
}

/**
 * Monta os itens da Linha do Tempo Vertical em Blocos Estruturados,
 * intercalando agendamentos confirmados/concluídos e faixas minimalistas
 * de Janela Livre nos períodos disponíveis.
 */
function buildTimelineItems(appointmentsList, { closingTime = "20:30", includeTrailingGap = true } = {}) {
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
  let prevBarberId = null;

  sorted.forEach((appt, idx) => {
    const startStr = getAppointmentStartTime(appt);
    const startMin = timeStrToMinutes(startStr);
    const durationMin = getAppointmentDuration(appt);
    const endStr = getAppointmentEndTime(appt, startStr, durationMin);
    const endMin = timeStrToMinutes(endStr);
    const currentBarberId = appt.barbers?.id || appt.barber_id || null;

    // Qualquer janela livre >= 10 min entre o término anterior e o próximo início
    // é exibida como faixa minimalista com espaçamento definido e atalho de encaixe
    if (prevEndMin !== null && startMin !== null && startMin - prevEndMin >= 10) {
      const gapMinutes = startMin - prevEndMin;
      const firstTick = Math.ceil((prevEndMin + 10) / 30) * 30;
      const ticks = [];
      let cursor = firstTick;
      while (cursor <= startMin - 10 && ticks.length < 3) {
        ticks.push(minutesToTimeStr(cursor));
        cursor += 30;
      }

      items.push({
        type: "gap",
        key: `gap-${prevEndMin}-${startMin}-${idx}`,
        ticks,
        gapMinutes,
        fromTime: minutesToTimeStr(prevEndMin),
        toTime: startStr,
        barberId: prevBarberId || currentBarberId,
        durationLabel: formatAvailableGapDuration(gapMinutes),
        fluidLabel: formatFluidGapLabel(gapMinutes),
      });
    }

    items.push({
      type: "appointment",
      key: appt.id,
      appointment: appt,
      endTime: endStr,
    });

    if (endMin !== null) {
      if (prevEndMin === null || endMin >= prevEndMin) {
        prevEndMin = endMin;
        prevBarberId = currentBarberId || prevBarberId;
      }
    }
  });

  // Se o último atendimento terminar antes do fecho do expediente (>= 20 min livres),
  // exibe a janela livre final até o horário de fecho para facilitar encaixes no fim do dia
  const closeMin = timeStrToMinutes(closingTime);
  if (
    includeTrailingGap &&
    prevEndMin !== null &&
    closeMin !== null &&
    closeMin - prevEndMin >= 20
  ) {
    const gapMinutes = closeMin - prevEndMin;
    const firstTick = Math.ceil((prevEndMin + 10) / 30) * 30;
    const ticks = [];
    let cursor = firstTick;
    while (cursor <= closeMin - 10 && ticks.length < 3) {
      ticks.push(minutesToTimeStr(cursor));
      cursor += 30;
    }

    items.push({
      type: "gap",
      key: `gap-trailing-${prevEndMin}-${closeMin}`,
      ticks,
      gapMinutes,
      fromTime: minutesToTimeStr(prevEndMin),
      toTime: closingTime,
      barberId: prevBarberId,
      durationLabel: formatAvailableGapDuration(gapMinutes),
      fluidLabel: formatFluidGapLabel(gapMinutes),
    });
  }

  return items;
}

/**
 * Busca os agendamentos do dia via HTTP GET rápido (/api/appointments)
 * com fallback imediato para Server Action e proteção de timeout (8s).
 */
async function fetchAppointmentsImmediate(date, scopeBarberId) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT_APPOINTMENTS")), 8000)
  );

  const fetchTask = (async () => {
    try {
      const params = new URLSearchParams({ date: String(date || "") });
      if (scopeBarberId) params.set("barber_id", String(scopeBarberId));
      const res = await fetch(`/api/appointments?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (res.status === 401) {
        return { error: "AUTH_EXPIRED" };
      }
      if (res.ok) {
        const json = await res.json();
        if (json?.ok && Array.isArray(json.data)) {
          return { data: json.data };
        }
      }
    } catch {
      // Fallback imediato para Server Action
    }
    return await listAppointmentsByDate(date, scopeBarberId);
  })();

  return Promise.race([fetchTask, timeoutPromise]);
}

export default function AgendaPage() {
  const {
    barber,
    can,
    scopeBarberId,
    selectedBarberId,
    selectBarber,
    viewedBarber,
    team,
    refreshTeam,
    setActiveTab,
  } = useBarber();
  const { notifications } = useNotifications();
  const canViewAll = can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  const [date, setDate] = useState(() => todayInShop());
  const apptCacheKey = cacheKeys.appointments(date, scopeBarberId);

  // Inicializa sincronamente do cache em memória caso já possua registros carregados
  const [appointments, setAppointments] = useState(() => {
    const cached = getCache(apptCacheKey);
    return Array.isArray(cached) ? cached : [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = getCache(apptCacheKey);
    return !(Array.isArray(cached) && cached.length > 0);
  });
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
  const [walkInInitialTime, setWalkInInitialTime] = useState("");
  const [walkInWindowContext, setWalkInWindowContext] = useState(null);
  const [cyclesOpen, setCyclesOpen] = useState(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setActiveTab("agenda");
    return () => {
      mountedRef.current = false;
    };
  }, [setActiveTab]);

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
   * Busca os agendamentos do dia selecionado imediatamente no mount e a cada troca de data/barbeiro.
   */
  const load = useCallback(
    async ({ silent = false } = {}) => {
      const requestId = ++requestIdRef.current;
      const currentKey = cacheKeys.appointments(date, scopeBarberId);
      const cachedList = getCache(currentKey);
      const hasNonEmptyCache = Array.isArray(cachedList) && cachedList.length > 0;

      if (hasNonEmptyCache) {
        setAppointments(cachedList);
        setLoading(false);
      } else if (!silent) {
        setLoading(true);
        setLoadError("");
      }

      try {
        const response = await fetchAppointmentsImmediate(date, scopeBarberId);

        if (!mountedRef.current || requestId !== requestIdRef.current) return;

        if (response?.error === "AUTH_EXPIRED") {
          endSession();
          return;
        }

        if (response?.error) {
          if (!hasNonEmptyCache) {
            setAppointments([]);
            setLoadError(response.error);
          }
          return;
        }

        const freshData = Array.isArray(response?.data) ? response.data : [];
        setCache(currentKey, freshData);
        setAppointments(freshData);
        setLoadError("");
      } catch {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        if (!hasNonEmptyCache) {
          setAppointments([]);
          setLoadError("Sem conexão. Verifique a internet e tente de novo.");
        }
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [date, scopeBarberId]
  );

  // Disparo automático imediato no mount e ao alterar data ou barbeiro selecionado
  useEffect(() => {
    if (!barber?.id) return;
    const cached = getCache(apptCacheKey);
    const hasNonEmptyCache = Array.isArray(cached) && cached.length > 0;

    if (hasNonEmptyCache) {
      setAppointments(cached);
      setLoading(false);
      load({ silent: true });
    } else {
      load({ silent: false });
    }
  }, [barber?.id, apptCacheKey, load]);

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
    setWalkInInitialTime("");
    setWalkInWindowContext(null);
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

  const shopClosingTime = useMemo(() => getShopClosingTimeForDate(date), [date]);

  // Ordena dinamicamente os profissionais do filtro de topo:
  // 1º Utilizador logado ativo (Matheus ou William), 2º O outro profissional, 3º Todos
  const orderedTeamMembers = useMemo(() => {
    if (!Array.isArray(team) || team.length === 0) return [];
    const activeId = barber?.id ? String(barber.id) : "";
    const activeFirstName = (barber?.name || "").trim().split(/\s+/)[0]?.toLowerCase() || "";

    return [...team].sort((a, b) => {
      const aIsSelf =
        (activeId && String(a.id) === activeId) ||
        (activeFirstName &&
          (a.name || "").trim().split(/\s+/)[0]?.toLowerCase() === activeFirstName);
      const bIsSelf =
        (activeId && String(b.id) === activeId) ||
        (activeFirstName &&
          (b.name || "").trim().split(/\s+/)[0]?.toLowerCase() === activeFirstName);

      if (aIsSelf && !bIsSelf) return -1;
      if (!aIsSelf && bIsSelf) return 1;
      return 0;
    });
  }, [team, barber?.id, barber?.name]);

  const timelineItems = useMemo(
    () =>
      buildTimelineItems(displayedAppointments, {
        closingTime: shopClosingTime,
        includeTrailingGap: filterMode === "all",
      }),
    [displayedAppointments, shopClosingTime, filterMode]
  );

  const lastTimelineAppointment = useMemo(() => {
    for (let i = timelineItems.length - 1; i >= 0; i--) {
      if (timelineItems[i].type === "appointment") {
        return timelineItems[i];
      }
    }
    return null;
  }, [timelineItems]);

  // Verifica se o último agendamento coincide com o fecho real do expediente (ex: 20:30)
  const hasReachedEndOfShift = useMemo(() => {
    if (!lastTimelineAppointment?.endTime) return false;
    const endMin = timeStrToMinutes(lastTimelineAppointment.endTime);
    const closeMin = timeStrToMinutes(shopClosingTime);
    if (endMin === null || closeMin === null) return false;
    return endMin >= closeMin;
  }, [lastTimelineAppointment, shopClosingTime]);

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

      {/* Seletor Rápido de Equipa (Ordem Dinâmica: 1º Logado, 2º Colega, 3º Todos) */}
      {canViewAll && orderedTeamMembers.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2.5 mb-1 no-scrollbar select-none">
          {orderedTeamMembers.map((m) => {
            const isSelected = String(selectedBarberId) === String(m.id);
            const shortName = (m.name || "").trim().split(/\s+/)[0] || m.name;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectBarber(m.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all touch-manipulation ${
                  isSelected
                    ? "bg-accent text-white shadow-sm ring-1 ring-accent"
                    : "bg-zinc-900/90 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700"
                }`}
              >
                {shortName}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => selectBarber(null)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all touch-manipulation ${
              !selectedBarberId
                ? "bg-accent text-white shadow-sm ring-1 ring-accent"
                : "bg-zinc-900/90 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700"
            }`}
          >
            Todos
          </button>
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

      {/* Visualização em Linha do Tempo Vertical em Blocos (v2.8) */}
      <div className="mt-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-stretch gap-3">
                <div className="w-14 shrink-0 flex flex-col items-end pr-3 pt-2">
                  <div className="h-3.5 w-10 rounded bg-surface animate-pulse" />
                </div>
                <div className="flex-1 h-[88px] rounded-2xl bg-surface animate-pulse" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <p className="text-zinc-300 text-sm max-w-xs">{loadError}</p>
            <button
              type="button"
              onClick={() => load()}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-elevated border border-zinc-700 text-xs font-medium text-white active:bg-zinc-800"
            >
              <RefreshCcw size={14} /> Tentar de novo
            </button>
          </div>
        ) : displayedAppointments.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 px-5 py-10 text-center space-y-3">
            <div className="mx-auto h-10 w-10 rounded-xl bg-zinc-800/90 border border-zinc-700 flex items-center justify-center text-zinc-200">
              <Clock size={18} className="text-accent-light" />
            </div>
            <div className="space-y-1">
              <p className="text-zinc-100 text-sm font-bold">
                {filterMode === "all"
                  ? "Nenhum agendamento registrado para esta data"
                  : "Nenhum agendamento encontrado neste filtro"}
              </p>
              <p className="text-zinc-300 text-xs">
                {filterMode === "all"
                  ? `Todos os horários (${shopClosingTime === "12:30" ? "08:00 às 12:30" : "09:00 às 20:30"}) estão livres para encaixe.`
                  : "Altere o filtro acima para visualizar os demais atendimentos do dia."}
              </p>
            </div>
            {filterMode !== "all" ? (
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className="inline-flex items-center justify-center px-3.5 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 text-xs text-white hover:border-zinc-600 font-semibold transition-all"
              >
                Mostrar todos os horários do dia
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setWalkInInitialTime("");
                  setWalkInWindowContext(null);
                  setWalkInOpen(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-accent/15 border border-accent/40 text-xs text-accent-light hover:bg-accent/25 font-bold transition-all"
              >
                <UserPlus size={14} />
                + Encaixar atendimento
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* Cabeçalho da Linha do Tempo em Blocos */}
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                <Clock size={12} className="text-accent-light" />
                <span>Linha do Tempo</span>
              </div>
              <span className="text-[11px] text-zinc-400">
                Vagas livres e ocupações do dia
              </span>
            </div>

            <div className="relative space-y-1">
              {timelineItems.map((item, index) => {
                if (item.type === "gap") {
                  // Altura proporcional ao tamanho do período livre com espaçamento claro
                  const gapMinHeight = Math.max(
                    50,
                    Math.min(116, Math.round(item.gapMinutes * 0.72 + 28))
                  );

                  return (
                    <div
                      key={item.key}
                      className="relative flex items-stretch gap-3 sm:gap-4 select-none"
                    >
                      {/* Coluna Esquerda: Eixo Cronológico do Período Livre */}
                      <div className="w-14 sm:w-16 shrink-0 flex flex-col justify-between items-end pr-3 py-2 relative">
                        <div className="absolute right-0 top-0 bottom-0 w-px border-r border-dashed border-zinc-800/85" />
                        <span className="absolute -right-[3.5px] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full border border-zinc-600 bg-oled z-10" />

                        <span className="font-mono tabular-nums text-[10px] font-medium text-zinc-400 leading-none">
                          {item.fromTime}
                        </span>

                        {item.ticks.length > 0 && item.gapMinutes >= 60 && (
                          <div className="flex flex-col items-end gap-0.5 my-0.5">
                            {item.ticks.slice(0, 2).map((t) => (
                              <span
                                key={t}
                                className="font-mono tabular-nums text-[9px] text-zinc-500 leading-none"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}

                        <span className="font-mono tabular-nums text-[10px] font-medium text-zinc-500 leading-none">
                          {item.toTime}
                        </span>
                      </div>

                      {/* Coluna Direita: Faixa Minimalista de Período Livre (Atalho Fluido de Encaixe) */}
                      <div className="flex-1 min-w-0 py-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const targetBarberId =
                              scopeBarberId ||
                              item.barberId ||
                              viewedBarber?.id ||
                              barber?.id ||
                              null;
                            setWalkInInitialTime(item.fromTime);
                            setWalkInWindowContext({
                              startTime: item.fromTime,
                              endTime: item.toTime,
                              gapMinutes: item.gapMinutes,
                              barberId: targetBarberId,
                              date,
                            });
                            setWalkInOpen(true);
                          }}
                          style={{ minHeight: `${gapMinHeight}px` }}
                          className="w-full text-left rounded-xl border border-dashed border-zinc-800/95 bg-[#07070a]/90 bg-[repeating-linear-gradient(-45deg,rgba(255,255,255,0.018)_0px,rgba(255,255,255,0.018)_5px,transparent_5px,transparent_11px)] hover:border-zinc-700 hover:bg-[#0c0c12] active:scale-[0.995] transition-all px-3.5 py-2.5 flex items-center justify-between gap-3 group touch-manipulation"
                        >
                          <div className="flex flex-col justify-center min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[11px] sm:text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors truncate">
                                {item.fluidLabel}
                              </span>
                            </div>
                            <span className="font-mono tabular-nums text-[10px] text-zinc-400 mt-0.5">
                              {item.fromTime} – {item.toTime} · vaga disponível
                            </span>
                          </div>

                          <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700/90 text-[11px] font-semibold text-zinc-200 group-hover:border-accent/50 group-hover:bg-accent/15 group-hover:text-accent-light transition-all whitespace-nowrap">
                            + Encaixar
                          </span>
                        </button>
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
                    closingTime={shopClosingTime}
                    busy={busyId === item.appointment.id}
                    onSelect={(appt) => setSelectedAppointmentId(appt.id)}
                  />
                );
              })}

              {/* Marco Visual de Encerramento do Expediente na Base da Timeline (Exclusivo ao Fecho Real ex: 20:30) */}
              {lastTimelineAppointment && hasReachedEndOfShift && (
                <div className="relative flex items-center gap-3 sm:gap-4 pt-1 select-none">
                  <div className="w-14 sm:w-16 shrink-0 flex items-center justify-end pr-2 relative">
                    <span className="absolute -right-[4.5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full bg-accent border border-black ring-2 ring-accent/30 z-10" />
                    <span className="font-mono tabular-nums text-[10px] font-bold text-accent-light leading-none">
                      {lastTimelineAppointment.endTime || shopClosingTime}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="rounded-xl border border-accent/35 bg-gradient-to-r from-[#170609] via-[#0c0a0d] to-[#070709] px-3.5 py-2.5 flex items-center justify-between gap-2 shadow-[0_6px_20px_-6px_rgba(225,29,72,0.22)]">
                      <span className="text-[11px] sm:text-xs font-semibold text-zinc-100 truncate">
                        🏁 Fim do Expediente • Encerrado às{" "}
                        <span className="font-mono tabular-nums text-accent-light font-bold">
                          {lastTimelineAppointment.endTime || shopClosingTime}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold text-accent-light/90 whitespace-nowrap">
                        Turno encerrado
                      </span>
                    </div>
                  </div>
                </div>
              )}
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
        onClick={() => {
          setWalkInInitialTime("");
          setWalkInWindowContext(null);
          setWalkInOpen(true);
        }}
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
        initialDate={date}
        initialTime={walkInInitialTime}
        initialWindow={walkInWindowContext}
      />

      <ClientCyclesSheet
        open={cyclesOpen}
        onClose={() => setCyclesOpen(false)}
        scopeBarberId={scopeBarberId}
      />
    </div>
  );
}
