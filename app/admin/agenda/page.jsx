"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { UserPlus, AlertCircle, RefreshCcw } from "lucide-react";
import { useBarber } from "@/lib/barber-context";
import { useNotifications } from "@/lib/notifications";
import { endSession } from "@/lib/session";
import { todayInShop } from "@/lib/dates";
import { PERMISSION_KEYS } from "@/lib/auth";
import {
  listAppointmentsByDate,
  updateAppointmentStatus,
} from "@/lib/actions/appointments";
import { listTeam } from "@/lib/actions/team";
import DateStepper from "@/components/admin/DateStepper";
import AppointmentCard from "@/components/admin/AppointmentCard";
import PaymentSheet from "@/components/admin/PaymentSheet";
import WalkInSheet from "@/components/admin/WalkInSheet";

export default function AgendaPage() {
  const { can, scopeBarberId, viewedBarber } = useBarber();
  const { notifications } = useNotifications();
  const canViewAll = can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  const [date, setDate] = useState(todayInShop());
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null); // agendamento com ação em andamento
  const [paymentTarget, setPaymentTarget] = useState(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
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

  async function handleChangeStatus(id, status) {
    if (busyId) return;
    if (status === "cancelado" && !window.confirm("Cancelar este agendamento?")) {
      return;
    }

    setBusyId(id);
    setActionError("");

    try {
      const response = await updateAppointmentStatus(id, status);

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (!response?.success) {
        setActionError(response?.error || "Não foi possível atualizar o status.");
        return;
      }

      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status } : a)),
      );
    } catch {
      setActionError("Sem conexão. Não foi possível atualizar o status.");
    } finally {
      setBusyId(null);
    }
  }

  function handleClosePayment() {
    setPaymentTarget(null);
    load({ silent: true });
  }

  function handleCloseWalkIn() {
    setWalkInOpen(false);
    load({ silent: true });
  }

  const isToday = date === todayInShop();

  return (
    <div className="px-4 pt-4 relative">
      <DateStepper value={date} onChange={setDate} />

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
        ) : appointments.length === 0 ? (
          <p className="text-zinc-600 text-sm text-center mt-16">
            Nenhum agendamento para essa data.
          </p>
        ) : (
          <div className="space-y-2.5">
            {appointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                busy={busyId === appointment.id}
                onChangeStatus={handleChangeStatus}
                onOpenPayment={setPaymentTarget}
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
    </div>
  );
}
