"use client";

import { useEffect, useState } from "react";
import { Scissors, Check, Clock, Loader2, Sparkles, User } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { PrimaryButton } from "./FormField";
import { listServices } from "@/lib/actions/services";
import { updateAppointmentService } from "@/lib/actions/appointments";
import { cacheKeys, getCache, fetchWithCache } from "@/lib/admin-cache";
import { parseAppointmentNotes } from "./AddProductSheet";

function formatBRL(val) {
  return `R$ ${Number(val || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

export default function EditServiceSheet({ open, onClose, appointment, onSaved }) {
  const servicesKey = cacheKeys.services();
  const [services, setServices] = useState(() =>
    (getCache(servicesKey) || []).filter(
      (s) => s.is_active !== false && s.active !== false
    )
  );
  const [loading, setLoading] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !appointment) return;
    setError("");
    setSelectedServiceId(appointment.service_id || "");

    const cached = getCache(servicesKey);
    if (Array.isArray(cached) && cached.length > 0) {
      const activeCached = cached.filter(
        (s) => s.is_active !== false && s.active !== false
      );
      setServices(activeCached);
      setLoading(false);

      if (!appointment.service_id && appointment.service) {
        const matched = activeCached.find(
          (s) =>
            String(s.name || "").trim().toLowerCase() ===
            String(appointment.service || "").trim().toLowerCase()
        );
        if (matched) setSelectedServiceId(matched.id);
      }
    } else {
      setLoading(true);
    }

    fetchWithCache(servicesKey, async () => (await listServices()) || [], {
      ttlMs: 2 * 60 * 1000,
    })
      .then((data) => {
        const activeList = (data || []).filter(
          (s) => s.is_active !== false && s.active !== false
        );
        setServices(activeList);

        if (!appointment.service_id && appointment.service) {
          const matched = activeList.find(
            (s) =>
              String(s.name || "").trim().toLowerCase() ===
              String(appointment.service || "").trim().toLowerCase()
          );
          if (matched) {
            setSelectedServiceId(matched.id);
          }
        }
      })
      .catch(() => {
        if (!Array.isArray(cached)) {
          setError("Não foi possível carregar a lista de serviços.");
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, appointment?.id, appointment?.service_id, appointment?.service, servicesKey]);

  if (!appointment) return null;

  const barberId = appointment.barber_id || null;
  const barberName = appointment.barbers?.name || null;

  // Produtos vinculados ao agendamento (para manter a soma total fiel)
  const { products: attachedProducts } = parseAppointmentNotes(appointment.notes);
  const productsSubtotal = Number(
    attachedProducts.reduce((acc, item) => acc + Number(item.subtotal || 0), 0).toFixed(2)
  );

  // Calcula preço e duração de um serviço respeitando a tabela barber_services do profissional vinculado
  function resolveServiceForAppointment(service) {
    if (!service) {
      return {
        price: 0,
        duration: 30,
        hasCustomConfig: false,
      };
    }

    const defaultPrice = Number(service.price ?? service.normalized_price ?? 0);
    const defaultDuration = Number(
      service.default_duration_minutes ?? service.duration_minutes ?? 30
    );

    const barberCfg =
      barberId && service.barber_durations ? service.barber_durations[barberId] : null;

    const effectivePrice =
      barberCfg && barberCfg.custom_price !== null && barberCfg.custom_price !== undefined
        ? Number(barberCfg.custom_price)
        : defaultPrice;

    const effectiveDuration =
      barberCfg && barberCfg.custom_duration !== null && barberCfg.custom_duration !== undefined
        ? Number(barberCfg.custom_duration)
        : defaultDuration;

    const hasCustomConfig = Boolean(
      barberCfg &&
        (barberCfg.custom_price !== null || barberCfg.custom_duration !== null)
    );

    return {
      price: effectivePrice,
      duration: effectiveDuration,
      hasCustomConfig,
    };
  }

  const currentServiceName =
    appointment.services?.name || appointment.service || "Serviço atual";
  const currentTotal = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );

  const selectedService = services.find((s) => String(s.id) === String(selectedServiceId));
  const resolvedSelected = resolveServiceForAppointment(selectedService);
  const nextTotal = selectedService
    ? Number((resolvedSelected.price + productsSubtotal).toFixed(2))
    : currentTotal;

  const isUnchanged =
    Boolean(selectedServiceId) &&
    String(selectedServiceId) === String(appointment.service_id || "");

  async function handleConfirm() {
    if (!selectedServiceId) return;
    setSaving(true);
    setError("");

    try {
      const res = await updateAppointmentService({
        appointmentId: appointment.id,
        serviceId: selectedServiceId,
      });

      if (res?.error) {
        setError(res.error);
        setSaving(false);
        return;
      }

      if (onSaved) {
        onSaved(res);
      }
      onClose();
    } catch {
      setError("Não foi possível atualizar o serviço do atendimento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Editar Serviço do Atendimento">
      <div className="space-y-4">
        {/* Resumo do Cliente / Atendimento Atual */}
        <div className="flex items-center justify-between bg-elevated/70 border border-zinc-800 rounded-xl px-3.5 py-2.5">
          <div className="min-w-0 pr-2">
            <p className="text-white text-xs font-bold truncate">
              {appointment.client_name}
            </p>
            <p className="text-zinc-400 text-[11px] truncate">
              Atual: <span className="text-zinc-200 font-medium">{currentServiceName}</span>
            </p>
            {barberName && (
              <p className="text-zinc-500 text-[10.5px] flex items-center gap-1 mt-0.5">
                <User size={10} /> Profissional: {barberName}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className="text-[10px] text-zinc-500 block">Total atual</span>
            <span className="text-white font-bold text-xs">
              {formatBRL(currentTotal)}
            </span>
          </div>
        </div>

        {/* Instrução */}
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[11px] text-zinc-400">
            Selecione o serviço realizado pelo cliente:
          </span>
          {barberName && (
            <span className="text-[10px] text-zinc-500">
              Tabela de {barberName.split(" ")[0]}
            </span>
          )}
        </div>

        {/* Lista de Serviços Ativos */}
        {loading ? (
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <Loader2 size={20} className="animate-spin text-accent" />
            <span className="text-xs">Carregando serviços disponíveis…</span>
          </div>
        ) : services.length === 0 ? (
          <div className="py-6 text-center bg-surface border border-zinc-800 rounded-xl p-4">
            <Scissors size={22} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-white text-xs font-semibold">
              Nenhum serviço ativo encontrado
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
            {services.map((service) => {
              const isSelected = String(service.id) === String(selectedServiceId);
              const isCurrent =
                String(service.id) === String(appointment.service_id || "");
              const info = resolveServiceForAppointment(service);

              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => {
                    setError("");
                    setSelectedServiceId(service.id);
                  }}
                  className={`w-full rounded-xl border p-3 text-left transition-all touch-manipulation select-none flex items-center justify-between gap-3 ${
                    isSelected
                      ? "bg-accent/15 border-accent text-white shadow-sm"
                      : "bg-surface border-zinc-800 hover:border-zinc-700 text-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "border-accent bg-accent text-white"
                          : "border-zinc-700 bg-zinc-900/60"
                      }`}
                    >
                      {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate">
                          {service.name}
                        </span>
                        {isCurrent && (
                          <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                            Atual
                          </span>
                        )}
                        {info.hasCustomConfig && (
                          <span className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                            <Sparkles size={9} /> Personalizado
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-400">
                        <span className="inline-flex items-center gap-1">
                          <Clock size={11} className="text-zinc-500" />
                          ~{info.duration} min
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`text-xs font-bold ${
                        isSelected ? "text-emerald-400" : "text-white"
                      }`}
                    >
                      {formatBRL(info.price)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Resumo Financeiro da Alteração */}
        {selectedService && (
          <div className="bg-surface border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>
                Novo serviço ({selectedService.name} · ~{resolvedSelected.duration} min)
              </span>
              <span className="font-semibold text-zinc-200">
                {formatBRL(resolvedSelected.price)}
              </span>
            </div>

            {productsSubtotal > 0 && (
              <div className="flex items-center justify-between text-[11px] text-amber-300/90">
                <span>+ Produtos vinculados ({attachedProducts.length})</span>
                <span className="font-semibold">{formatBRL(productsSubtotal)}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
              <span className="text-xs text-zinc-300 font-medium">
                Novo total do atendimento
              </span>
              <span className="text-sm font-bold text-emerald-400">
                {formatBRL(nextTotal)}
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="text-rose-400 text-xs bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <PrimaryButton
          onClick={handleConfirm}
          disabled={saving || !selectedServiceId || isUnchanged}
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Atualizando serviço…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Scissors size={15} />
              <span>
                {isUnchanged
                  ? "Selecione outro serviço para alterar"
                  : "Confirmar Novo Serviço"}
              </span>
            </span>
          )}
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
