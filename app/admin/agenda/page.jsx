'use client';

import { useEffect, useState, useCallback } from 'react';
import { useBarber } from '@/lib/barber-context';
import { PERMISSION_KEYS } from '@/lib/auth';
import { listAppointmentsByDate, updateAppointmentStatus } from '@/lib/actions/appointments';
import DateStepper from '@/components/admin/DateStepper';
import AppointmentCard from '@/components/admin/AppointmentCard';
import PaymentSheet from '@/components/admin/PaymentSheet';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AgendaPage() {
  const { barber, can } = useBarber();
  const canViewAll = can(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

  const [date, setDate] = useState(todayISO());
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paymentTarget, setPaymentTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const scope = canViewAll ? null : barber.id;
    const data = await listAppointmentsByDate(date, scope);
    setAppointments(data);
    setLoading(false);
  }, [date, canViewAll, barber.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleChangeStatus(id, status) {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    await updateAppointmentStatus(id, status);
  }

  function handleClosePayment() {
    setPaymentTarget(null);
    load();
  }

  return (
    <div className="px-4 pt-4">
      <DateStepper value={date} onChange={setDate} />

      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-[124px] rounded-xl bg-surface animate-pulse" />
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
    </div>
  );
}
