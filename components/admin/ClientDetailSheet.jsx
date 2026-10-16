'use client';

import { Calendar, Clock, DollarSign, Scissors, User, X, MessageSquare, Phone } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { formatPhoneBR } from '@/lib/whatsapp';

function formatBRL(val) {
  return `R$ ${Number(val || 0).toFixed(2).replace('.', ',')}`;
}

export default function ClientDetailSheet({ client, open, onClose, onWhatsApp }) {
  if (!client) return null;

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
      </div>
    </BottomSheet>
  );
}
