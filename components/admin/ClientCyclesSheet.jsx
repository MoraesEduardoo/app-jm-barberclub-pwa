"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Clock,
  Sparkles,
  Phone,
  RefreshCcw,
  MessageCircle,
  AlertCircle,
  CalendarCheck,
  Search,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import { getClientReturnCycles } from "@/lib/actions/client-cycles";

export default function ClientCyclesSheet({ open, onClose, scopeBarberId = null }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("todos"); // "todos" | "atrasado" | "em_dia" | "recente"
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (open) {
      setLoading(true);
      getClientReturnCycles({ scopeBarberId })
        .then((res) => {
          setClients(res?.data || []);
        })
        .catch(() => setClients([]))
        .finally(() => setLoading(false));
    }
  }, [open, scopeBarberId]);

  const filteredClients = clients.filter((c) => {
    if (filter === "atrasado" && c.status !== "atrasado") return false;
    if (filter === "em_dia" && c.status !== "em_dia") return false;
    if (filter === "recente" && c.status !== "recente") return false;

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchName = c.client_name?.toLowerCase().includes(q);
      const matchPhone = c.client_phone?.includes(q);
      return matchName || matchPhone;
    }
    return true;
  });

  const overdueCount = clients.filter((c) => c.status === "atrasado").length;

  function handleWhatsApp(client) {
    const cleanPhone = client.client_phone.replace(/\D/g, "");
    const firstName = client.client_name.split(" ")[0] || "amigo";
    const msg = encodeURIComponent(
      `Fala, ${firstName}! Tudo bem? Passando para lembrar que já faz cerca de ${client.days_since_last} dias desde o seu último corte aqui na JM Barberclub. Que tal garantir seu horário para manter a régua máxima? Abraço!`
    );
    window.open(`https://wa.me/55${cleanPhone}?text=${msg}`, "_blank");
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Ciclos de Retorno & Fidelidade">
      <div className="space-y-4">
        {/* Banner Explicativo */}
        <div className="bg-gradient-to-r from-red-950/40 via-surface to-surface border border-accent/30 rounded-xl p-3.5">
          <div className="flex items-center gap-2 text-accent-light text-xs font-semibold uppercase tracking-wider mb-1">
            <Sparkles size={14} />
            Lembrete Inteligente de Re-agendamento
          </div>
          <p className="text-zinc-300 text-xs leading-relaxed">
            Calcula a média de dias que cada cliente demora para voltar. Ideal para enviar uma mensagem no WhatsApp quando o corte estiver passando do tempo.
          </p>
          {overdueCount > 0 && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/20 border border-accent/40 text-accent-light text-xs font-medium">
              <AlertCircle size={13} />
              {overdueCount} cliente{overdueCount > 1 ? "s" : ""} com corte atrasado
            </div>
          )}
        </div>

        {/* Barra de Busca e Filtros */}
        <div className="space-y-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente ou telefone..."
              className="w-full h-10 rounded-lg bg-elevated border border-zinc-700 pl-9 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-accent touch-manipulation"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {[
              { id: "todos", label: "Todos" },
              { id: "atrasado", label: `Atrasados (${overdueCount})` },
              { id: "em_dia", label: "No prazo" },
              { id: "recente", label: "Recentes" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors touch-manipulation ${
                  filter === tab.id
                    ? "bg-accent text-white"
                    : "bg-surface border border-zinc-800 text-zinc-400 active:bg-elevated"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lista de Clientes */}
        {loading ? (
          <div className="space-y-2 py-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-surface animate-pulse" />
            ))}
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="text-center py-10 text-zinc-500 text-xs">
            Nenhum cliente encontrado com os filtros selecionados.
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
            {filteredClients.map((client) => {
              const isOverdue = client.status === "atrasado";
              return (
                <div
                  key={client.client_phone}
                  className={`p-3 rounded-xl border transition-all ${
                    isOverdue
                      ? "bg-red-950/20 border-red-900/40"
                      : "bg-surface border-zinc-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-semibold truncate">
                          {client.client_name}
                        </span>
                        {isOverdue && (
                          <span className="shrink-0 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-semibold">
                            +{client.days_overdue}d atrasado
                          </span>
                        )}
                      </div>

                      <p className="text-zinc-400 text-xs mt-0.5 flex items-center gap-1.5">
                        <Phone size={11} className="text-zinc-500" />
                        {client.client_phone}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400 mt-2">
                        <span>
                          Último corte:{" "}
                          <strong className="text-zinc-200">
                            há {client.days_since_last} dia{client.days_since_last !== 1 ? "s" : ""}
                          </strong>
                        </span>
                        <span>
                          Média de retorno:{" "}
                          <strong className="text-zinc-200">
                            {client.average_cycle_days ? `${client.average_cycle_days} dias` : "1ª visita"}
                          </strong>
                        </span>
                        <span>
                          Visitas: <strong className="text-zinc-200">{client.total_visits}</strong>
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleWhatsApp(client)}
                      title="Enviar lembrete pelo WhatsApp"
                      className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs font-semibold active:scale-95 transition-all touch-manipulation"
                    >
                      <MessageCircle size={14} />
                      Lembrar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
