"use client";

import { useEffect, useState, useCallback, useTransition } from "react";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { useBarber } from "@/lib/barber-context";
import { PERMISSION_KEYS } from "@/lib/auth";
import { listTeam } from "@/lib/actions/team";
import { WEEKDAYS } from "@/lib/constants/schedule";
import {
  listSchedule,
  upsertScheduleDay,
  listExceptions,
  createException,
  deleteException,
} from "@/lib/actions/schedule";
import ScheduleDayRow from "@/components/admin/ScheduleDayRow";
import BottomSheet from "@/components/admin/BottomSheet";
import {
  FormField,
  TextInput,
  PrimaryButton,
} from "@/components/admin/FormField";

export default function ExpedientePage() {
  const { barber, can } = useBarber();
  const canManageOthers = can(PERMISSION_KEYS.MANAGE_SCHEDULE_OTHERS);

  const [team, setTeam] = useState([]);
  const [targetBarberId, setTargetBarberId] = useState(barber?.id);
  const [schedule, setSchedule] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [blockDate, setBlockDate] = useState("");
  const [blockNote, setBlockNote] = useState("");

  useEffect(() => {
    if (canManageOthers) {
      listTeam()
        .then(setTeam)
        .catch(() => {});
    }
  }, [canManageOthers]);

  // Carrega os dados em segundo plano sem NUNCA limpar a tela (sem setLoading true)
  const loadData = useCallback(async (barberId) => {
    try {
      const [sched, exc] = await Promise.all([
        listSchedule(barberId),
        listExceptions(barberId),
      ]);
      setSchedule(sched || []);
      setExceptions(exc || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (targetBarberId) {
      loadData(targetBarberId);
    }
  }, [targetBarberId, loadData]);

  function handleSelectBarber(memberId) {
    startTransition(() => {
      setTargetBarberId(memberId);
      loadData(memberId);
    });
  }

  async function handleDayChange(dayValue, values) {
    // Atualização otimista imediata na UI
    setSchedule((prev) => {
      const index = prev.findIndex((s) => s.day_of_week === dayValue);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = { ...copy[index], ...values };
        return copy;
      }
      return [...prev, { day_of_week: dayValue, ...values }];
    });

    await upsertScheduleDay(targetBarberId, dayValue, values);
    loadData(targetBarberId);
  }

  async function handleAddBlock(e) {
    e.preventDefault();
    if (!blockDate) return;
    await createException(targetBarberId, {
      date: blockDate,
      reason: blockNote,
    });
    setBlockDate("");
    setBlockNote("");
    setSheetOpen(false);
    loadData(targetBarberId);
  }

  async function handleRemoveBlock(id) {
    setExceptions((prev) => prev.filter((exc) => exc.id !== id));
    await deleteException(id);
    loadData(targetBarberId);
  }

  const scheduleByDay = Object.fromEntries(
    schedule.map((s) => [s.day_of_week, s]),
  );

  return (
    <div className="px-4 pt-4 pb-10">
      {canManageOthers && team.length > 0 && (
        <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto pb-1">
          {team.map((member) => (
            <button
              key={member.id}
              onClick={() => handleSelectBarber(member.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors ${
                targetBarberId === member.id
                  ? "bg-accent border-accent text-white"
                  : "border-zinc-700 text-zinc-400"
              }`}
            >
              {member.name}
            </button>
          ))}
        </div>
      )}

      <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2 px-1">
        Dias de funcionamento
      </h3>

      <div className="space-y-2">
        {WEEKDAYS.map((day) => (
          <ScheduleDayRow
            key={day.value}
            day={day}
            entry={scheduleByDay[day.value]}
            onChange={(values) => handleDayChange(day.value, values)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between mt-6 mb-2 px-1">
        <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide">
          Bloqueios e folgas
        </h3>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-1 text-accent-light text-xs font-semibold"
        >
          <Plus size={14} /> Bloquear data
        </button>
      </div>

      {exceptions.length === 0 ? (
        <p className="text-zinc-600 text-sm text-center py-6">
          Nenhuma data bloqueada nos próximos dias.
        </p>
      ) : (
        <div className="space-y-2">
          {exceptions.map((exc) => (
            <div
              key={exc.id}
              className="flex items-center gap-3 bg-surface border border-zinc-800 rounded-xl px-4 py-3"
            >
              <CalendarOff size={16} className="text-accent-light shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium">
                  {new Date(
                    exc.exception_date + "T00:00:00",
                  ).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                  })}
                </p>
                {exc.reason && (
                  <p className="text-zinc-500 text-xs truncate">{exc.reason}</p>
                )}
              </div>
              <button
                onClick={() => handleRemoveBlock(exc.id)}
                className="text-zinc-600 active:text-accent-light"
                aria-label="Remover bloqueio"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Bloquear data"
      >
        <form onSubmit={handleAddBlock}>
          <FormField label="Data">
            <TextInput
              type="date"
              value={blockDate}
              onChange={(e) => setBlockDate(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Motivo (opcional)">
            <TextInput
              value={blockNote}
              onChange={(e) => setBlockNote(e.target.value)}
              placeholder="Ex.: Feriado, viagem, consulta"
            />
          </FormField>
          <PrimaryButton type="submit">Bloquear data</PrimaryButton>
        </form>
      </BottomSheet>
    </div>
  );
}
