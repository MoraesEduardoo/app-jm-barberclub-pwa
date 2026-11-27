"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Handshake,
  Search,
  Plus,
  CheckCircle2,
  AlertTriangle,
  X,
  UserCheck,
  UserX,
  Phone,
  FileText,
  Loader2,
  ShieldAlert,
  Tag,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import {
  listActiveBarterClients,
  searchClientsForBarter,
  setClientBarterStatus,
  revokeClientBarter,
} from "@/lib/actions/barter";
import { toast } from "@/lib/toast";

const BARTER_CATEGORIES = [
  "Academia",
  "Lava jato",
  "Iptv",
  "Consertos para barbearia",
  "Outro",
];

function formatPhoneDisplay(phone) {
  if (!phone) return "";
  const d = String(phone).replace(/\D/g, "");
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return phone;
}

export default function BarterManagementSheet({ open, onClose }) {
  const [activePartners, setActivePartners] = useState([]);
  const [loading, setLoading] = useState(true);

  // Estados de busca de cliente
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Cliente selecionado ou novo para cadastrar
  const [selectedClient, setSelectedClient] = useState(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [barterCategory, setBarterCategory] = useState("Academia");
  const [customCategory, setCustomCategory] = useState("");
  const [barterNotes, setBarterNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Confirmação para revogar
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listActiveBarterClients();
      setActivePartners(list);
    } catch (err) {
      toast.error(err.message || "Erro ao carregar parceiros de permuta.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadPartners();
      setSearchTerm("");
      setSearchResults([]);
      setSelectedClient(null);
      setNewName("");
      setNewPhone("");
      setBarterCategory("Academia");
      setCustomCategory("");
      setBarterNotes("");
    }
  }, [open, loadPartners]);

  // Busca debounced de clientes
  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchClientsForBarter(term);
        setSearchResults(results);
      } catch (err) {
        console.error("Erro na busca de clientes:", err);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  function handleSelectExistingClient(client) {
    setSelectedClient(client);
    setNewName(client.name || "");
    setNewPhone(client.phone || client.clean_phone || "");
    const cat = client.barter_category || "";
    if (BARTER_CATEGORIES.slice(0, 4).includes(cat)) {
      setBarterCategory(cat);
      setCustomCategory("");
    } else if (cat) {
      setBarterCategory("Outro");
      setCustomCategory(cat);
    } else {
      setBarterCategory("Academia");
      setCustomCategory("");
    }
    setBarterNotes(client.barter_notes || "");
    setSearchTerm("");
    setSearchResults([]);
  }

  function handleClearSelection() {
    setSelectedClient(null);
    setNewName("");
    setNewPhone("");
    setBarterCategory("Academia");
    setCustomCategory("");
    setBarterNotes("");
  }

  async function handleSaveBarter(e) {
    e.preventDefault();
    if (!newName.trim() && !selectedClient) {
      toast.error("Informe o nome do cliente parceiro.");
      return;
    }
    if (!newPhone.trim()) {
      toast.error("Informe o telefone/WhatsApp do cliente.");
      return;
    }

    const effectiveCategory =
      barterCategory === "Outro"
        ? (customCategory.trim() || "Outro")
        : (barterCategory || "Academia");

    setSaving(true);
    try {
      await setClientBarterStatus({
        clientId: selectedClient?.id || null,
        name: newName.trim(),
        phone: newPhone.trim(),
        barterCategory: effectiveCategory,
        barterNotes: barterNotes.trim(),
        isBarter: true,
      });

      toast.success(
        selectedClient
          ? `Permuta atualizada para ${selectedClient.name}!`
          : `Novo parceiro de permuta cadastrado!`
      );
      handleClearSelection();
      loadPartners();
    } catch (err) {
      toast.error(err.message || "Falha ao salvar permuta.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget?.id) return;
    setRevoking(true);
    try {
      await revokeClientBarter(revokeTarget.id);
      toast.success(`Permuta de ${revokeTarget.name} encerrada com sucesso.`);
      setRevokeTarget(null);
      loadPartners();
    } catch (err) {
      toast.error(err.message || "Falha ao encerrar permuta.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={() => onClose(null)} title="Troca de Serviço (Permuta)">
      <div className="space-y-4 pb-2">
        {/* Aviso de Regra de Negócio: Exclusividade do Matheus */}
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-3 flex items-start gap-2.5">
          <Handshake size={18} className="text-purple-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5 min-w-0">
            <p className="font-semibold text-purple-200">
              Exclusivo para o Matheus (Chefe / Owner)
            </p>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              Agendamentos com o Matheus para parceiros ativos são marcados automaticamente como <strong className="text-purple-300">Permuta</strong>: bloqueiam o horário na agenda sem gerar cobrança ou entrada monetária no caixa. Atendimentos com o William continuam normais.
            </p>
          </div>
        </div>

        {/* Formulário: Ativar / Adicionar Parceiro de Permuta */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-3.5 space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between">
            <span>{selectedClient ? "Editar Acordo de Permuta" : "Ativar Nova Permuta"}</span>
            {selectedClient && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="text-[10px] text-zinc-400 hover:text-white underline"
              >
                Limpar seleção
              </button>
            )}
          </h3>

          {/* Campo de Busca Rápida de Cliente Existente */}
          {!selectedClient && (
            <div className="relative">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar cliente existente por nome ou telefone…"
                  className="w-full h-9 pl-9 pr-3 rounded-xl bg-black border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                {searching && (
                  <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-400" />
                )}
              </div>

              {/* Resultados da Busca em Dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-10 z-20 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl max-h-48 overflow-y-auto">
                  {searchResults.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => handleSelectExistingClient(client)}
                      className="w-full p-2.5 text-left border-b border-zinc-900 hover:bg-zinc-900 flex items-center justify-between gap-2 transition-colors"
                    >
                      <div>
                        <p className="text-xs font-semibold text-white">{client.name}</p>
                        <p className="text-[10px] text-zinc-400 font-mono">
                          {formatPhoneDisplay(client.phone || client.clean_phone)}
                        </p>
                      </div>
                      {client.is_barter ? (
                        <span className="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded font-semibold">
                          Permuta Ativa
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-500">Selecionar</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Campos do Parceiro */}
          <form onSubmit={handleSaveBarter} className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Nome do Parceiro
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Carlos Academia Fit"
                  className="w-full h-9 px-3 rounded-xl bg-black border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Telefone / WhatsApp
                </label>
                <input
                  type="tel"
                  required
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="(83) 98888-7777"
                  className="w-full h-9 px-3 rounded-xl bg-black border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Categoria da Permuta (Pills Rápidas) */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-medium text-zinc-400">
                Categoria da Troca
              </label>
              <div className="flex flex-wrap gap-1.5">
                {BARTER_CATEGORIES.map((cat) => {
                  const isSelected = barterCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setBarterCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all touch-manipulation select-none active:scale-95 ${
                        isSelected
                          ? "bg-purple-600 text-white shadow-sm shadow-purple-900/50 border border-purple-500"
                          : "bg-black border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>

              {/* Se "Outro", abre campo para digitar o nome da categoria personalizada */}
              {barterCategory === "Outro" && (
                <div className="pt-1 animate-in fade-in-50 duration-150">
                  <input
                    type="text"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="Especifique a categoria (ex: Dentista, Contabilidade, etc.)"
                    className="w-full h-9 px-3 rounded-xl bg-black border border-purple-500/50 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-zinc-400">
                  Observação do Acordo <span className="text-zinc-600 font-normal">(opcional)</span>
                </label>
              </div>
              <input
                type="text"
                value={barterNotes}
                onChange={(e) => setBarterNotes(e.target.value)}
                placeholder="Ex: Válido até dez/2026, 1 corte por mês, etc."
                className="w-full h-9 px-3 rounded-xl bg-black border border-zinc-800 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-purple-950/40 active:scale-95 transition-all disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Salvando…
                </>
              ) : (
                <>
                  <UserCheck size={14} />
                  <span>{selectedClient ? "Salvar Alterações da Permuta" : "Ativar Permuta para este Cliente"}</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Lista de Parceiros Ativos */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
              Parceiros com Permuta Ativa ({activePartners.length})
            </h3>
            <button
              type="button"
              onClick={loadPartners}
              className="text-[11px] text-purple-400 hover:underline"
            >
              Atualizar
            </button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-zinc-900 animate-pulse" />
              ))}
            </div>
          ) : activePartners.length === 0 ? (
            <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-6 text-center text-zinc-500 text-xs space-y-1">
              <Handshake size={28} className="mx-auto text-zinc-600 mb-1 opacity-70" />
              <p className="font-semibold text-zinc-400">Nenhuma permuta ativa no momento.</p>
              <p className="text-[11px]">
                Busque um cliente acima para cadastrar um novo acordo de troca de serviço.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
              {activePartners.map((partner) => (
                <div
                  key={partner.id}
                  className="bg-zinc-950 border border-purple-500/30 rounded-xl p-3 flex items-start justify-between gap-3 shadow-sm hover:border-purple-500/50 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-white text-xs truncate">
                        {partner.name}
                      </span>
                      <span className="text-[9.5px] bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/40 rounded px-1.5 py-0.2">
                        {partner.barter_category ? `Permuta · ${partner.barter_category}` : "Permuta"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1 font-mono text-zinc-300">
                        <Phone size={10} className="text-zinc-500" />
                        {formatPhoneDisplay(partner.phone || partner.clean_phone)}
                      </span>
                    </div>

                    {partner.barter_notes && (
                      <p className="text-[11px] text-purple-200/90 bg-purple-950/30 border border-purple-900/50 rounded-lg px-2 py-1 leading-tight">
                        💬 {partner.barter_notes}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0 pt-0.5">
                    <button
                      type="button"
                      onClick={() => handleSelectExistingClient(partner)}
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-semibold active:scale-95 transition-all"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(partner)}
                      className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[10px] font-semibold active:scale-95 transition-all"
                    >
                      Encerrar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal de Confirmação para Encerrar Permuta */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <div className="flex items-center gap-2 text-rose-400">
                <ShieldAlert size={18} />
                <h4 className="text-sm font-bold text-white">Encerrar Permuta?</h4>
              </div>
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="text-zinc-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Deseja realmente desativar a permuta de <strong className="text-white">{revokeTarget.name}</strong>?
            </p>
            <p className="text-[11px] text-zinc-500">
              O histórico anterior é 100% preservado. Futuros agendamentos voltarão a ser cobrados normalmente.
            </p>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="flex-1 py-2 rounded-xl border border-zinc-800 text-xs text-zinc-400 hover:text-white font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={revoking}
                onClick={handleConfirmRevoke}
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-1 active:scale-95 transition-all"
              >
                {revoking ? <Loader2 size={13} className="animate-spin" /> : <UserX size={13} />}
                <span>Encerrar Permuta</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
