"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { UserPlus, AlertCircle, RefreshCcw, Clock, Sparkles } from "lucide-react";
import { useBarber } from "@/lib/barber-context";
import { useNotifications } from "@/lib/notifications";
import { endSession } from "@/lib/session";
import { todayInShop } from "@/lib/dates";
import { PERMISSION_KEYS } from "@/lib/auth";
import {
  listAppointmentsByDate,
  updateAppointmentStatus,
  deleteAppointment,
  confirmAppointment,
  rescheduleAppointment,
} from "@/lib/actions/appointments";
import { listTeam } from "@/lib/actions/team";
import DateStepper from "@/components/admin/DateStepper";
import AppointmentCard from "@/components/admin/AppointmentCard";
import PaymentSheet from "@/components/admin/PaymentSheet";
import WalkInSheet from "@/components/admin/WalkInSheet";
import WaitlistSheet from "@/components/admin/WaitlistSheet";
import ClientCyclesSheet from "@/components/admin/ClientCyclesSheet";
import PreScheduleSheet from "@/components/admin/PreScheduleSheet";
import AgendaDashboardWidget from "@/components/admin/AgendaDashboardWidget";
import { isPreScheduledAppointment } from "@/lib/pre-scheduled";
import { toast } from "@/lib/toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";

export default function AgendaPage() {
  const { can, scopeBarberId, selectedBarberId, selectBarber, isLeadership, viewedBarber } = useBarber();
  const { notifications } = useNotifications();
  const canViewAll = can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  const [date, setDate] = useState(todayInShop());
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null); // agendamento com ação em andamento
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [preScheduleTarget, setPreScheduleTarget] = useState(null);
  const [filterMode, setFilterMode] = useState("all"); // 'all' | 'pre_scheduled'
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [cyclesOpen, setCyclesOpen] = useState(false);
  const [team, setTeam] = useState([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (canViewAll) {
      listTeam()
        .then(setTeam)
        .catch(() => {});
    }
  }, [canViewAll]);

  /**
   * Busca os agendamentos do dia selecionado.
   * silent = true recarrega sem piscar o skeleton (usado após ações e eventos realtime).
   * O servidor decide o escopo real; scopeBarberId: null = todos (Chefe), id = um profissional.
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

        // Descarta resposta velha (troca rápida de dia ou de profissional).
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
    [date, scopeBarberId],
  );

  // Clicou em outro dia (ou semana/profissional mudou) -> busca imediata.
  useEffect(() => {
    load();
  }, [load]);

  // Evento realtime (novo agendamento, confirmação, cancelamento) -> atualiza o dia aberto.
  const loadRef = useRef(load);
  loadRef.current = load;
  const latestNotificationId = notifications[0]?.id;
  useEffect(() => {
    if (latestNotificationId) loadRef.current({ silent: true });
  }, [latestNotificationId]);

  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  async function executeStatusChange(id, status) {
    setBusyId(id);
    setActionError("");

    try {
      const response = await updateAppointmentStatus(id, status);

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (!response?.success) {
        const msg = response?.error || "Não foi possível atualizar o status.";
        setActionError(msg);
        toast.error(msg);
        return;
      }

      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status } : a)),
      );
      toast.success(
        status === "confirmado"
          ? "Agendamento confirmado com sucesso!"
          : "Agendamento cancelado. Vaga liberada na agenda!"
      );
    } catch {
      const msg = "Sem conexão. Não foi possível atualizar o status.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  function handleChangeStatus(id, status) {
    if (busyId) return;
    if (status === "cancelado") {
      setConfirmCancelId(id);
      return;
    }
    executeStatusChange(id, status);
  }

  async function executeDeleteAppointment(id) {
    setBusyId(id);
    setActionError("");

    try {
      const response = await deleteAppointment(id);

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (!response?.success) {
        const msg = response?.error || "Não foi possível excluir o agendamento.";
        setActionError(msg);
        toast.error(msg);
        return;
      }

      setAppointments((prev) => prev.filter((a) => a.id !== id));
      toast.success("Agendamento excluído do histórico.");
    } catch {
      const msg = "Sem conexão. Não foi possível excluir o agendamento.";
      setActionError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  function handleDeleteAppointment(id) {
    if (busyId) return;
    setConfirmDeleteId(id);
  }

  function handleClosePayment() {
    setPaymentTarget(null);
    load({ silent: true });
  }

  function handleCloseWalkIn() {
    setWalkInOpen(false);
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
  const preScheduledCount = appointments.filter(isPreScheduledAppointment).length;
  const displayedAppointments =
    filterMode === "pre_scheduled"
      ? appointments.filter(isPreScheduledAppointment)
      : appointments;

  return (
    <div className="px-4 pt-4 relative">
      {/* Seletor Rápido de Equipe para Liderança (Chefe e Gerente) */}
      {canViewAll && team.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-1 no-scrollbar select-none">
          <button
            type="button"
            onClick={() => selectBarber(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all touch-manipulation ${
              !selectedBarberId
                ? 'bg-accent text-black shadow-sm ring-1 ring-accent'
                : 'bg-surface border border-zinc-800 text-zinc-400 hover:text-white'
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
                    ? 'bg-accent text-black shadow-sm ring-1 ring-accent'
                    : 'bg-surface border border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                <span>{m.name.split(' ')[0]}</span>
                {m.role === 'admin' && <span className="text-[10px]">👑</span>}
                {m.role === 'manager' && <span className="text-[10px]">👔</span>}
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

      {/* Ações de Gestão de Fluxo: Lista de Espera & Ciclos de Retorno */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setWaitlistOpen(true)}
          className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-surface border border-zinc-800 text-xs font-semibold text-white active:scale-95 active:bg-elevated transition-all touch-manipulation select-none"
        >
          <Clock size={14} className="text-accent" />
          Fila de espera
        </button>

        <button
          type="button"
          onClick={() => setCyclesOpen(true)}
          className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-surface border border-zinc-800 text-xs font-semibold text-white active:scale-95 active:bg-elevated transition-all touch-manipulation select-none"
        >
          <Sparkles size={14} className="text-emerald-400" />
          Lembretes (Retorno)
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
          <div className="text-center py-16 space-y-2">
            <p className="text-zinc-500 text-sm">
              {filterMode === "pre_scheduled"
                ? "Nenhum pré-agendamento para esta data."
                : "Nenhum agendamento para essa data."}
            </p>
            {filterMode === "pre_scheduled" && (
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className="text-xs text-purple-400 hover:underline font-semibold"
              >
                Voltar a ver todos os agendamentos
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
                onDelete={handleDeleteAppointment}
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

      <PreScheduleSheet
        open={Boolean(preScheduleTarget)}
        onClose={() => setPreScheduleTarget(null)}
        appointment={preScheduleTarget}
        team={team}
        onConfirm={handleConfirmPreScheduled}
        onReschedule={handleReschedulePreScheduled}
        onCancel={handleCancelPreScheduled}
      />

      {isToday && (
        <button
          type="button"
          onClick={() => setWalkInOpen(true)}
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+72px)] right-4 z-30 flex items-center gap-2 h-12 pl-4 pr-5 rounded-full bg-accent text-white text-sm font-semibold shadow-accent-glow active:scale-95 active:bg-accent-dark transition-all touch-manipulation select-none"
        >
          <UserPlus size={18} />
          Sem hora
        </button>
      )}

      <WalkInSheet
        open={walkInOpen}
        onClose={handleCloseWalkIn}
        barber={viewedBarber}
        team={team}
        canPickBarber={canViewAll}
        existingAppointments={appointments}
      />

      <WaitlistSheet
        open={waitlistOpen}
        onClose={() => {
          setWaitlistOpen(false);
          load({ silent: true });
        }}
        date={date}
        barber={viewedBarber}
        team={team}
        canPickBarber={canViewAll}
      />

      <ClientCyclesSheet
        open={cyclesOpen}
        onClose={() => setCyclesOpen(false)}
        scopeBarberId={scopeBarberId}
      />

      {/* Modal In-App: Confirmação de Cancelamento de Agendamento */}
      <ConfirmDialog
        open={Boolean(confirmCancelId)}
        title="Cancelar agendamento?"
        description="Tem certeza que deseja cancelar este agendamento? O horário ficará imediatamente livre na agenda para novos clientes."
        confirmLabel="Cancelar Agendamento"
        cancelLabel="Voltar"
        variant="warning"
        loading={Boolean(busyId)}
        onConfirm={async () => {
          const id = confirmCancelId;
          setConfirmCancelId(null);
          await executeStatusChange(id, "cancelado");
        }}
        onCancel={() => setConfirmCancelId(null)}
      />

      {/* Modal In-App: Confirmação de Exclusão Definitiva */}
      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        title="Excluir agendamento?"
        description="Esta ação removerá este agendamento definitivamente do histórico da barbearia. Não será possível recuperá-lo."
        confirmLabel="Excluir Definitivamente"
        cancelLabel="Cancelar"
        variant="danger"
        loading={Boolean(busyId)}
        onConfirm={async () => {
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          await executeDeleteAppointment(id);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
