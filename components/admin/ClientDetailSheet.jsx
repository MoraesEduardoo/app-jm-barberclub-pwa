'use client';

import { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  Scissors,
  MessageSquare,
  Trash2,
  AlertTriangle,
  Loader2,
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

  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      setDeleting(false);
    }
  }, [open, client?.id]);

  if (!client) return null;

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
        <div className="flex items-center justify-between bg-elevated/70 p-3.5 rounded-2xl border border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-accent font-bold text-base">
              {client.name?.charAt(0)?.toUpperCase() || 'C'}
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">{client.name}</p>
              <p className="text-zinc-400 text-xs mt-0.5">{formatPhoneBR(client.phone)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onWhatsApp(client)}
            className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs py-2 px-3 rounded-xl transition-transform active:scale-95 touch-manipulation"
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

        {/* Ação de Exclusão do Cliente */}
        <div className="pt-2 border-t border-zinc-800/80">
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/25 text-rose-400 font-semibold text-xs transition-all active:scale-[0.99] touch-manipulation"
            >
              <Trash2 size={15} />
              <span>Excluir Cliente</span>
            </button>
          ) : (
            <div className="bg-rose-950/25 border border-rose-500/30 rounded-2xl p-3.5 space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 mt-0.5">
                  <AlertTriangle size={16} />
                </div>
                <div>
                  <p className="text-white font-bold text-xs">
                    Confirmar exclusão de {client.name}?
                  </p>
                  <p className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
                    O cliente será removido da lista de clientes, mantendo intactos os relatórios financeiros do caixa.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmingDelete(false)}
                  className="py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-semibold text-xs transition-all touch-manipulation disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 touch-manipulation disabled:opacity-50"
                >
                  {deleting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Excluindo...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>Confirmar Exclusão</span>
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
