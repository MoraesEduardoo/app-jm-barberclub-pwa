'use client';

import { useState, useEffect } from 'react';
import { CalendarOff, Plus, Trash2, Loader2, Calendar } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { listExceptions, createException, deleteException } from '@/lib/actions/schedule';
import { FormField, TextInput, PrimaryButton } from './FormField';

function formatDate(dateStr) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * TeamMemberExceptionsSheet:
 * Bloqueios de Agenda, Folgas e Férias Pontuais para o colaborador.
 * Permite bloquear datas completas para evitar agendamentos nesses dias.
 */
export default function TeamMemberExceptionsSheet({ open, onClose, member }) {
  const [exceptions, setExceptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !member?.id) return;

    let active = true;
    setLoading(true);

    listExceptions(member.id)
      .then((data) => {
        if (active) {
          setExceptions(data || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Erro ao carregar folgas do colaborador:', err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, member?.id]);

  async function handleAddException(e) {
    e.preventDefault();
    if (!date) {
      setError('Escolha uma data para o bloqueio.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await createException(member.id, { date, reason });
      setDate('');
      setReason('');
      setAdding(false);
      const updated = await listExceptions(member.id);
      setExceptions(updated || []);
    } catch (err) {
      setError(err.message || 'Erro ao salvar bloqueio de data.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id) {
    if (!confirm('Deseja liberar esta data na agenda do colaborador?')) return;
    try {
      setExceptions((prev) => prev.filter((exc) => exc.id !== id));
      await deleteException(id);
    } catch (err) {
      console.error('Erro ao remover bloqueio:', err);
    }
  }

  if (!member) return null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`Folgas e Bloqueios: ${member.name}`}
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-center justify-between">
          <p className="text-zinc-400 text-xs">
            Datas em que{' '}
            <strong className="text-white">{member.name}</strong> não estará
            disponível para agendamento.
          </p>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 text-accent-light text-xs font-semibold shrink-0 touch-manipulation active:opacity-75"
            >
              <Plus size={14} /> Nova folga
            </button>
          )}
        </div>

        {adding && (
          <form
            onSubmit={handleAddException}
            className="bg-surface border border-zinc-800 rounded-xl p-3.5 space-y-3"
          >
            <h4 className="text-white text-xs font-semibold">
              Bloquear data para {member.name}
            </h4>
            <FormField label="Data da folga / ausência">
              <TextInput
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Motivo (opcional)">
              <TextInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Férias, Folga semanal, Compromisso médico"
              />
            </FormField>

            {error && <p className="text-accent-light text-xs">{error}</p>}

            <div className="flex items-center gap-2 pt-1">
              <PrimaryButton type="submit" disabled={saving}>
                {saving ? 'Bloqueando…' : 'Confirmar bloqueio'}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError('');
                }}
                className="px-3 py-2 text-xs text-zinc-400 hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <Loader2 size={24} className="animate-spin text-accent" />
            <span className="text-xs">Carregando bloqueios da agenda…</span>
          </div>
        ) : exceptions.length === 0 ? (
          <div className="bg-surface/50 border border-zinc-800/80 rounded-xl py-8 text-center text-zinc-500 text-xs">
            Nenhuma folga ou bloqueio programado para {member.name}.
          </div>
        ) : (
          <div className="space-y-2">
            {exceptions.map((exc) => (
              <div
                key={exc.id}
                className="flex items-center justify-between gap-3 bg-surface border border-zinc-800 rounded-xl px-3.5 py-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent-light shrink-0">
                    <CalendarOff size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-xs font-semibold truncate">
                      {formatDate(exc.exception_date)}
                    </p>
                    {exc.reason && (
                      <p className="text-zinc-400 text-[11px] truncate mt-0.5">
                        {exc.reason}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemove(exc.id)}
                  aria-label="Remover bloqueio"
                  className="h-8 w-8 rounded-full flex items-center justify-center text-zinc-500 active:text-accent-light active:bg-zinc-800 touch-manipulation transition-colors shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
