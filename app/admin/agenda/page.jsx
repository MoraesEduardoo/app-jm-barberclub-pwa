"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { UserPlus } from "lucide-react";
import { useBarber } from "@/lib/barber-context";
import { endSession } from "@/lib/session";
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AgendaPage() {
  const { can, scopeBarberId, viewedBarber } = useBarber();
  const canViewAll = can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  const [date, setDate] = useState(todayISO());
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
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

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    // scopeBarberId vem do contexto: null = todos (Chefe), id = um profissional.
    const response = await listAppointmentsByDate(date, scopeBarberId);

    // Ignora respostas antigas se o Chefe trocou de profissional entretanto.
    if (requestId !== requestIdRef.current) return;

    if (response?.error === "AUTH_EXPIRED") {
      endSession();
      return;
    }

    setAppointments(response?.data || []);
    setLoading(false);
  }, [date, scopeBarberId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleChangeStatus(id, status) {
    const response = await updateAppointmentStatus(id, status);

        if (response?.error === "AUTH_EXPIRED") {
      endSession();
      return;
    }

    if (response?.success) {
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status } : a)),
      );
    }
  }

  function handleClosePayment() {
    setPaymentTarget(null);
    load();
  }

  function handleCloseWalkIn() {
    setWalkInOpen(false);
    load();
  }

  const isToday = date === todayISO();

  return (
    <div className="px-4 pt-4 relative">
      <DateStepper value={date} onChange={setDate} />

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
          onClick={() => setWalkInOpen(true)}
          className="fixed bottom-24 right-4 z-30 flex items-center gap-2 h-12 pl-4 pr-5 rounded-full bg-accent text-white text-sm font-semibold shadow-accent-glow active:bg-accent-dark"
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