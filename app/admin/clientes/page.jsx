'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Users,
  Search,
  MessageSquare,
  Sparkles,
  AlertCircle,
  Calendar,
  Clock,
  Scissors,
  ArrowUpDown,
  RefreshCw,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { listClients } from '@/lib/actions/clients';
import { useBarber } from '@/lib/barber-context';
import { formatPhoneBR } from '@/lib/whatsapp';
import ClientDetailSheet from '@/components/admin/ClientDetailSheet';

function formatBRL(val) {
  return `R$ ${Number(val || 0).toFixed(2).replace('.', ',')}`;
}

export default function ClientesPage() {
  const { scopeBarberId, isLeadership, isChefe } = useBarber();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('todos'); // 'todos' | 'fiel' | 'atrasado' | 'novo'
  const [counts, setCounts] = useState({ total: 0, fiel: 0, atrasado: 0, novo: 0 });
  const [selectedClient, setSelectedClient] = useState(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    setLoading(true);

    listClients({ search, filter, scopeBarberId })
      .then((res) => {
        if (!active) return;
        if (res.data) {
          setClients(res.data);
          setCounts({
            total: res.totalCount || 0,
            fiel: res.fielCount || 0,
            atrasado: res.atrasadoCount || 0,
            novo: res.novoCount || 0,
          });
        }
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [search, filter, scopeBarberId]);

  function handleWhatsApp(client, e) {
    if (e) e.stopPropagation();
    const digits = (client.phone || '').replace(/\D/g, '');
    const phoneToUse = digits.length <= 11 ? `55${digits}` : digits;
    const greeting = `Olá, ${client.name}! Tudo bem? É da Barbearia JM Barberclub. Passando para desejar um ótimo dia e saber se deseja agendar seu próximo corte conosco! Link rápido: https://chatbot-jmbarberclub.vercel.app/`;
    window.open(`https://wa.me/${phoneToUse}?text=${encodeURIComponent(greeting)}`, '_blank');
  }

  return (
    <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto pb-24">
      {/* Cabeçalho da Seção */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-lg leading-tight flex items-center gap-2">
            <Users size={20} className="text-accent" />
            <span>Gestão de Clientes</span>
          </h1>
          <p className="text-zinc-500 text-xs mt-0.5">
            Base completa de clientes, histórico de visitas e contato
          </p>
        </div>
        <span className="text-xs bg-zinc-800 text-zinc-300 px-3 py-1 rounded-full font-semibold border border-zinc-700">
          {counts.total} clientes
        </span>
      </div>

      {/* Barra de Busca */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou telefone…"
          className="w-full h-11 bg-surface border border-zinc-800 rounded-xl pl-10 pr-4 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-accent transition-colors"
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

      {/* Filtros por Segmentação de Clientes */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar select-none">
        <button
          type="button"
          onClick={() => setFilter('todos')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all touch-manipulation ${
            filter === 'todos'
              ? 'bg-white text-black'
              : 'bg-surface border border-zinc-800 text-zinc-400 hover:text-white'
          }`}
        >
          Todos ({counts.total})
        </button>

        <button
          type="button"
          onClick={() => setFilter('fiel')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all touch-manipulation flex items-center gap-1.5 ${
            filter === 'fiel'
              ? 'bg-emerald-500 text-black'
              : 'bg-surface border border-zinc-800 text-zinc-400 hover:text-emerald-400'
          }`}
        >
          <span>⭐ Fiéis ({counts.fiel})</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter('atrasado')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all touch-manipulation flex items-center gap-1.5 ${
            filter === 'atrasado'
              ? 'bg-amber-500 text-black'
              : 'bg-surface border border-zinc-800 text-zinc-400 hover:text-amber-400'
          }`}
        >
          <span>⏳ Atrasados (+30d) ({counts.atrasado})</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter('novo')}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all touch-manipulation flex items-center gap-1.5 ${
            filter === 'novo'
              ? 'bg-sky-500 text-black'
              : 'bg-surface border border-zinc-800 text-zinc-400 hover:text-sky-400'
          }`}
        >
          <span>🌱 Novos ({counts.novo})</span>
        </button>
      </div>

      {/* Lista de Cards de Clientes */}
      <div className="space-y-2.5">
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-surface rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div className="text-center py-12 bg-surface/40 border border-zinc-800 rounded-2xl p-6">
            <Users size={32} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-white text-sm font-semibold">Nenhum cliente encontrado</p>
            <p className="text-zinc-500 text-xs mt-1">
              Tente alterar os termos de busca ou o filtro de categoria.
            </p>
          </div>
        ) : (
          clients.map((client) => {
            const isFiel = client.status === 'fiel';
            const isAtrasado = client.status === 'atrasado';
            const isNovo = client.status === 'novo';

            return (
              <div
                key={client.cleanPhone}
                onClick={() => setSelectedClient(client)}
                className="bg-surface hover:bg-surface/80 border border-zinc-800 hover:border-zinc-700/80 rounded-2xl p-3.5 transition-all cursor-pointer flex items-center justify-between gap-3 shadow-sm active:scale-[0.99] touch-manipulation"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-11 w-11 rounded-full bg-elevated border border-zinc-700 flex items-center justify-center text-sm font-bold text-white shrink-0">
                    {client.name?.charAt(0)?.toUpperCase() || 'C'}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-semibold text-sm truncate">{client.name}</p>
                      {isFiel && (
                        <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded font-semibold">
                          Fiel
                        </span>
                      )}
                      {isAtrasado && (
                        <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.2 rounded font-semibold">
                          {client.daysSinceLast}d s/ corte
                        </span>
                      )}
                      {isNovo && (
                        <span className="text-[10px] bg-sky-500/15 text-sky-400 border border-sky-500/30 px-1.5 py-0.2 rounded font-semibold">
                          Novo
                        </span>
                      )}
                    </div>

                    <p className="text-zinc-400 text-xs mt-0.5">{formatPhoneBR(client.phone)}</p>

                    <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-500">
                      <span>{client.completedAppointments} cortes</span>
                      <span>•</span>
                      <span>Último: {client.lastService || 'Corte'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => handleWhatsApp(client, e)}
                    aria-label={`Conversar com ${client.name} no WhatsApp`}
                    className="h-9 w-9 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 flex items-center justify-center transition-transform active:scale-90 touch-manipulation"
                  >
                    <MessageSquare size={16} />
                  </button>

                  <ChevronRight size={16} className="text-zinc-600" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Detalhes do Cliente */}
      <ClientDetailSheet
        client={selectedClient}
        open={Boolean(selectedClient)}
        onClose={() => setSelectedClient(null)}
        onWhatsApp={(c) => handleWhatsApp(c)}
      />
    </div>
  );
}
