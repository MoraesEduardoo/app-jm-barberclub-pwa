'use client';

import { useEffect, useState } from 'react';
import {
  CalendarX2,
  Calendar,
  Clock,
  Scissors,
  MessageSquare,
  Search,
  User,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { listCancelledAppointments } from '@/lib/actions/cancellations';
import { useBarber } from '@/lib/barber-context';
import { formatPhoneBR } from '@/lib/whatsapp';

function formatBRL(val) {
  return `R$ ${Number(val || 0).toFixed(2).replace('.', ',')}`;
}

export default function CanceladosPage() {
  const { scopeBarberId, isLeadership } = useBarber();
  const [cancellations, setCancellations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);

    listCancelledAppointments({ scopeBarberId })
      .then((res) => {
        if (!active) return;
        if (res.data) setCancellations(res.data);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [scopeBarberId]);

  function handleRescheduleWhatsApp(item) {
    const digits = (item.client_phone || '').replace(/\D/g, '');
    const phoneToUse = digits.length <= 11 ? `55${digits}` : digits;
    const msg = `Olá, ${item.client_name}! Tudo bem? É da Barbearia JM Barberclub. Notamos que seu agendamento de ${item.service || 'corte'} do dia ${item.appointment_date} precisou ser cancelado. Gostaria de remarcar para um novo horário nesta semana? Link direto: https://chatbot-jmbarberclub.vercel.app/`;
    window.open(`https://wa.me/${phoneToUse}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const filtered = cancellations.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const matchName = item.client_name?.toLowerCase().includes(q);
    const matchPhone = item.client_phone?.includes(q);
    const matchService = item.service?.toLowerCase().includes(q);
    return matchName || matchPhone || matchService;
  });

  return (
    <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto pb-24">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-lg leading-tight flex items-center gap-2">
            <CalendarX2 size={20} className="text-rose-400" />
            <span>Agendamentos Cancelados</span>
          </h1>
          <p className="text-zinc-500 text-xs mt-0.5">
            Histórico de horários desmarcados e oportunidade de remarcação
          </p>
        </div>
        <span className="text-xs bg-rose-500/10 text-rose-400 px-3 py-1 rounded-full font-semibold border border-rose-500/20">
          {cancellations.length} cancelados
        </span>
      </div>

      {/* Busca */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente, telefone ou serviço…"
          className="w-full h-11 bg-surface border border-zinc-800 rounded-xl pl-10 pr-4 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500 transition-colors"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-white"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Lista de Cancelamentos */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 bg-surface rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 bg-surface/40 border border-zinc-800 rounded-2xl p-6">
            <CalendarX2 size={32} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-white text-sm font-semibold">Nenhum cancelamento encontrado</p>
            <p className="text-zinc-500 text-xs mt-1">
              Todos os horários marcados estão ativos ou foram concluídos com sucesso.
            </p>
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="bg-surface border border-zinc-800/90 rounded-2xl p-4 space-y-3 shadow-sm hover:border-zinc-700 transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white font-bold text-sm truncate">{item.client_name}</p>
                    <span className="text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/30 px-1.5 py-0.2 rounded font-semibold uppercase">
                      Cancelado
                    </span>
                  </div>
                  <p className="text-zinc-400 text-xs">{formatPhoneBR(item.client_phone)}</p>
                </div>

                <div className="text-right shrink-0">
                  <span className="font-bold text-white text-sm block">
                    {formatBRL(item.price)}
                  </span>
                  <span className="text-zinc-500 text-[11px] font-medium">
                    {item.barbers?.name || 'Equipe'}
                  </span>
                </div>
              </div>

              {/* Informações de Data e Serviço */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 bg-elevated/40 p-2.5 rounded-xl border border-zinc-800/60">
                <span className="flex items-center gap-1.5 font-medium text-zinc-200">
                  <Scissors size={13} className="text-accent" />
                  {item.service || 'Serviço'}
                </span>

                <span className="flex items-center gap-1.5">
                  <Calendar size={13} className="text-zinc-500" />
                  {item.appointment_date}
                </span>

                {item.appointment_time && (
                  <span className="flex items-center gap-1.5">
                    <Clock size={13} className="text-zinc-500" />
                    {item.appointment_time}
                  </span>
                )}
              </div>

              {/* Motivo do Cancelamento ou Notas */}
              {(item.cancellation_reason || item.notes) && (
                <div className="text-[11px] text-zinc-400 bg-zinc-900/60 p-2 rounded-lg border border-zinc-800/50">
                  <strong className="text-zinc-300">Motivo/Nota: </strong>
                  {item.cancellation_reason || item.notes}
                </div>
              )}

              {/* Ação de Reagendamento via WhatsApp */}
              <button
                type="button"
                onClick={() => handleRescheduleWhatsApp(item)}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 py-2.5 rounded-xl text-xs font-semibold active:scale-[0.99] transition-all touch-manipulation"
              >
                <RotateCcw size={14} />
                <span>Oferecer Novo Horário via WhatsApp</span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
