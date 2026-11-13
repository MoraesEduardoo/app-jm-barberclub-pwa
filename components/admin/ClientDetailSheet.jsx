'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Calendar,
  Clock,
  Scissors,
  MessageSquare,
  Trash2,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import { formatPhoneBR } from '@/lib/whatsapp';
import { deleteClient } from '@/lib/actions/clients';
import { toast } from '@/lib/toast';

function formatBRL(val) {
  return `R$ ${Number(val || 0).toFixed(2).replace('.', ',')}`;
}

export default function ClientDetailSheet({ client, open, onClose, onWhatsApp, onDeleted }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      setDeleting(false);
      setCopiedPhone(false);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    }
  }, [open, client?.id]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (!client) return null;

  const formattedPhone = formatPhoneBR(client.phone);

  async function handleCopyPhone() {
    const textToCopy = formattedPhone || String(client.phone || '').trim();
    if (!textToCopy) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
    } catch {
      // Fallback silencioso
    }

    setCopiedPhone(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopiedPhone(false);
    }, 1500);
  }

  async function handleConfirmDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await deleteClient({ id: client.id, phone: client.phone });
      if (res?.error) {
        toast.error(res.error || 'Erro ao excluir cliente.');
        return;
      }
      setConfirmingDelete(false);
      onClose?.();
      if (onDeleted) {
        await onDeleted(client);
      }
      toast.success('Cliente excluído com sucesso!');
    } catch (err) {
      console.error('[ClientDetailSheet] Erro ao excluir cliente:', err);
      toast.error('Erro ao excluir cliente.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={client.name}>
      <div className="space-y-4">
        {/* Cabeçalho do Cliente */}
        <div className="flex items-center justify-between bg-elevated/70 p-3.5 rounded-2xl border border-zinc-800 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-12 w-12 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-accent font-bold text-base shrink-0">
              {client.name?.charAt(0)?.toUpperCase() || 'C'}
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-tight truncate">{client.name}</p>
              {formattedPhone && (
                <button
                  type="button"
                  onClick={handleCopyPhone}
                  title="Clique para copiar o telefone"
                  aria-label={`Copiar telefone ${formattedPhone}`}
                  className={`mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 -ml-2 rounded-lg text-xs font-mono tabular-nums transition-all active:scale-95 touch-manipulation select-none group ${
                    copiedPhone
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70 border border-transparent'
                  }`}
                >
                  {copiedPhone ? (
                    <>
                      <Check size={12} className="text-emerald-400 shrink-0" />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <span>{formattedPhone}</span>
                      <Copy
                        size={11}
                        className="text-zinc-500 group-hover:text-zinc-300 transition-colors shrink-0"
                      />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onWhatsApp(client)}
            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs py-2 px-3 rounded-xl transition-transform active:scale-95 touch-manipulation shrink-0"
          >
            <MessageSquare size={14} />
            <span>WhatsApp</span>
          </button>
        </div>

        {/* Resumo de Métricas */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-surface p-2.5 rounded-xl border border-zinc-800/80">
            <p className="text-zinc-500 text-[10px] font-semibold uppercase">Total Cortes</p>
            <p className="text-white text-base font-bold mt-0.5">{client.completedAppointments}</p>
          </div>
          <div className="bg-surface p-2.5 rounded-xl border border-zinc-800/80">
            <p className="text-zinc-500 text-[10px] font-semibold uppercase">Total Gasto</p>
            <p className="text-accent-light text-base font-bold mt-0.5">{formatBRL(client.totalSpent)}</p>
          </div>
          <div className="bg-surface p-2.5 rounded-xl border border-zinc-800/80">
            <p className="text-zinc-500 text-[10px] font-semibold uppercase">Último Corte</p>
            <p className="text-zinc-200 text-xs font-semibold mt-1">
              {client.daysSinceLast === null ? '—' : client.daysSinceLast === 0 ? 'Hoje' : `${client.daysSinceLast}d atrás`}
            </p>
          </div>
        </div>

        {/* Histórico de Agendamentos */}
        <div className="space-y-2 pt-1">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Histórico de Agendamentos ({client.history?.length || 0})
          </h4>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
            {client.history?.map((item) => (
              <div
                key={item.id}
                className="bg-elevated/40 border border-zinc-800/70 p-3 rounded-xl flex items-center justify-between text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <Scissors size={13} className="text-accent" />
                    <span>{item.service || 'Corte'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
                    <span className="flex items-center gap-1">
                      <Calendar size={11} /> {item.date}
                    </span>
                    {item.time && (
                      <span className="flex items-center gap-1">
                        <Clock size={11} /> {item.time}
                      </span>
                    )}
                    <span>• {item.barberName}</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-bold text-white block">{formatBRL(item.price)}</span>
                  <span
                    className={`text-[10px] uppercase font-bold ${
                      item.status === 'concluido'
                        ? 'text-emerald-400'
                        : item.status === 'cancelado'
                        ? 'text-rose-400'
                        : 'text-zinc-400'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ação de Exclusão Compacta */}
        <div className="pt-2 border-t border-zinc-800/80">
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="w-full h-10 flex items-center justify-center gap-1.5 px-3 rounded-xl bg-zinc-950 hover:bg-rose-950/30 border border-zinc-800 hover:border-rose-500/40 text-rose-400 font-semibold text-xs transition-all active:scale-[0.99] touch-manipulation"
            >
              <Trash2 size={14} />
              <span>Excluir</span>
            </button>
          ) : (
            <div className="bg-rose-950/25 border border-rose-500/30 rounded-2xl p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-rose-400 shrink-0" />
                <p className="text-white font-semibold text-xs truncate">
                  Excluir {client.name}?
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmingDelete(false)}
                  className="h-9 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-semibold text-xs transition-all touch-manipulation disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="h-9 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 touch-manipulation disabled:opacity-50"
                >
                  {deleting ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Excluindo…</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={13} />
                      <span>Confirmar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
