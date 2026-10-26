"use client";

import { endSession } from "@/lib/session";
import { useEffect, useMemo, useState } from "react";
import BottomSheet from "./BottomSheet";
import { todayInShop } from "@/lib/dates";
import { FormField, TextInput, PrimaryButton } from "./FormField";
import { listServices } from "@/lib/actions/services";
import { listSchedule } from "@/lib/actions/schedule";
import { createWalkInAppointment, getAvailableSlotsForBarber } from "@/lib/actions/appointments";
import { dayOfWeekFromDate } from "@/lib/constants/schedule";
import { generateAvailableSlots, roundUpToNextSlot, extractBusyRangesFromAppointments } from "@/lib/slots";

export default function WalkInSheet({
  open,
  onClose,
  barber,
  team,
  canPickBarber,
  existingAppointments,
}) {

  const [services, setServices] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState(barber.id);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [useNow, setUseNow] = useState(true);
  const [manualTime, setManualTime] = useState("");
  const [rpcSlots, setRpcSlots] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      listServices().then((data) => setServices(data.filter((s) => s.active !== false && s.is_active !== false)));
      setBarberId(barber.id);
      setClientName("");
      setClientPhone("");
      setUseNow(true);
      setManualTime("");
      setRpcSlots(null);
      setError("");
    }
  }, [open, barber.id]);

  const selectedService = services.find((s) => s.id === serviceId);

  const [daySchedule, setDaySchedule] = useState(null);
  useEffect(() => {
    if (!useNow && barberId) {
      listSchedule(barberId).then((rows) => {
        const today = dayOfWeekFromDate(new Date());
        setDaySchedule(rows.find((r) => r.day_of_week === today) || null);
      });
    }
  }, [useNow, barberId]);

  useEffect(() => {
    if (!useNow && barberId && serviceId) {
      getAvailableSlotsForBarber({
        barberId,
        date: todayInShop(),
        serviceId,
      }).then((res) => {
        if (res?.slots && res.slots.length > 0) {
          setRpcSlots(res.slots);
        } else {
          setRpcSlots(null);
        }
      });
    } else {
      setRpcSlots(null);
    }
  }, [useNow, barberId, serviceId]);

  const availableSlots = useMemo(() => {
    if (useNow || !selectedService) return [];
    if (Array.isArray(rpcSlots) && rpcSlots.length > 0) {
      return rpcSlots;
    }
    if (!daySchedule) return [];
    const busyRanges = extractBusyRangesFromAppointments(existingAppointments, barberId);
    const serviceDur = selectedService.duration_minutes ?? selectedService.default_duration_minutes ?? 30;

    return generateAvailableSlots(
      daySchedule,
      busyRanges,
      serviceDur,
      { nowTime: roundUpToNextSlot() },
    );
  }, [useNow, rpcSlots, daySchedule, selectedService, existingAppointments, barberId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!serviceId) {
      setError("Escolha o serviço realizado.");
      return;
    }
    if (!useNow && !manualTime) {
      setError('Escolha um horário disponível ou marque "Agora".');
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
        date: todayInShop(),
        time: useNow ? null : manualTime,
      });

      if (response?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (response?.error) {
        setError(response.error);
        return;
      }

      onClose();
    } catch (err) {
      setError(err.message || "Ocorreu um erro de conexão.");
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
          {services.length === 0 ? (
            <div className="rounded-xl bg-amber-950/30 border border-amber-500/30 p-3 text-xs text-amber-200 space-y-2">
              <p>Nenhum serviço cadastrado no catálogo ainda.</p>
              <a
                href="/admin/servicos"
                className="inline-flex items-center gap-1 text-accent-light font-semibold underline"
              >
                Ir para Catálogo de Serviços →
              </a>
            </div>
          ) : (
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              required
              className="w-full h-12 rounded-lg bg-elevated border border-zinc-700 px-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-accent touch-manipulation"
            >
              <option value="">Selecione…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — R$ {Number(s.price || 0).toFixed(2).replace(".", ",")} ({s.default_duration_minutes} min)
                </option>
              ))}
            </select>
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
            Horário
          </span>
          <div className="grid grid-cols-2 gap-2 mb-2.5">
            <button
              type="button"
              onClick={() => setUseNow(true)}
              className={`h-11 rounded-lg text-sm font-medium border transition-all touch-manipulation select-none active:scale-95 ${
                useNow
                  ? "bg-accent border-accent text-white"
                  : "border-zinc-700 text-zinc-400 active:bg-zinc-800"
              }`}
            >
              Agora
            </button>
            <button
              type="button"
              onClick={() => setUseNow(false)}
              className={`h-11 rounded-lg text-sm font-medium border transition-all touch-manipulation select-none active:scale-95 ${
                !useNow
                  ? "bg-accent border-accent text-white"
                  : "border-zinc-700 text-zinc-400 active:bg-zinc-800"
              }`}
            >
              Escolher horário
            </button>
          </div>

          {!useNow && (
            <>
              {!selectedService ? (
                <p className="text-zinc-600 text-xs">
                  Escolha o serviço pra ver os horários livres.
                </p>
              ) : availableSlots.length === 0 ? (
                <p className="text-zinc-600 text-xs">
                  Nenhum horário livre hoje pra esse serviço.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableSlots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setManualTime(slot)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all touch-manipulation select-none active:scale-95 ${
                        manualTime === slot
                          ? "bg-accent border-accent text-white"
                          : "border-zinc-700 text-zinc-400 active:bg-zinc-800"
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
          {saving ? "Registrando…" : "Registrar atendimento"}
        </PrimaryButton>
      </form>
    </BottomSheet>
  );
}
