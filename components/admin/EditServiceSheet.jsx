"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Scissors,
  Check,
  Clock,
  Loader2,
  Sparkles,
  User,
  Phone,
  RefreshCw,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import { PrimaryButton } from "./FormField";
import { listServices } from "@/lib/actions/services";
import { updateAppointmentService } from "@/lib/actions/appointments";
import { cacheKeys, getCache, setCache } from "@/lib/admin-cache";
import { parseAppointmentNotes } from "./AddProductSheet";
import {
  getAppointmentStartTime,
  timeStrToMinutes,
  minutesToTimeStr,
} from "./AppointmentCard";

function formatBRL(val) {
  return `R$ ${Number(val || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

/**
 * Extrai a lista inicial de IDs de serviços vinculados ao agendamento:
 * 1. Usa `appointment.service_ids` (array de UUIDs) se disponível;
 * 2. Caso contrário, divide `appointment.service` por "+" (ex: "Corte + Sobrancelha + Barba")
 *    e faz o match pelo nome no catálogo ativo;
 * 3. Fallback para `[appointment.service_id]`.
 */
function extractInitialServiceIds(appointment, availableServices = []) {
  if (!appointment) return [];

  if (Array.isArray(appointment.service_ids) && appointment.service_ids.length > 0) {
    return Array.from(
      new Set(appointment.service_ids.map((id) => String(id).trim()).filter(Boolean))
    );
  }

  const rawText = String(appointment.service || appointment.services?.name || "").trim();
  const splitNames = rawText
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (splitNames.length > 0 && Array.isArray(availableServices) && availableServices.length > 0) {
    const matchedIds = [];
    for (const partName of splitNames) {
      const found = availableServices.find(
        (s) => String(s.name || "").trim().toLowerCase() === partName.toLowerCase()
      );
      if (found?.id && !matchedIds.includes(String(found.id))) {
        matchedIds.push(String(found.id));
      }
    }
    if (matchedIds.length > 0) {
      if (
        splitNames.length === 1 &&
        appointment.service_id &&
        !matchedIds.includes(String(appointment.service_id))
      ) {
        return [String(appointment.service_id)];
      }
      return matchedIds;
    }
  }

  if (appointment.service_id) {
    return [String(appointment.service_id)];
  }

  return [];
}

async function fetchServicesSafe() {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT_SERVICES")), 8000)
  );

  const fetchTask = (async () => {
    try {
      const res = await fetch("/api/services", {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data)) {
          return json.data;
        }
      }
    } catch {
      // Fallback para Server Action
    }
    const actionData = await listServices();
    return Array.isArray(actionData) ? actionData : [];
  })();

  return Promise.race([fetchTask, timeoutPromise]);
}

export default function EditServiceSheet({ open, onClose, appointment, onSaved }) {
  const servicesKey = cacheKeys.services();
  const [services, setServices] = useState(() =>
    (getCache(servicesKey) || []).filter(
      (s) => s && s.is_active !== false && s.active !== false
    )
  );
  const [loading, setLoading] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);
  const [initialServiceIds, setInitialServiceIds] = useState([]);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const userTouchedServicesRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadServices = useCallback(
    async ({ silent = false, apptSnapshot = null } = {}) => {
      if (!silent) {
        setLoading(true);
      }
      setError("");

      try {
        const rawData = await fetchServicesSafe();
        if (!mountedRef.current) return;

        const safeList = Array.isArray(rawData) ? rawData : [];
        const activeList = safeList.filter(
          (s) => s && s.is_active !== false && s.active !== false
        );

        setCache(servicesKey, safeList);
        setServices(activeList);

        if (apptSnapshot && !userTouchedServicesRef.current) {
          const resolvedIds = extractInitialServiceIds(apptSnapshot, activeList);
          setSelectedServiceIds(resolvedIds);
          setInitialServiceIds(resolvedIds);
        }
      } catch {
        if (!mountedRef.current) return;
        const cached = getCache(servicesKey);
        if (!Array.isArray(cached) || cached.length === 0) {
          setError("Não foi possível carregar a lista de serviços.");
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [servicesKey]
  );

  useEffect(() => {
    if (!open || !appointment) {
      setLoading(false);
      return;
    }

    userTouchedServicesRef.current = false;
    setError("");
    setClientName(appointment.client_name || "");
    const rawPhone = String(appointment.client_phone || "").replace(/\D/g, "");
    setClientPhone(rawPhone === "00000000000" ? "" : appointment.client_phone || "");

    const cached = getCache(servicesKey);
    if (Array.isArray(cached) && cached.length > 0) {
      const activeCached = cached.filter(
        (s) => s && s.is_active !== false && s.active !== false
      );
      setServices(activeCached);
      setLoading(false);

      const resolvedIds = extractInitialServiceIds(appointment, activeCached);
      setSelectedServiceIds(resolvedIds);
      setInitialServiceIds(resolvedIds);

      loadServices({
        silent: true,
        apptSnapshot: appointment,
      });
    } else {
      const fallbackIds = extractInitialServiceIds(appointment, []);
      setSelectedServiceIds(fallbackIds);
      setInitialServiceIds(fallbackIds);

      loadServices({
        silent: false,
        apptSnapshot: appointment,
      });
    }
  }, [open, appointment, servicesKey, loadServices]);

  const barberId = appointment?.barber_id || null;
  const barberName = appointment?.barbers?.name || null;

  // Calcula preço e duração de um serviço respeitando a tabela barber_services do profissional vinculado
  const resolveServiceForAppointment = useCallback(
    (service) => {
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
        barberCfg &&
        barberCfg.custom_duration !== null &&
        barberCfg.custom_duration !== undefined
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
    },
    [barberId]
  );

  // Lista ordenada dos objetos de serviço marcados em `selectedServiceIds`
  const selectedServicesList = useMemo(() => {
    return selectedServiceIds
      .map((id) => services.find((s) => String(s.id) === String(id)))
      .filter(Boolean);
  }, [selectedServiceIds, services]);

  if (!appointment) return null;

  // Produtos vinculados ao agendamento (para manter a soma total fiel)
  const { products: attachedProducts } = parseAppointmentNotes(appointment.notes);
  const productsSubtotal = Number(
    attachedProducts.reduce((acc, item) => acc + Number(item.subtotal || 0), 0).toFixed(2)
  );

  const currentServiceName =
    appointment.service || appointment.services?.name || "Serviço atual";
  const currentTotal = Number(
    appointment.total_price ?? appointment.price ?? appointment.services?.price ?? 0
  );

  // Soma dinâmica de preços e durações de TODOS os serviços selecionados
  const servicesSubtotal = Number(
    selectedServicesList
      .reduce((acc, svc) => acc + resolveServiceForAppointment(svc).price, 0)
      .toFixed(2)
  );
  const totalDurationMinutes = selectedServicesList.reduce(
    (acc, svc) => acc + resolveServiceForAppointment(svc).duration,
    0
  );
  const combinedServiceNames = selectedServicesList.map((s) => s.name).join(" + ");

  const nextTotal =
    selectedServicesList.length > 0
      ? Number((servicesSubtotal + productsSubtotal).toFixed(2))
      : currentTotal;

  const startTime = getAppointmentStartTime(appointment);
  const startMin = timeStrToMinutes(startTime);
  const previewEndTime =
    startMin !== null && totalDurationMinutes > 0
      ? minutesToTimeStr(startMin + totalDurationMinutes)
      : "";

  const origPhoneClean = String(appointment.client_phone || "").replace(/\D/g, "");
  const normalizedOrigPhone = origPhoneClean === "00000000000" ? "" : origPhoneClean;
  const currentPhoneClean = String(clientPhone || "").replace(/\D/g, "");

  const isServiceChanged =
    selectedServiceIds.length > 0 &&
    (selectedServiceIds.length !== initialServiceIds.length ||
      selectedServiceIds.some((id, idx) => String(id) !== String(initialServiceIds[idx])) ||
      (combinedServiceNames && combinedServiceNames !== currentServiceName));

  const isClientChanged =
    String(clientName || "").trim() !== String(appointment.client_name || "").trim() ||
    currentPhoneClean !== normalizedOrigPhone;

  const isUnchanged = !isServiceChanged && !isClientChanged;

  function handleToggleService(serviceId) {
    userTouchedServicesRef.current = true;
    setError("");
    const strId = String(serviceId);
    setSelectedServiceIds((prev) => {
      const exists = prev.some((id) => String(id) === strId);
      if (exists) {
        return prev.filter((id) => String(id) !== strId);
      }
      return [...prev, strId];
    });
  }

  async function handleConfirm() {
    if (selectedServiceIds.length === 0) {
      setError("Selecione pelo menos um serviço para o atendimento.");
      return;
    }
    setSaving(true);
    setError("");

    try {
      const res = await updateAppointmentService({
        appointmentId: appointment.id,
        serviceId: selectedServiceIds[0],
        serviceIds: selectedServiceIds,
        clientName: clientName.trim() || "Cliente",
        clientPhone: clientPhone.trim(),
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
      setError("Não foi possível atualizar os dados do atendimento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Editar Serviço & Dados do Cliente">
      <div className="space-y-4">
        {/* Resumo do Atendimento Atual */}
        <div className="flex items-center justify-between bg-[#070709] border border-zinc-800/90 rounded-xl px-3.5 py-2.5">
          <div className="min-w-0 pr-2">
            <p className="text-white text-xs font-bold truncate">
              {clientName || appointment.client_name || "Cliente"}
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
            <span className="text-white font-bold text-xs font-mono tabular-nums">
              {formatBRL(currentTotal)}
            </span>
          </div>
        </div>

        {/* Edição Direta dos Dados Cadastrais do Cliente (Nome + Telemóvel / Chave Primária) */}
        <div className="rounded-xl bg-[#070709] border border-zinc-800/90 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
              <User size={12} className="text-blue-400" />
              Dados Cadastrais do Cliente
            </span>
            <span className="text-[10px] text-zinc-500">
              Salva na base de Clientes
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Nome do cliente
              </label>
              <div className="relative">
                <User
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                />
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => {
                    setError("");
                    setClientName(e.target.value);
                  }}
                  placeholder="Ex: João Silva"
                  className="w-full h-10 rounded-lg bg-[#0d0d11] border border-zinc-800 pl-8 pr-3 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                Telemóvel / WhatsApp (Chave)
              </label>
              <div className="relative">
                <Phone
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                />
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => {
                    setError("");
                    setClientPhone(e.target.value);
                  }}
                  placeholder="(83) 99999-9999"
                  className="w-full h-10 rounded-lg bg-[#0d0d11] border border-zinc-800 pl-8 pr-3 text-xs font-mono tabular-nums text-white placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Instrução de Múltipla Seleção de Serviços */}
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-300 font-semibold">
              Selecione um ou mais serviços:
            </span>
            {selectedServiceIds.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-accent/20 border border-accent/40 text-accent-light font-mono tabular-nums text-[10px] font-bold">
                {selectedServiceIds.length}
              </span>
            )}
          </div>
          {barberName && (
            <span className="text-[10px] text-zinc-500">
              Tabela de {barberName.split(" ")[0]}
            </span>
          )}
        </div>

        {/* Lista de Serviços Ativos (Checkboxes Multi-Select) */}
        {loading ? (
          <div className="py-8 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <Loader2 size={20} className="animate-spin text-accent" />
            <span className="text-xs">Carregando serviços disponíveis…</span>
          </div>
        ) : services.length === 0 ? (
          <div className="py-6 text-center bg-surface border border-zinc-800 rounded-xl p-4 space-y-3">
            <Scissors size={22} className="mx-auto text-zinc-600" />
            <p className="text-white text-xs font-semibold">
              Nenhum serviço ativo encontrado
            </p>
            <button
              type="button"
              onClick={() =>
                loadServices({
                  silent: false,
                  apptSnapshot: appointment,
                })
              }
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-elevated border border-zinc-700 hover:border-zinc-600 px-3.5 py-2 text-xs font-semibold text-zinc-200 active:scale-95 transition-all"
            >
              <RefreshCw size={13} /> Tentar novamente
            </button>
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
            {services.map((service) => {
              const strId = String(service.id);
              const selectedIdx = selectedServiceIds.findIndex(
                (id) => String(id) === strId
              );
              const isSelected = selectedIdx !== -1;
              const isInitiallyAssigned = initialServiceIds.some(
                (id) => String(id) === strId
              );
              const info = resolveServiceForAppointment(service);

              return (
                <button
                  key={service.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  onClick={() => handleToggleService(service.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-all touch-manipulation select-none flex items-center justify-between gap-3 ${
                    isSelected
                      ? "bg-accent/15 border-accent text-white shadow-[0_0_14px_rgba(225,29,72,0.14)] ring-1 ring-accent/40"
                      : "bg-surface border-zinc-800 hover:border-zinc-700 text-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Checkbox Visual de Múltipla Escolha */}
                    <div
                      className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-all ${
                        isSelected
                          ? "border-accent bg-accent text-white shadow-sm"
                          : "border-zinc-700 bg-zinc-900/70"
                      }`}
                    >
                      {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-bold text-white truncate">
                          {service.name}
                        </span>
                        {selectedServiceIds.length > 1 && isSelected && (
                          <span className="text-[9.5px] font-mono tabular-nums font-bold px-1.5 py-0.5 rounded bg-accent/25 text-accent-light border border-accent/40">
                            #{selectedIdx + 1}
                          </span>
                        )}
                        {isInitiallyAssigned && (
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
                        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                          <Clock size={11} className="text-zinc-500" />
                          ~{info.duration} min
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`text-xs font-bold font-mono tabular-nums ${
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

        {/* Resumo Dinâmico de Preço, Duração Somada e Horário Previsto */}
        {selectedServicesList.length > 0 && (
          <div className="bg-surface border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="flex items-start justify-between gap-2 text-[11px] text-zinc-300">
              <div className="min-w-0">
                <span className="font-semibold text-white block truncate">
                  {combinedServiceNames}
                </span>
                <span className="text-zinc-400 font-mono tabular-nums text-[10.5px]">
                  {selectedServicesList.length}{" "}
                  {selectedServicesList.length === 1
                    ? "serviço marcado"
                    : "serviços marcados"}{" "}
                  · Duração total: ~{totalDurationMinutes} min
                  {startTime && previewEndTime
                    ? ` (${startTime} – ${previewEndTime})`
                    : ""}
                </span>
              </div>
              <span className="font-semibold text-zinc-100 font-mono tabular-nums shrink-0">
                {formatBRL(servicesSubtotal)}
              </span>
            </div>

            {selectedServicesList.length > 1 && (
              <div className="pt-1.5 border-t border-zinc-800/60 space-y-1">
                {selectedServicesList.map((svc) => {
                  const info = resolveServiceForAppointment(svc);
                  return (
                    <div
                      key={svc.id}
                      className="flex items-center justify-between text-[10.5px] text-zinc-400 font-mono tabular-nums"
                    >
                      <span className="truncate pr-2">
                        • {svc.name} ({info.duration} min)
                      </span>
                      <span className="shrink-0">{formatBRL(info.price)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {productsSubtotal > 0 && (
              <div className="flex items-center justify-between text-[11px] text-amber-300/90 pt-1 border-t border-zinc-800/60 font-mono tabular-nums">
                <span>+ Produtos vinculados ({attachedProducts.length})</span>
                <span className="font-semibold">{formatBRL(productsSubtotal)}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
              <span className="text-xs text-zinc-300 font-medium">
                Total do atendimento
              </span>
              <span className="text-sm font-bold text-emerald-400 font-mono tabular-nums">
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
          disabled={saving || selectedServiceIds.length === 0 || isUnchanged}
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Salvando alterações…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Scissors size={15} />
              <span>
                {selectedServiceIds.length === 0
                  ? "Selecione pelo menos 1 serviço"
                  : isUnchanged
                  ? "Altere o cliente ou os serviços para salvar"
                  : `Salvar Alterações (${selectedServiceIds.length} ${
                      selectedServiceIds.length === 1 ? "serviço" : "serviços"
                    })`}
              </span>
            </span>
          )}
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
