"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarOff, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { useBarber } from "@/lib/barber-context";
import { PERMISSION_KEYS } from "@/lib/auth";
import { WEEKDAYS } from "@/lib/constants/schedule";
import {
  listSchedule,
  saveScheduleBatch,
  listExceptions,
  createException,
  deleteException,
} from "@/lib/actions/schedule";
import {
  cacheKeys,
  getCache,
  setCache,
  invalidateCache,
} from "@/lib/admin-cache";
import ScheduleDayRow from "@/components/admin/ScheduleDayRow";
import BottomSheet from "@/components/admin/BottomSheet";
import {
  FormField,
  TextInput,
  PrimaryButton,
} from "@/components/admin/FormField";
import { toast } from "@/lib/toast";

function buildDefaultWeekSchedule(barberId = null) {
  return WEEKDAYS.map((w) => ({
    barber_id: barberId,
    day_of_week: w.value,
    active: true,
    is_working: true,
    start_time: w.value === "segunda" ? "14:30" : "09:00",
    end_time: w.value === "domingo" ? "12:30" : "19:00",
    has_lunch_break: false,
    lunch_start: "12:00",
    lunch_end: "13:00",
  }));
}

function resolveDefaultBarberId(selectedBarberId, team, barber) {
  if (selectedBarberId) {
    if (!Array.isArray(team) || team.length === 0 || team.some((m) => m.id === selectedBarberId)) {
      return selectedBarberId;
    }
  }
  if (Array.isArray(team) && team.length > 0) {
    const loggedInMember = barber?.id ? team.find((m) => m.id === barber.id) : null;
    return loggedInMember ? loggedInMember.id : team[0].id;
  }
  return barber?.id || null;
}

export default function ExpedientePage() {
  const {
    barber,
    can,
    isLeadership,
    selectedBarberId,
    selectBarber,
    setSelectionGuard,
    team,
    refreshTeam,
  } = useBarber();

  const canManageOthers = can(PERMISSION_KEYS.MANAGE_SCHEDULE_OTHERS) || isLeadership;

  // Barbeiro selecionado por defeito ao abrir a aba (sem exigir clique manual)
  const [activeBarberId, setActiveBarberId] = useState(() =>
    resolveDefaultBarberId(selectedBarberId, team, barber)
  );

  const schedKey = cacheKeys.schedule(activeBarberId);
  const excKey = cacheKeys.exceptions(activeBarberId);

  const [schedule, setSchedule] = useState(() => {
    const cached = getCache(schedKey);
    return Array.isArray(cached) && cached.length > 0
      ? cached
      : buildDefaultWeekSchedule(activeBarberId);
  });
  const [exceptions, setExceptions] = useState(() => {
    const cached = getCache(excKey);
    return Array.isArray(cached) ? cached : [];
  });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [blockDate, setBlockDate] = useState("");
  const [blockNote, setBlockNote] = useState("");

  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Garante que a lista da equipe esteja carregada e um barbeiro padrão esteja selecionado automaticamente
  useEffect(() => {
    if (canManageOthers && (!Array.isArray(team) || team.length === 0)) {
      refreshTeam?.();
    }
  }, [canManageOthers, team, refreshTeam]);

  useEffect(() => {
    const nextDefault = resolveDefaultBarberId(selectedBarberId, team, barber);
    if (!nextDefault) return;

    const currentValidInTeam =
      !Array.isArray(team) ||
      team.length === 0 ||
      team.some((m) => m.id === activeBarberId);

    if (!activeBarberId || !currentValidInTeam) {
      setActiveBarberId(nextDefault);
      if (isLeadership && !selectedBarberId) {
        selectBarber(nextDefault);
      }
    } else if (selectedBarberId && selectedBarberId !== activeBarberId) {
      setActiveBarberId(selectedBarberId);
    }
  }, [selectedBarberId, team, barber, activeBarberId, isLeadership, selectBarber]);

  const loadScheduleForBarber = useCallback(async (barberId) => {
    if (!barberId) return;
    const sKey = cacheKeys.schedule(barberId);
    const eKey = cacheKeys.exceptions(barberId);

    // Exibe imediatamente os dados em cache (se existirem) ou o padrão de 7 dias
    const cachedSched = getCache(sKey);
    const cachedExc = getCache(eKey);
    if (Array.isArray(cachedSched) && cachedSched.length > 0) {
      setSchedule(cachedSched);
    } else {
      setSchedule(buildDefaultWeekSchedule(barberId));
    }
    if (Array.isArray(cachedExc)) {
      setExceptions(cachedExc);
    }

    try {
      const [schedRes, excRes] = await Promise.allSettled([
        listSchedule(barberId),
        listExceptions(barberId),
      ]);

      if (schedRes.status === "fulfilled") {
        const nextSched =
          Array.isArray(schedRes.value) && schedRes.value.length > 0
            ? schedRes.value
            : buildDefaultWeekSchedule(barberId);
        setSchedule(nextSched);
        setCache(sKey, nextSched);
      }

      if (excRes.status === "fulfilled") {
        const nextExc = Array.isArray(excRes.value) ? excRes.value : [];
        setExceptions(nextExc);
        setCache(eKey, nextExc);
      }

      setHasChanges(false);
    } catch (err) {
      console.error("[ExpedientePage] Erro ao carregar horários:", err);
    }
  }, []);

  useEffect(() => {
    if (activeBarberId) {
      loadScheduleForBarber(activeBarberId);
    }
  }, [activeBarberId, loadScheduleForBarber]);

  // Bloqueia a troca de profissional se houver alterações pendentes
  useEffect(() => {
    setSelectionGuard(() => !hasChanges);
    return () => setSelectionGuard(null);
  }, [hasChanges, setSelectionGuard]);

  function handleSelectBarber(memberId) {
    if (!memberId || memberId === activeBarberId) return;
    if (hasChanges) {
      toast.warning("Salve as alterações atuais antes de trocar de profissional.");
      return;
    }
    setActiveBarberId(memberId);
    if (isLeadership) {
      selectBarber(memberId);
    }
  }

  function handleDayChange(dayValue, values) {
    setSchedule((prev) => {
      const index = prev.findIndex((s) => s.day_of_week === dayValue);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = { ...copy[index], ...values };
        return copy;
      }
      return [...prev, { barber_id: activeBarberId, day_of_week: dayValue, ...values }];
    });
    setHasChanges(true);
  }

  async function handleSaveChanges() {
    if (!activeBarberId) return;
    setIsSaving(true);
    try {
      const res = await saveScheduleBatch(activeBarberId, schedule);
      if (res?.error) {
        throw new Error(res.error);
      }
      setHasChanges(false);
      setCache(schedKey, schedule);
      invalidateCache("schedule:week:");
      invalidateCache(cacheKeys.bootstrapStatus());
      await loadScheduleForBarber(activeBarberId);
      toast.success("Escala de expediente salva com sucesso!");
    } catch (error) {
      console.error("Erro ao salvar horários:", error);
      toast.error(error?.message || "Ocorreu um erro ao salvar as mudanças. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddBlock(e) {
    e.preventDefault();
    if (!blockDate || !activeBarberId) return;
    try {
      await createException(activeBarberId, {
        date: blockDate,
        reason: blockNote,
      });
      setBlockDate("");
      setBlockNote("");
      setSheetOpen(false);
      invalidateCache("schedule:week:");
      await loadScheduleForBarber(activeBarberId);
      toast.success("Data bloqueada com sucesso!");
    } catch (err) {
      toast.error(err?.message || "Não foi possível bloquear a data.");
    }
  }

  async function handleRemoveBlock(id) {
    setExceptions((prev) => {
      const next = prev.filter((exc) => exc.id !== id);
      setCache(excKey, next);
      return next;
    });
    try {
      await deleteException(id);
      invalidateCache("schedule:week:");
      await loadScheduleForBarber(activeBarberId);
    } catch (err) {
      toast.error(err?.message || "Erro ao remover bloqueio.");
    }
  }

  const scheduleByDay = Object.fromEntries(
    schedule.map((s) => [s.day_of_week, s])
  );

  return (
    <div
      className={`px-4 pt-4 pb-10 ${
        hasChanges ? "mb-[calc(env(safe-area-inset-bottom,0px)+88px)]" : ""
      }`}
    >
      {canManageOthers && team.length > 0 && (
        <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto pb-1 scroll-touch no-scrollbar">
          {team.map((member) => {
            const isSelected = activeBarberId === member.id;
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => handleSelectBarber(member.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-all touch-manipulation select-none active:scale-95 ${
                  isSelected
                    ? "bg-accent border-accent text-white shadow-sm"
                    : "border-zinc-700 text-zinc-400 active:bg-zinc-800"
                }`}
              >
                {member.name}
              </button>
            );
          })}
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
          type="button"
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
                    exc.exception_date + "T00:00:00"
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
                type="button"
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

      {hasChanges && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+64px)] left-0 right-0 p-4 z-40 animate-in slide-in-from-bottom-5 pointer-events-none">
          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={isSaving}
            className="pointer-events-auto w-full flex items-center justify-center gap-2 h-14 rounded-full bg-accent text-white font-semibold shadow-lg shadow-accent/25 active:scale-[0.98] active:bg-accent-dark transition-all touch-manipulation select-none disabled:opacity-70"
          >
            {isSaving ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Save size={20} />
            )}
            {isSaving ? "Salvando alterações..." : "Salvar mudanças"}
          </button>
        </div>
      )}
    </div>
  );
}
