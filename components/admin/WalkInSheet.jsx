'use client';

import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './BottomSheet';
import { FormField, TextInput, PrimaryButton } from './FormField';
import { listServices } from '@/lib/actions/services';
import { listSchedule } from '@/lib/actions/schedule';
import { createWalkInAppointment } from '@/lib/actions/appointments';
import { dayOfWeekFromDate } from '@/lib/constants/schedule';
import { generateAvailableSlots, roundUpToNextSlot } from '@/lib/slots';

/**
 * Formulário rápido pra registrar na hora o cliente que chegou sem
 * agendamento prévio. Por padrão encaixa "agora"; o barbeiro só precisa
 * escolher um horário manual se quiser encaixar o walk-in um pouco mais
 * pra frente (ex.: "só daqui 20 minutos que eu termino o atual").
 */
export default function WalkInSheet({ open, onClose, barber, team, canPickBarber, existingAppointments }) {
  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState('');
  const [barberId, setBarberId] = useState(barber.id);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [useNow, setUseNow] = useState(true);
  const [manualTime, setManualTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      listServices().then((data) => setServices(data.filter((s) => s.active)));
      setBarberId(barber.id);
      setClientName('');
      setClientPhone('');
      setUseNow(true);
      setManualTime('');
      setError('');
    }
  }, [open, barber.id]);

  const selectedService = services.find((s) => s.id === serviceId);

  // Grade de horários livres do dia atual pro barbeiro selecionado — só é
  // calculada quando o usuário opta por escolher um horário manual, pra não
  // gastar uma consulta de expediente à toa em todo walk-in "de agora".
  const [daySchedule, setDaySchedule] = useState(null);
  useEffect(() => {
    if (!useNow && barberId) {
      listSchedule(barberId).then((rows) => {
        const today = dayOfWeekFromDate(new Date());
        setDaySchedule(rows.find((r) => r.day_of_week === today) || null);
      });
    }
  }, [useNow, barberId]);

  const availableSlots = useMemo(() => {
    if (useNow || !daySchedule || !selectedService) return [];
    const busyRanges = (existingAppointments || [])
      .filter((a) => a.barbers?.id === barberId && a.status !== 'cancelado')
      .map((a) => {
        const start = new Date(a.appointment_date);
        const startTime = start.toTimeString().slice(0, 5);
        const durationMin = a.services?.default_duration_minutes || 30;
        const end = new Date(start.getTime() + durationMin * 60000);
        return { start: startTime, end: end.toTimeString().slice(0, 5) };
      });

    return generateAvailableSlots(
      daySchedule,
      busyRanges,
      selectedService.default_duration_minutes,
      { nowTime: roundUpToNextSlot() }
    );
  }, [useNow, daySchedule, selectedService, existingAppointments, barberId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!serviceId) {
      setError('Escolha o serviço realizado.');
      return;
    }
    if (!useNow && !manualTime) {
      setError('Escolha um horário disponível ou marque "Agora".');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await createWalkInAppointment({
        barber_id: barberId,
        service_id: serviceId,
        client_name: clientName,
        client_phone: clientPhone,
        date: new Date().toISOString().slice(0, 10),
        time: useNow ? null : manualTime,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Cliente sem hora marcada">
      <form onSubmit={handleSubmit}>
        {canPickBarber && team.length > 0 && (
          <FormField label="Barbeiro">
            <select
              value={barberId}
              onChange={(e) => setBarberId(e.target.value)}
              className="w-full h-11 rounded-lg bg-elevated border border-zinc-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
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
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            required
            className="w-full h-11 rounded-lg bg-elevated border border-zinc-700 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <option value="">Selecione…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.default_duration_minutes} min
              </option>
            ))}
          </select>
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
          <span className="block text-xs font-medium text-zinc-400 mb-1.5">Horário</span>
          <div className="grid grid-cols-2 gap-2 mb-2.5">
            <button
              type="button"
              onClick={() => setUseNow(true)}
              className={`h-10 rounded-lg text-sm font-medium border transition-colors ${
                useNow ? 'bg-accent border-accent text-white' : 'border-zinc-700 text-zinc-400'
              }`}
            >
              Agora
            </button>
            <button
              type="button"
              onClick={() => setUseNow(false)}
              className={`h-10 rounded-lg text-sm font-medium border transition-colors ${
                !useNow ? 'bg-accent border-accent text-white' : 'border-zinc-700 text-zinc-400'
              }`}
            >
              Escolher horário
            </button>
          </div>

          {!useNow && (
            <>
              {!selectedService ? (
                <p className="text-zinc-600 text-xs">Escolha o serviço pra ver os horários livres.</p>
              ) : availableSlots.length === 0 ? (
                <p className="text-zinc-600 text-xs">Nenhum horário livre hoje pra esse serviço.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableSlots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setManualTime(slot)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        manualTime === slot
                          ? 'bg-accent border-accent text-white'
                          : 'border-zinc-700 text-zinc-400'
                      }`}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {error && <p className="text-accent-light text-xs mb-3">{error}</p>}

        <PrimaryButton type="submit" disabled={saving}>
          {saving ? 'Registrando…' : 'Registrar atendimento'}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
