'use client';

import { useState, useEffect } from 'react';
import { Clock, Save, Loader2, Check } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { WEEKDAYS } from '@/lib/constants/schedule';
import { listSchedule, upsertScheduleDay } from '@/lib/actions/schedule';
import ScheduleDayRow from './ScheduleDayRow';

/**
 * TeamMemberScheduleSheet:
 * Gestão do expediente individual por colaborador.
 * Permite definir dias da semana em que o barbeiro atende, horários de entrada,
 * saída e intervalo de almoço com persistência segura no Supabase.
 */
export default function TeamMemberScheduleSheet({ open, onClose, member }) {
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);

  useEffect(() => {
    if (!open || !member?.id) return;

    let active = true;
    setLoading(true);
    setHasChanges(false);
    setSuccessNotice(false);

    listSchedule(member.id)
      .then((data) => {
        if (active) {
          setSchedule(data || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Erro ao carregar escala do colaborador:', err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, member?.id]);

  function handleDayChange(dayValue, values) {
    setSchedule((prev) => {
      const idx = prev.findIndex((s) => s.day_of_week === dayValue);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...values };
        return copy;
      }
      return [...prev, { day_of_week: dayValue, ...values }];
    });
    setHasChanges(true);
    setSuccessNotice(false);
  }

  async function handleSave() {
    if (!member?.id) return;
    setSaving(true);
    setSuccessNotice(false);

    try {
      const promises = schedule.map((s) =>
        upsertScheduleDay(member.id, s.day_of_week, {
          active: s.active,
          start_time: s.start_time,
          end_time: s.end_time,
          has_lunch_break: s.has_lunch_break,
          lunch_start: s.lunch_start,
          lunch_end: s.lunch_end,
        })
      );

      await Promise.all(promises);
      setHasChanges(false);
      setSuccessNotice(true);
      setTimeout(() => setSuccessNotice(false), 3000);
    } catch (err) {
      console.error('Erro ao salvar expediente:', err);
      alert('Não foi possível salvar o expediente. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  if (!member) return null;

  const scheduleByDay = Object.fromEntries(
    schedule.map((s) => [s.day_of_week, s])
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`Expediente de ${member.name}`}
    >
      <div className="space-y-3 pb-2">
        <p className="text-zinc-400 text-xs leading-relaxed">
          Configure a escala de atendimento individual de{' '}
          <strong className="text-white">{member.name}</strong>. Os horários e
          pausas de almoço determinam a grade de agendamentos no sistema.
        </p>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <Loader2 size={24} className="animate-spin text-accent" />
            <span className="text-xs">Carregando escala de trabalho…</span>
          </div>
        ) : (
          <>
            <div className="space-y-2 mt-2">
              {WEEKDAYS.map((day) => (
                <ScheduleDayRow
                  key={day.value}
                  day={day}
                  entry={scheduleByDay[day.value]}
                  onChange={(values) => handleDayChange(day.value, values)}
                />
              ))}
            </div>

            {successNotice && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl px-3.5 py-2.5 text-xs">
                <Check size={14} className="shrink-0" />
                <span>Expediente de {member.name} salvo com sucesso!</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (!hasChanges && !successNotice)}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl bg-accent text-white font-semibold text-xs active:scale-[0.98] active:bg-accent-dark transition-all touch-manipulation disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                <span>
                  {saving
                    ? 'Salvando expediente…'
                    : hasChanges
                    ? 'Salvar escala de horários'
                    : 'Escala atualizada'}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
