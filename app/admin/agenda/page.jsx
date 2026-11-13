"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  UserPlus,
  AlertCircle,
  RefreshCcw,
  Sparkles,
  Clock,
  GripVertical,
  ArrowDownToLine,
} from "lucide-react";
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
  completeAppointmentFiado,
  moveAppointmentTime,
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
import MoveAppointmentSheet from "@/components/admin/MoveAppointmentSheet";
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
 * Monta o rótulo limpo exibido na faixa de intervalo livre
 * (sem contagem de duração acumulada, destacando o intervalo real de horário)
 */
function formatFluidGapLabel() {
  return "⏱️ Intervalo livre";
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
function buildTimelineItems(
  appointmentsList,
  { openingTime = "09:00", closingTime = "20:30", includeTrailingGap = true } = {}
) {
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
  const openMin = timeStrToMinutes(openingTime) ?? 9 * 60;
  let prevEndMin = includeTrailingGap ? openMin : null;
  let prevBarberId = null;

  sorted.forEach((appt, idx) => {
    const startStr = getAppointmentStartTime(appt);
    const startMin = timeStrToMinutes(startStr);
    const durationMin = getAppointmentDuration(appt);
    const endStr = getAppointmentEndTime(appt, startStr, durationMin);
    const endMin = timeStrToMinutes(endStr);
    const currentBarberId = appt.barbers?.id || appt.barber_id || null;

    // Qualquer janela livre >= 10 min (desde a abertura ou entre atendimentos) vira Zona de Drop na timeline
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
        fromMin: prevEndMin,
        toMin: startMin,
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

  // Se o último atendimento terminar antes do fecho do expediente (>= 10 min livres),
  // exibe a janela livre final de 10 em 10 min até o horário de fecho
  const closeMin = timeStrToMinutes(closingTime);
  if (
    includeTrailingGap &&
    prevEndMin !== null &&
    closeMin !== null &&
    closeMin - prevEndMin >= 10
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
      fromMin: prevEndMin,
      toMin: closeMin,
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
  const [productModalMode, setProductModalMode] = useState("produto"); // 'produto' | 'conveniencia'
  const [editServiceTarget, setEditServiceTarget] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null);
  const [preScheduleTarget, setPreScheduleTarget] = useState(null);
  const [filterMode, setFilterMode] = useState("all"); // 'all' | 'confirmado' | 'concluido' | 'pre_scheduled'
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [cyclesOpen, setCyclesOpen] = useState(false);
  const [dragState, setDragState] = useState(null);
  const dragStateRef = useRef(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setActiveTab("agenda");

    const openFromNavbar = () => {
      setWalkInOpen(true);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("jm:open-walkin", openFromNavbar);
      if (window.__jmOpenWalkInOnMount) {
        window.__jmOpenWalkInOnMount = false;
        openFromNavbar();
      }
    }

    return () => {
      mountedRef.current = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("jm:open-walkin", openFromNavbar);
      }
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

  function handleClosePayment(paymentResult) {
    const targetId = paymentTarget?.id;
    setPaymentTarget(null);

    if (paymentResult?.success && targetId) {
      syncAppointmentsState((prev) =>
        prev.map((a) =>
          a.id === targetId
            ? {
                ...a,
                status: "concluido",
                payment_status: "pago",
                payment_method: paymentResult.payment_method || a.payment_method,
                price: paymentResult.price ?? a.price,
                total_price: paymentResult.total_price ?? a.total_price,
                duration_minutes: paymentResult.duration_minutes ?? a.duration_minutes,
                end_time: paymentResult.end_time
                  ? `${String(paymentResult.end_time).slice(0, 5)}:00`
                  : a.end_time,
              }
            : a
        )
      );
      invalidateCache("appointments:");
      toast.success(
        paymentResult.wasEarly
          ? `Pagamento registrado! Agenda liberada a partir das ${paymentResult.end_time} (de 10 em 10 min).`
          : "Atendimento finalizado e pagamento registrado com sucesso!"
      );
    }

    invalidateCache("finance:");
    invalidateCache("clients:");
    load({ silent: true });
  }

  async function handleCompleteFiado(appt) {
    if (!appt?.id || busyId) return;
    const id = appt.id;
    setBusyId(id);
    setActionError("");

    const previousAppointments = appointments;
    syncAppointmentsState((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status: "concluido",
              payment_status: "pendente",
              payment_method: "fiado",
            }
          : a
      )
    );

    try {
      const res = await completeAppointmentFiado(id);
      if (res?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (!res?.success) {
        syncAppointmentsState(previousAppointments);
        const msg = res?.error || "Não foi possível dar baixa no Fiado.";
        setActionError(msg);
        toast.error(msg);
        return;
      }

      syncAppointmentsState((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                status: "concluido",
                payment_status: "pendente",
                payment_method: "fiado",
                duration_minutes: res.duration_minutes ?? a.duration_minutes,
                end_time: res.end_time
                  ? `${String(res.end_time).slice(0, 5)}:00`
                  : a.end_time,
              }
            : a
        )
      );

      invalidateCache("appointments:");
      invalidateCache("finance:");
      invalidateCache("clients:");

      toast.success(
        res.wasEarly
          ? `Baixa no Fiado concluída! Horários livres a partir das ${res.end_time} (de 10 em 10 min).`
          : "Baixa no Fiado registrada! Enviado para Contas a Receber e agenda liberada."
      );
      load({ silent: true });
    } catch {
      syncAppointmentsState(previousAppointments);
      toast.error("Sem conexão. Não foi possível registar baixa no Fiado.");
    } finally {
      setBusyId(null);
    }
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

  /**
   * Valida se um atendimento (`dragAppt`, duração `durationMin`) pode ser posicionado em `candidateStartMin`
   * sem ultrapassar o fim do expediente (`shopClosingTime`) e sem colidir com outros agendamentos ativos.
   */
  const validateDropSlot = useCallback(
    (dragAppt, candidateStartMin, durationMin) => {
      const openMin = shopClosingTime === "12:30" ? 8 * 60 : 9 * 60;
      const closeMin = timeStrToMinutes(shopClosingTime) ?? 20 * 60 + 30;
      const endMin = candidateStartMin + durationMin;

      if (candidateStartMin < openMin) {
        return {
          valid: false,
          reason: "Horário anterior à abertura do expediente.",
        };
      }
      if (endMin > closeMin) {
        return {
          valid: false,
          reason: `Ultrapassa o fim do expediente (${shopClosingTime}).`,
        };
      }

      const targetBarberId = dragAppt.barbers?.id || dragAppt.barber_id || null;
      for (const other of activeAppointments) {
        if (!other || String(other.id) === String(dragAppt.id)) continue;
        if (targetBarberId) {
          const otherBarberId = other.barbers?.id || other.barber_id || null;
          if (otherBarberId && String(otherBarberId) !== String(targetBarberId)) continue;
        }
        const oStart = timeStrToMinutes(getAppointmentStartTime(other));
        const oDur = getAppointmentDuration(other);
        const oEnd = timeStrToMinutes(getAppointmentEndTime(other, getAppointmentStartTime(other), oDur));
        if (oStart === null || oEnd === null) continue;

        if (candidateStartMin < oEnd && endMin > oStart) {
          return {
            valid: false,
            reason: `Conflito com ${other.client_name || "outro atendimento"} (${minutesToTimeStr(
              oStart
            )} – ${minutesToTimeStr(oEnd)}).`,
          };
        }
      }

      return { valid: true, reason: null };
    },
    [activeAppointments, shopClosingTime]
  );

  /**
   * Calcula o slot de 10 em 10 minutos para uma Zona de Drop ("Intervalo livre"),
   * levando em conta se o atendimento arrastado é adjacente ao próprio intervalo.
   */
  const resolveGapDropEvaluation = useCallback(
    (gapItem, dragAppt, durationMin, clientY = null, rect = null) => {
      if (!gapItem || !dragAppt) return { valid: false };

      const apptStartMin = timeStrToMinutes(getAppointmentStartTime(dragAppt));
      const apptEndMin =
        apptStartMin !== null ? apptStartMin + getAppointmentDuration(dragAppt) : null;

      // Se o intervalo livre é imediatamente adjacente ao próprio agendamento arrastado,
      // a faixa útil disponível une o espaço do próprio card + o intervalo livre
      let effectiveFromMin = gapItem.fromMin ?? timeStrToMinutes(gapItem.fromTime) ?? 540;
      let effectiveToMin = gapItem.toMin ?? timeStrToMinutes(gapItem.toTime) ?? 1230;

      if (apptEndMin !== null && Math.abs(apptEndMin - effectiveFromMin) <= 1) {
        effectiveFromMin = Math.min(effectiveFromMin, apptStartMin);
      }
      if (apptStartMin !== null && Math.abs(apptStartMin - effectiveToMin) <= 1) {
        effectiveToMin = Math.max(effectiveToMin, apptEndMin);
      }

      const availableSpan = effectiveToMin - effectiveFromMin;
      if (availableSpan < durationMin) {
        return {
          valid: false,
          snapStartTime: gapItem.fromTime,
          snapEndTime: minutesToTimeStr((gapItem.fromMin ?? 540) + durationMin),
          reason: `Intervalo livre (${gapItem.durationLabel}) menor que ${durationMin} min.`,
        };
      }

      // Gera todos os pontos de início (de 10 em 10 min) dentro deste intervalo que são 100% válidos
      const validCandidates = [];
      for (
        let slotMin = effectiveFromMin;
        slotMin + durationMin <= effectiveToMin;
        slotMin += 10
      ) {
        if (slotMin === apptStartMin) continue;
        const check = validateDropSlot(dragAppt, slotMin, durationMin);
        if (check.valid) {
          validCandidates.push(slotMin);
        }
      }

      if (validCandidates.length === 0) {
        const fallbackCheck = validateDropSlot(dragAppt, effectiveFromMin, durationMin);
        return {
          valid: false,
          snapStartTime: minutesToTimeStr(effectiveFromMin),
          snapEndTime: minutesToTimeStr(effectiveFromMin + durationMin),
          reason: fallbackCheck.reason || "Sem horário compatível neste intervalo.",
        };
      }

      let chosenMin = validCandidates[0];
      if (clientY !== null && rect && rect.height > 0 && validCandidates.length > 1) {
        const ratio = Math.max(0, Math.min(0.999, (clientY - rect.top) / rect.height));
        const idx = Math.min(
          validCandidates.length - 1,
          Math.floor(ratio * validCandidates.length)
        );
        chosenMin = validCandidates[idx];
      }

      return {
        valid: true,
        snapStartMin: chosenMin,
        snapStartTime: minutesToTimeStr(chosenMin),
        snapEndTime: minutesToTimeStr(chosenMin + durationMin),
        reason: null,
      };
    },
    [validateDropSlot]
  );

  /**
   * Inicia o arraste (Drag-and-Drop) exclusivamente a partir da alça `GripVertical`.
   */
  const handleDragHandlePointerDown = useCallback(
    (e, appt) => {
      if (!appt || busyId) return;
      e.preventDefault();
      e.stopPropagation();

      if (filterMode !== "all") {
        setFilterMode("all");
      }

      const durationMin = getAppointmentDuration(appt);
      const startStr = getAppointmentStartTime(appt);
      const endStr = getAppointmentEndTime(appt, startStr, durationMin);

      const initialDrag = {
        appointment: appt,
        durationMin,
        origStartTime: startStr,
        origEndTime: endStr,
        pointerX: e.clientX,
        pointerY: e.clientY,
        hoveredGapKey: null,
        snapStartTime: null,
        snapEndTime: null,
        isValidDrop: false,
        invalidReason: null,
      };

      dragStateRef.current = initialDrag;
      setDragState(initialDrag);
    },
    [busyId, filterMode]
  );

  useEffect(() => {
    if (!dragState?.appointment) return;

    const currentAppt = dragState.appointment;
    const durationMin = dragState.durationMin;

    function handlePointerMove(e) {
      if (!dragStateRef.current) return;

      // Auto-scroll suave nas extremidades do ecrã do telemóvel durante o arraste
      const viewportH = window.innerHeight || 800;
      if (e.clientY < 88) {
        window.scrollBy({ top: -10, behavior: "auto" });
      } else if (e.clientY > viewportH - 96) {
        window.scrollBy({ top: 10, behavior: "auto" });
      }

      const dropNodes = document.querySelectorAll("[data-drop-gap-key]");
      let matchedGapKey = null;
      let matchedEval = null;

      dropNodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (e.clientY >= rect.top - 6 && e.clientY <= rect.bottom + 6) {
          const key = node.getAttribute("data-drop-gap-key");
          const gapItem = timelineItems.find((it) => it.type === "gap" && it.key === key);
          if (gapItem) {
            matchedGapKey = key;
            matchedEval = resolveGapDropEvaluation(
              gapItem,
              currentAppt,
              durationMin,
              e.clientY,
              rect
            );
          }
        }
      });

      const nextState = {
        ...dragStateRef.current,
        pointerX: e.clientX,
        pointerY: e.clientY,
        hoveredGapKey: matchedGapKey,
        snapStartTime: matchedEval?.snapStartTime || null,
        snapEndTime: matchedEval?.snapEndTime || null,
        isValidDrop: Boolean(matchedEval?.valid),
        invalidReason: matchedEval?.reason || null,
      };

      dragStateRef.current = nextState;
      setDragState(nextState);
    }

    async function handlePointerUp() {
      const finalDrag = dragStateRef.current;
      dragStateRef.current = null;
      setDragState(null);

      if (!finalDrag?.hoveredGapKey) return;

      if (!finalDrag.isValidDrop || !finalDrag.snapStartTime) {
        if (finalDrag.invalidReason) {
          toast.warning(finalDrag.invalidReason);
        }
        return;
      }

      const newStart = finalDrag.snapStartTime;
      const newEnd = finalDrag.snapEndTime;
      const apptId = finalDrag.appointment.id;
      const formattedStart = `${newStart}:00`;
      const formattedEnd = `${newEnd}:00`;

      // Snap otimista instantâneo na timeline
      const previousAppointments = appointments;
      setBusyId(apptId);

      syncAppointmentsState((prev) => {
        const updated = prev.map((a) =>
          a.id === apptId
            ? {
                ...a,
                appointment_time: formattedStart,
                start_time: formattedStart,
                end_time: formattedEnd,
                duration_minutes: durationMin,
              }
            : a
        );
        return [...updated].sort((x, y) => {
          const tx = String(x.appointment_time || "99:99").slice(0, 5);
          const ty = String(y.appointment_time || "99:99").slice(0, 5);
          return tx.localeCompare(ty);
        });
      });

      try {
        const res = await moveAppointmentTime({
          appointmentId: apptId,
          newStartTime: newStart,
        });

        if (res?.error === "AUTH_EXPIRED") {
          endSession();
          return;
        }

        if (!res?.success) {
          syncAppointmentsState(previousAppointments);
          const msg = res?.error || "Não foi possível mover o atendimento.";
          toast.error(msg);
          return;
        }

        invalidateCache("appointments:");
        invalidateCache("finance:");
        toast.success(`Atendimento reposicionado para ${res.startTime} – ${res.endTime}!`);
        load({ silent: true });
      } catch {
        syncAppointmentsState(previousAppointments);
        toast.error("Sem conexão ao salvar o novo horário.");
      } finally {
        setBusyId(null);
      }
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    dragState?.appointment,
    dragState?.durationMin,
    timelineItems,
    resolveGapDropEvaluation,
    appointments,
    syncAppointmentsState,
    load,
  ]);

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

      {/* Visualização em Linha do Tempo Vertical em Blocos (v2.8.2) */}
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
                  ? `Todos os horários (${shopClosingTime === "12:30" ? "08:00 às 12:30" : "09:00 às 20:30"}) estão disponíveis na agenda.`
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
                  setWalkInOpen(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-accent/15 border border-accent/40 text-xs text-accent-light hover:bg-accent/25 font-bold transition-all"
              >
                <UserPlus size={14} />
                + Novo atendimento
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
              <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                <GripVertical size={11} className="text-emerald-400" />
                <span>Segure na alça para arrastar ou toque em Mover</span>
              </span>
            </div>

            {/* Pílula Flutuante de Feedback Durante o Arraste (Mobile Drag HUD) */}
            {dragState?.appointment && (
              <div className="sticky top-14 z-30 mb-3 rounded-2xl border border-emerald-400/60 bg-zinc-950/95 backdrop-blur-md px-3.5 py-2.5 shadow-[0_8px_30px_rgba(16,185,129,0.22)] flex items-center justify-between gap-2 animate-in fade-in">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">
                      Movendo: {dragState.appointment.client_name || "Cliente"} (
                      {dragState.durationMin} min)
                    </p>
                    <p className="text-[11px] text-emerald-300 truncate">
                      {dragState.hoveredGapKey
                        ? dragState.isValidDrop
                          ? `Solte para fixar às ${dragState.snapStartTime} – ${dragState.snapEndTime}`
                          : dragState.invalidReason || "Intervalo incompatível"
                        : "Arraste até um Intervalo livre destacado em verde"}
                    </p>
                  </div>
                </div>
                {dragState.isValidDrop && dragState.snapStartTime && (
                  <span className="shrink-0 font-mono tabular-nums text-xs font-extrabold text-black bg-emerald-400 px-2.5 py-1 rounded-lg">
                    {dragState.snapStartTime} – {dragState.snapEndTime}
                  </span>
                )}
              </div>
            )}

            <div className="relative space-y-1">
              {timelineItems.map((item, index) => {
                if (item.type === "gap") {
                  const isDraggingAny = Boolean(dragState?.appointment);
                  const isHoveredGap =
                    isDraggingAny && dragState?.hoveredGapKey === item.key;

                  const gapEval = isDraggingAny
                    ? resolveGapDropEvaluation(
                        item,
                        dragState.appointment,
                        dragState.durationMin
                      )
                    : null;
                  const canDropInGap = Boolean(gapEval?.valid);

                  const gapMinHeight = Math.max(
                    isDraggingAny ? 64 : 44,
                    Math.min(112, Math.round(item.gapMinutes * 0.65 + (isDraggingAny ? 34 : 24)))
                  );

                  let dropZoneClasses =
                    "border-dashed border-zinc-800/85 bg-[#07070a]/75";
                  if (isDraggingAny) {
                    if (isHoveredGap && canDropInGap) {
                      dropZoneClasses =
                        "border-2 border-dashed border-emerald-300 bg-emerald-500/20 shadow-[0_0_25px_rgba(16,185,129,0.28)] scale-[1.01]";
                    } else if (canDropInGap) {
                      dropZoneClasses =
                        "border-2 border-dashed border-emerald-500/80 bg-emerald-950/30 shadow-[0_0_16px_rgba(16,185,129,0.14)]";
                    } else {
                      dropZoneClasses =
                        "border border-dashed border-rose-500/35 bg-rose-950/15 opacity-70";
                    }
                  }

                  return (
                    <div
                      key={item.key}
                      data-drop-gap-key={item.key}
                      className="relative flex items-stretch gap-3 sm:gap-4 select-none"
                    >
                      {/* Coluna Esquerda: Eixo Cronológico do Período Livre */}
                      <div className="w-14 sm:w-16 shrink-0 flex flex-col justify-between items-end pr-3 py-2 relative">
                        <div
                          className={`absolute right-0 top-0 bottom-0 w-px border-r border-dashed ${
                            isDraggingAny && canDropInGap
                              ? "border-emerald-400/80"
                              : "border-zinc-800/85"
                          }`}
                        />
                        <span
                          className={`absolute -right-[3.5px] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full border z-10 ${
                            isDraggingAny && canDropInGap
                              ? "border-emerald-300 bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                              : "border-zinc-600 bg-oled"
                          }`}
                        />

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

                      {/* Coluna Direita: Faixa de Intervalo Livre & Drop Zone Interativa */}
                      <div className="flex-1 min-w-0 py-1.5">
                        <div
                          style={{ minHeight: `${gapMinHeight}px` }}
                          className={`w-full rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 transition-all duration-150 ${dropZoneClasses}`}
                        >
                          <div className="flex flex-col justify-center min-w-0">
                            <span
                              className={`text-[10px] font-semibold truncate ${
                                isDraggingAny && canDropInGap
                                  ? "text-emerald-300"
                                  : isDraggingAny && !canDropInGap
                                  ? "text-rose-300"
                                  : "text-zinc-400"
                              }`}
                            >
                              {isDraggingAny
                                ? canDropInGap
                                  ? isHoveredGap
                                    ? "✨ Solte aqui para reposicionar o atendimento"
                                    : "⬇ Zona disponível para soltar atendimento"
                                  : gapEval?.reason || "Intervalo insuficiente"
                                : item.fluidLabel}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5 min-w-0">
                              <span
                                className={`font-mono tabular-nums text-xs font-bold ${
                                  isDraggingAny && canDropInGap
                                    ? "text-white"
                                    : "text-zinc-300"
                                }`}
                              >
                                {item.fromTime} – {item.toTime}
                              </span>
                              <span className="text-[10px] text-zinc-400 truncate">
                                · {item.durationLabel} livre
                              </span>
                            </div>
                          </div>

                          {isDraggingAny && canDropInGap && (
                            <span
                              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-mono tabular-nums text-[11px] font-bold transition-all ${
                                isHoveredGap
                                  ? "bg-emerald-400 text-black shadow-md"
                                  : "bg-emerald-500/20 border border-emerald-400/50 text-emerald-200"
                              }`}
                            >
                              <ArrowDownToLine size={12} />
                              <span>
                                {isHoveredGap && dragState?.snapStartTime
                                  ? `${dragState.snapStartTime} – ${dragState.snapEndTime}`
                                  : `${gapEval.snapStartTime} – ${gapEval.snapEndTime}`}
                              </span>
                            </span>
                          )}
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
                    closingTime={shopClosingTime}
                    busy={busyId === item.appointment.id}
                    isDragging={dragState?.appointment?.id === item.appointment.id}
                    onSelect={(appt) => setSelectedAppointmentId(appt.id)}
                    onMove={(appt) => setMoveTarget(appt)}
                    onDragHandlePointerDown={handleDragHandlePointerDown}
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
        onCompleteFiado={handleCompleteFiado}
        onAddProduct={(appt) => {
          setProductModalMode("produto");
          setProductTarget(appt);
        }}
        onAddConvenience={(appt) => {
          setProductModalMode("conveniencia");
          setProductTarget(appt);
        }}
        onEditService={setEditServiceTarget}
        onMoveAppointment={setMoveTarget}
        onOpenPreSchedule={setPreScheduleTarget}
        onProductRemoved={() => {
          invalidateCache(cacheKeys.products());
          invalidateCache("finance:");
          load({ silent: true });
        }}
      />

      <MoveAppointmentSheet
        open={Boolean(moveTarget)}
        onClose={() => setMoveTarget(null)}
        appointment={moveTarget}
        existingAppointments={appointments}
        closingTime={shopClosingTime}
        onMoved={(res) => {
          if (moveTarget?.id && res?.startTime) {
            const formattedStart = `${String(res.startTime).slice(0, 5)}:00`;
            const formattedEnd = res.endTime
              ? `${String(res.endTime).slice(0, 5)}:00`
              : moveTarget.end_time;

            syncAppointmentsState((prev) => {
              const updated = prev.map((a) =>
                a.id === moveTarget.id
                  ? {
                      ...a,
                      appointment_time: formattedStart,
                      start_time: formattedStart,
                      end_time: formattedEnd,
                      duration_minutes: res.durationMinutes ?? a.duration_minutes,
                    }
                  : a
              );
              return [...updated].sort((x, y) => {
                const tx = String(x.appointment_time || "99:99").slice(0, 5);
                const ty = String(y.appointment_time || "99:99").slice(0, 5);
                return tx.localeCompare(ty);
              });
            });
          }
          invalidateCache("appointments:");
          toast.success(
            res?.startTime && res?.endTime
              ? `Atendimento movido para ${res.startTime} – ${res.endTime}!`
              : "Horário do atendimento atualizado!"
          );
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
          toast.success("Dados do atendimento e cliente atualizados com sucesso!");
          if (editServiceTarget?.id) {
            syncAppointmentsState((prev) =>
              prev.map((a) =>
                a.id === editServiceTarget.id
                  ? {
                      ...a,
                      client_id: res?.clientId ?? a.client_id,
                      client_name: res?.clientName || a.client_name,
                      client_phone:
                        res?.clientPhone !== undefined ? res.clientPhone : a.client_phone,
                      service_id: res?.serviceId || a.service_id,
                      service_ids: res?.serviceIds || a.service_ids,
                      service: res?.serviceName || a.service,
                      duration_minutes: res?.durationMinutes ?? a.duration_minutes,
                      end_time: res?.endTime
                        ? `${String(res.endTime).slice(0, 5)}:00`
                        : a.end_time,
                      price: res?.newTotal ?? a.price,
                      total_price: res?.newTotal ?? a.total_price,
                      services: {
                        ...(a.services || {}),
                        id: res?.serviceId || a.services?.id,
                        name: res?.serviceName || a.services?.name,
                        price: res?.servicePrice ?? a.services?.price,
                        duration_minutes: res?.durationMinutes ?? a.services?.duration_minutes,
                        default_duration_minutes:
                          res?.durationMinutes ?? a.services?.default_duration_minutes,
                      },
                    }
                  : a
              )
            );
          }
          invalidateCache("finance:");
          invalidateCache("clients:");
          load({ silent: true });
        }}
      />

      <AddProductSheet
        open={Boolean(productTarget)}
        onClose={() => setProductTarget(null)}
        appointment={productTarget}
        mode={productModalMode}
        onAdded={(res) => {
          const count = res?.addedItems?.length || 1;
          const isConv = productModalMode === "conveniencia";
          toast.success(
            isConv
              ? count > 1
                ? `${count} itens de conveniência adicionados à conta do cliente!`
                : "Item de conveniência adicionado à conta do cliente!"
              : count > 1
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

      <WalkInSheet
        open={walkInOpen}
        onClose={handleCloseWalkIn}
        barber={viewedBarber}
        team={team}
        canPickBarber={canViewAll}
        existingAppointments={appointments}
        initialDate={date}
      />

      <ClientCyclesSheet
        open={cyclesOpen}
        onClose={() => setCyclesOpen(false)}
        scopeBarberId={scopeBarberId}
      />
    </div>
  );
}
