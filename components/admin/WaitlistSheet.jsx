"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Clock,
  UserPlus,
  Trash2,
  CheckCircle2,
  MessageCircle,
  Phone,
  Calendar,
  AlertCircle,
  Plus,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import {
  listWaitlist,
  addToWaitlist,
  updateWaitlistStatus,
  deleteWaitlistEntry,
} from "@/lib/actions/waitlist";
import { listServices } from "@/lib/actions/services";
import { toast } from "@/lib/toast";
import ConfirmDialog from "./ConfirmDialog";

export default function WaitlistSheet({
  open,
  onClose,
  date,
  barber,
  team = [],
  canPickBarber = false,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingNew, setAddingNew] = useState(false);
  const [services, setServices] = useState([]);

  // Campos do formulário de novo cliente na lista
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [desiredTime, setDesiredTime] = useState("");
  const [selectedBarberId, setSelectedBarberId] = useState(barber?.id || "");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const loadWaitlist = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWaitlist({
        date,
        barberId: canPickBarber ? null : barber?.id,
        status: "todos",
      });
      setItems(res?.data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [date, canPickBarber, barber?.id]);

  useEffect(() => {
    if (open) {
      loadWaitlist();
      listServices().then(setServices).catch(() => {});
    }
  }, [open, loadWaitlist]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!clientName.trim() || !clientPhone.trim()) {
      toast.error("Preencha nome e WhatsApp do cliente.");
      return;
    }

    setSaving(true);
    try {
      const res = await addToWaitlist({
        client_name: clientName,
        client_phone: clientPhone,
        desired_date: date,
        desired_time: desiredTime,
        barber_id: selectedBarberId || barber?.id,
        service_id: selectedServiceId || null,
        notes,
      });

      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success("Cliente adicionado à fila de espera!");
        setAddingNew(false);
        setClientName("");
        setClientPhone("");
        setDesiredTime("");
        setNotes("");
        loadWaitlist();
      }
    } catch {
      toast.error("Erro ao adicionar cliente à lista de espera.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id, newStatus) {
    try {
      await updateWaitlistStatus(id, newStatus);
      toast.success(
        newStatus === "atendido"
          ? "Cliente marcado como atendido!"
          : newStatus === "notificado"
          ? "Marcado como notificado!"
          : "Status atualizado."
      );
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item)));
    } catch {
      toast.error("Erro ao atualizar status.");
    }
  }

  const [itemToDelete, setItemToDelete] = useState(null);

  function handleDelete(item) {
    setItemToDelete(item);
  }

  async function confirmDeleteItem() {
    if (!itemToDelete) return;
    const id = itemToDelete.id;
    try {
      await deleteWaitlistEntry(id);
      toast.success("Removido da lista de espera.");
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      toast.error("Erro ao remover registro.");
    } finally {
      setItemToDelete(null);
    }
  }

  function handleNotifyWhatsApp(item) {
    const cleanPhone = item.client_phone.replace(/\D/g, "");
    const firstName = item.client_name.split(" ")[0] || "amigo";
    const timeText = item.desired_time ? `por volta das ${item.desired_time}` : "para hoje";
    const msg = encodeURIComponent(
      `Olá, ${firstName}! Aqui é da JM Barberclub. Surgiu uma vaga na nossa agenda para hoje (${date}) ${timeText}. Você ainda tem interesse no horário? Responda aqui para confirmarmos imediatamente!`
    );
    window.open(`https://wa.me/55${cleanPhone}?text=${msg}`, "_blank");
    handleStatusChange(item.id, "notificado");
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Lista de Espera (Waitlist)">
      <div className="space-y-4">
        {/* Cabeçalho de Ações */}
        <div className="flex items-center justify-between">
          <p className="text-zinc-400 text-xs">
            Clientes aguardando encaixe em <strong className="text-white">{date}</strong>
          </p>
          <button
            type="button"
            onClick={() => setAddingNew((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold active:scale-95 transition-all touch-manipulation"
          >
            <Plus size={14} />
            {addingNew ? "Fechar formulário" : "Novo encaixe"}
          </button>
        </div>

        {/* Formulário de Inclusão Rápida */}
        {addingNew && (
          <form
            onSubmit={handleCreate}
            className="bg-surface border border-zinc-800 rounded-xl p-3.5 space-y-3 animate-in fade-in slide-in-from-top-2"
          >
            <h4 className="text-white text-xs font-semibold">Adicionar cliente à fila</h4>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Nome do Cliente *</label>
                <input
                  type="text"
                  required
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Ex: João Silva"
                  className="w-full h-9 rounded-lg bg-elevated border border-zinc-700 px-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">WhatsApp *</label>
                <input
                  type="tel"
                  required
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="DDD + Número"
                  className="w-full h-9 rounded-lg bg-elevated border border-zinc-700 px-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Horário Desejado</label>
                <input
                  type="time"
                  value={desiredTime}
                  onChange={(e) => setDesiredTime(e.target.value)}
                  className="w-full h-9 rounded-lg bg-elevated border border-zinc-700 px-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Serviço de Interesse</label>
                <select
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                  className="w-full h-9 rounded-lg bg-elevated border border-zinc-700 px-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Qualquer serviço</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {canPickBarber && team.length > 0 && (
              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Barbeiro Preferido</label>
                <select
                  value={selectedBarberId}
                  onChange={(e) => setSelectedBarberId(e.target.value)}
                  className="w-full h-9 rounded-lg bg-elevated border border-zinc-700 px-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Qualquer profissional disponível</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Observações (opcional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: Pode vir após as 17h"
                className="w-full h-9 rounded-lg bg-elevated border border-zinc-700 px-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAddingNew(false)}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar na fila"}
              </button>
            </div>
          </form>
        )}

        {/* Listagem dos Clientes na Espera */}
        {loading ? (
          <div className="space-y-2 py-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-surface animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-10 bg-surface/50 border border-zinc-800/60 rounded-xl p-4">
            <Clock size={28} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-zinc-400 text-xs font-medium">Nenhum cliente na fila de espera para esta data.</p>
            <p className="text-zinc-600 text-[11px] mt-1">
              Cadastre clientes interessados em caso de cancelamento de horário.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {items.map((item) => {
              const isWaiting = item.status === "aguardando";
              const isNotified = item.status === "notificado";
              const isServed = item.status === "atendido";

              return (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border transition-all ${
                    isServed
                      ? "bg-zinc-900/30 border-zinc-800 opacity-60"
                      : isNotified
                      ? "bg-amber-950/20 border-amber-900/40"
                      : "bg-surface border-zinc-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-semibold truncate">
                          {item.client_name}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            isWaiting
                              ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                              : isNotified
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 mt-1">
                        <span className="flex items-center gap-1">
                          <Phone size={11} className="text-zinc-500" />
                          {item.client_phone}
                        </span>
                        {item.desired_time && (
                          <span className="flex items-center gap-1 text-zinc-300">
                            <Clock size={11} className="text-accent" />
                            {item.desired_time}
                          </span>
                        )}
                        {item.services?.name && <span>{item.services.name}</span>}
                        {item.barbers?.name && <span>com {item.barbers.name}</span>}
                      </div>

                      {item.notes && (
                        <p className="text-[11px] text-zinc-400 mt-1.5 italic bg-elevated/60 px-2 py-1 rounded">
                          &quot;{item.notes}&quot;
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleNotifyWhatsApp(item)}
                        title="Avisar vaga liberada por WhatsApp"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 text-xs font-semibold active:scale-95 transition-all touch-manipulation"
                      >
                        <MessageCircle size={13} />
                        Avisar
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleStatusChange(item.id, isServed ? "aguardando" : "atendido")
                        }
                        title="Marcar como atendido"
                        className="p-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white active:bg-zinc-800"
                      >
                        <CheckCircle2 size={15} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        title="Remover da fila"
                        className="p-1.5 rounded-lg border border-zinc-700 text-zinc-500 hover:text-red-400 active:bg-zinc-800"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(itemToDelete)}
        title="Remover da lista de espera?"
        description={
          itemToDelete
            ? `Deseja remover ${itemToDelete.client_name || "este cliente"} da fila de espera de hoje?`
            : ""
        }
        confirmLabel="Remover da Fila"
        cancelLabel="Cancelar"
        variant="danger"
        onConfirm={confirmDeleteItem}
        onCancel={() => setItemToDelete(null)}
      />
    </BottomSheet>
  );
}
