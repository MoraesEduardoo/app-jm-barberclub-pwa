"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { UserPlus, AlertCircle, RefreshCcw, Sparkles, CheckCircle2, XCircle, Clock3 } from "lucide-react";
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
import { listTeam } from "@/lib/actions/team";
import DateStepper from "@/components/admin/DateStepper";
import AppointmentCard from "@/components/admin/AppointmentCard";
import PaymentSheet from "@/components/admin/PaymentSheet";
import AddProductSheet from "@/components/admin/AddProductSheet";
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

export default function AgendaPage() {
  const { can, scopeBarberId, selectedBarberId, selectBarber, viewedBarber } = useBarber();
  const { notifications } = useNotifications();
  const canViewAll = can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  const [date, setDate] = useState(todayInShop());
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [productTarget, setProductTarget] = useState(null);
  const [preScheduleTarget, setPreScheduleTarget] = useState(null);
  const [filterMode, setFilterMode] = useState("all"); // 'all' | 'confirmado' | 'concluido' | 'pre_scheduled'
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [cyclesOpen, setCyclesOpen] = useState(false);
  const [team, setTeam] = useState([]);
  const requestIdRef = useRef(0);

  const refreshTeamList = useCallback(() => {
    if (canViewAll) {
      listTeam()
        .then(setTeam)
        .catch(() => {});
    }
  }, [canViewAll]);

  useEffect(() => {
    refreshTeamList();
  }, [refreshTeamList]);

  /**
   * Busca os agendamentos do dia selecionado.
   * silent = true recarrega sem piscar o skeleton (usado após ações e eventos realtime).
   */
  const load = useCallback(
    async ({ silent = false } = {}) => {
      const requestId = ++requestIdRef.current;
      if (!silent) {
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
          if (!silent) {
            setAppointments([]);
            setLoadError(response.error);
          }
          return;
        }

        setAppointments(response?.data || []);
      } catch {
        if (requestId !== requestIdRef.current) return;
        if (!silent) {
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
    load();
  }, [load]);

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

    // Atualização otimista imediata: se cancelado, já retira da visualização ativa da agenda
    const previousAppointments = appointments;
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a))
    );

    try {
      const response = await updateAppointmentStatus(id, status);

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (!response?.success) {
        setAppointments(previousAppointments);
        const msg = response?.error || "Não foi possível atualizar o status.";
        setActionError(msg);
        toast.error(msg);
        return;
      }

      toast.success(
        status === "confirmado"
          ? "Agendamento confirmado com sucesso!"
          : "Agendamento cancelado e horário liberado na agenda!"
      );
    } catch {
      setAppointments(previousAppointments);
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
    load({ silent: true });
  }

  function handleCloseWalkIn(result) {
    setWalkInOpen(false);
    if (result?.created) {
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
    setAppointments((prev) =>
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
    load({ silent: true });
  }

  async function handleCancelPreScheduled(id, reason) {
    const res = await updateAppointmentStatus(id, "cancelado", { reason });
    if (res?.error) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "cancelado" } : a))
    );
    load({ silent: true });
  }

  const isToday = date === todayInShop();
  const activeAppointments = appointments.filter((a) => {
    const st = (a.status || "confirmado").toLowerCase();
    return st !== "cancelado" && st !== "cancelled";
  });
  const preScheduledCount = activeAppointments.filter(isPreScheduledAppointment).length;

  const displayedAppointments = activeAppointments.filter((a) => {
    if (filterMode === "all") return true;
    if (filterMode === "pre_scheduled") return isPreScheduledAppointment(a);
    const st = (a.status || "confirmado").toLowerCase();
    if (filterMode === "confirmado") {
      return st === "confirmado" || st === "confirmed" || st === "pendente" || st === "pending";
    }
    if (filterMode === "concluido") {
      return st === "concluido" || st === "completed" || a.payment_status === "pago";
    }
    return true;
  });

  return (
    <div className="px-4 pt-4 relative">
      {/* Assistente de Primeiro Acesso / Bootstrap quando o banco está limpo */}
      <SystemBootstrapCard
        onBootstrapChange={() => {
          refreshTeamList();
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
            👥 Toda a equipe
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
                {m.role === "admin" && <span className="text-[10px]">👑</span>}
                {m.role === "manager" && <span className="text-[10px]">👔</span>}
              </button>
            );
          })}
        </div>
      )}

      <DateStepper value={date} onChange={setDate} />

      {/* Dashboard Dinâmico de Performance & Ocupação */}
      <div className="mt-3">
        <AgendaDashboardWidget appointments={appointments} isToday={isToday} />
      </div>

      {/* Filtros de Status da Agenda + Atalho de Lembretes de Retorno */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar select-none">
          {STATUS_FILTERS.map((f) => {
            const active = filterMode === f.key;
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
                {f.label}
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
              🔄
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

      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-[124px] rounded-xl bg-surface animate-pulse"
              />
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
          <div className="space-y-2.5">
            {displayedAppointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                busy={busyId === appointment.id}
                onChangeStatus={handleChangeStatus}
                onOpenPayment={setPaymentTarget}
                onAddProduct={setProductTarget}
                onProductRemoved={() => load({ silent: true })}
                onOpenPreSchedule={setPreScheduleTarget}
              />
            ))}
          </div>
        )}
      </div>

      <PaymentSheet
        open={Boolean(paymentTarget)}
        onClose={handleClosePayment}
        appointment={paymentTarget}
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
            setAppointments((prev) =>
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
