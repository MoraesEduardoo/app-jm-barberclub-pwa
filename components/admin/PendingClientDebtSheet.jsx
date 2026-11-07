"use client";

import { useState, useEffect, useRef } from "react";
import {
  AlertCircle,
  Calendar,
  Clock,
  Scissors,
  UserCheck,
  ChevronRight,
  ShoppingBag,
  Copy,
  Check,
  Wallet,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import { formatPhoneBR } from "@/lib/whatsapp";
import { extractProductsFromNotes } from "@/lib/commission";

function formatBRL(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

export function formatAppointmentDatePT(rawDate, includeYear = false) {
  if (!rawDate) return "Data não informada";
  const str = String(rawDate);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [y, m, d] = str.slice(0, 10).split("-");
    return includeYear ? `${d}/${m}/${y}` : `${d}/${m}`;
  }
  try {
    const dt = new Date(str);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        ...(includeYear ? { year: "numeric" } : {}),
        timeZone: "America/Fortaleza",
      });
    }
  } catch {
    // fallback
  }
  return str.slice(0, 10);
}

export function resolveServiceDescription(appointment) {
  if (!appointment) return "Atendimento";
  const fromRelation = appointment.services?.name;
  const fromColumn = appointment.service;
  return (fromRelation || fromColumn || "Serviço de Barbearia").trim();
}

/**
 * Agrupa os atendimentos não pagos por cliente, consolidando:
 * - Histórico completo de serviços pendentes do cliente
 * - Soma total da dívida acumulada (totalDebt)
 * - Soma total da comissão prevista (totalCommission)
 * - Profissionais responsáveis e resumo rápido para listagem
 */
export function groupPendingAppointmentsByClient(pendentes = []) {
  if (!Array.isArray(pendentes) || pendentes.length === 0) return [];

  const groups = [];
  const byPhone = new Map();
  const byClientId = new Map();
  const byName = new Map();

  for (const appt of pendentes) {
    const rawName = String(appt.client_name || "Cliente sem nome").trim();
    const normName = rawName.toLowerCase();
    const rawPhone = String(appt.client_phone || "").trim();
    const cleanPhone = rawPhone.replace(/\D/g, "");
    const validPhone =
      cleanPhone.length >= 8 && cleanPhone !== "00000000000" ? cleanPhone : "";
    const clientId = appt.client_id ? String(appt.client_id).trim() : "";

    let group = null;
    if (validPhone && byPhone.has(validPhone)) {
      group = byPhone.get(validPhone);
    } else if (clientId && byClientId.has(clientId)) {
      group = byClientId.get(clientId);
    } else if (normName && byName.has(normName)) {
      group = byName.get(normName);
    }

    if (!group) {
      const key =
        (validPhone ? `phone:${validPhone}` : null) ||
        (clientId ? `cid:${clientId}` : null) ||
        `name:${normName || appt.id}`;

      group = {
        key,
        clientId: clientId || null,
        clientName: rawName,
        clientPhone: rawPhone || "",
        cleanPhone: validPhone,
        appointments: [],
        totalDebt: 0,
        totalCommission: 0,
        barberNamesSet: new Set(),
        serviceNamesSet: new Set(),
      };
      groups.push(group);
    } else {
      if (!group.clientPhone && rawPhone && validPhone) {
        group.clientPhone = rawPhone;
        group.cleanPhone = validPhone;
      }
      if (!group.clientId && clientId) {
        group.clientId = clientId;
      }
    }

    if (validPhone) byPhone.set(validPhone, group);
    if (clientId) byClientId.set(clientId, group);
    if (normName) byName.set(normName, group);

    const amount = Number(
      appt.amount ?? appt.total_price ?? appt.price ?? appt.services?.price ?? 0
    );
    const commission = Number(
      appt.commission_amount ?? appt.barber_commission_amount ?? 0
    );

    group.appointments.push(appt);
    group.totalDebt = Number((group.totalDebt + amount).toFixed(2));
    group.totalCommission = Number(
      (group.totalCommission + commission).toFixed(2)
    );

    const barberName = appt.barbers?.name
      ? String(appt.barbers.name).trim().split(/\s+/)[0]
      : "";
    if (barberName) group.barberNamesSet.add(barberName);

    const svcName = resolveServiceDescription(appt);
    if (svcName) group.serviceNamesSet.add(svcName);
  }

  return groups
    .map((g) => {
      // Ordena os atendimentos do cliente do mais recente para o mais antigo
      const sortedAppts = [...g.appointments].sort((a, b) => {
        const dateA = String(a.appointment_date || "").slice(0, 10);
        const dateB = String(b.appointment_date || "").slice(0, 10);
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        const timeA = String(a.appointment_time || "").slice(0, 5);
        const timeB = String(b.appointment_time || "").slice(0, 5);
        return timeB.localeCompare(timeA);
      });

      const latestAppt = sortedAppts[0] || null;
      const latestDateLabel = latestAppt
        ? formatAppointmentDatePT(latestAppt.appointment_date, false)
        : "";

      const barberNames = Array.from(g.barberNamesSet);
      const serviceNames = Array.from(g.serviceNamesSet);

      return {
        key: g.key,
        clientId: g.clientId,
        clientName: g.clientName,
        clientPhone: g.clientPhone,
        cleanPhone: g.cleanPhone,
        appointments: sortedAppts,
        count: sortedAppts.length,
        totalDebt: g.totalDebt,
        totalCommission: g.totalCommission,
        barberNames,
        serviceNames,
        latestDateLabel,
      };
    })
    .sort((a, b) => {
      if (b.totalDebt !== a.totalDebt) return b.totalDebt - a.totalDebt;
      return b.count - a.count;
    });
}

/**
 * Linha/Card de Cliente Agrupado exibido na aba "Quem não pagou"
 */
export function PendingClientRow({ group, onSelect }) {
  if (!group) return null;

  const initial = (group.clientName || "C").trim().charAt(0).toUpperCase() || "C";
  const barbersLabel =
    group.barberNames.length > 0 ? group.barberNames.join(", ") : "";
  const servicesPreview =
    group.serviceNames.length > 0
      ? group.serviceNames.slice(0, 2).join(" + ")
      : "Atendimento";

  return (
    <button
      type="button"
      onClick={() => onSelect?.(group)}
      className="w-full text-left flex items-center justify-between gap-3 bg-[#09090d] hover:bg-zinc-900/90 border border-zinc-800/95 hover:border-zinc-700 rounded-2xl px-4 py-3.5 transition-all active:scale-[0.99] touch-manipulation select-none group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-xl bg-accent/15 border border-accent/35 flex items-center justify-center text-accent-light font-extrabold text-sm shrink-0">
          {initial}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-white text-sm font-bold truncate">
              {group.clientName}
            </p>
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 border border-amber-500/35 text-amber-300 whitespace-nowrap">
              {group.count === 1
                ? "1 serviço pendente"
                : `${group.count} serviços pendentes`}
            </span>
          </div>

          <p className="text-zinc-400 text-xs truncate mt-0.5">
            {servicesPreview}
            {barbersLabel ? ` · Prof: ${barbersLabel}` : ""}
            {group.latestDateLabel ? ` · Último: ${group.latestDateLabel}` : ""}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <div className="text-right">
          <p className="font-mono tabular-nums font-extrabold text-sm sm:text-base text-accent-light leading-tight">
            {formatBRL(group.totalDebt)}
          </p>
          <p className="text-[11px] text-zinc-400 font-medium mt-0.5">
            Ver detalhes
          </p>
        </div>
        <div className="h-7 w-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-white group-hover:border-zinc-700 transition-colors">
          <ChevronRight size={15} />
        </div>
      </div>
    </button>
  );
}

/**
 * Modal / BottomSheet de Visualização Detalhada das Pendências do Cliente
 */
export default function PendingClientDebtSheet({
  open,
  onClose,
  clientGroup,
  onSelectPayment,
}) {
  const [copiedPhone, setCopiedPhone] = useState(false);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setCopiedPhone(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    }
  }, [open, clientGroup?.key]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (!clientGroup) return null;

  const formattedPhone = formatPhoneBR(clientGroup.clientPhone);
  const initial =
    (clientGroup.clientName || "C").trim().charAt(0).toUpperCase() || "C";

  async function handleCopyPhone() {
    const textToCopy =
      formattedPhone || String(clientGroup.clientPhone || "").trim();
    if (!textToCopy) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
    } catch {
      // Fallback silencioso
    }

    setCopiedPhone(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setCopiedPhone(false);
    }, 1500);
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={`Pendências · ${clientGroup.clientName}`}
    >
      <div className="space-y-4">
        {/* Bloco Superior: Identificação do Cliente + Soma Total da Dívida Acumulada */}
        <div className="rounded-2xl bg-[#07070a] border border-zinc-800/95 p-4 space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-11 w-11 rounded-xl bg-accent/15 border border-accent/35 flex items-center justify-center text-accent-light font-extrabold text-base shrink-0">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="text-white font-bold text-sm sm:text-base leading-tight truncate">
                  {clientGroup.clientName}
                </p>
                {formattedPhone ? (
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    title="Clique para copiar o telefone"
                    className={`mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 -ml-2 rounded-lg text-xs font-mono transition-all touch-manipulation select-none active:scale-95 ${
                      copiedPhone
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold"
                        : "text-zinc-300 hover:text-white hover:bg-zinc-900 border border-transparent hover:border-zinc-800"
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
                        <Copy size={11} className="text-zinc-500 shrink-0" />
                      </>
                    )}
                  </button>
                ) : (
                  <p className="text-zinc-400 text-xs mt-0.5">
                    Cliente com débito em aberto
                  </p>
                )}
              </div>
            </div>

            <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-300 text-xs font-bold">
              <AlertCircle size={13} />
              {clientGroup.count}{" "}
              {clientGroup.count === 1 ? "pendência" : "pendências"}
            </span>
          </div>

          {/* Card de Destaque da Dívida Total Acumulada */}
          <div className="rounded-xl border border-accent/35 bg-gradient-to-r from-[#170609] via-[#0e080b] to-[#09090d] p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                Dívida Total Acumulada
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Soma de {clientGroup.count}{" "}
                {clientGroup.count === 1
                  ? "serviço não pago"
                  : "serviços não pagos"}
              </p>
            </div>

            <div className="text-right shrink-0">
              <p className="font-mono tabular-nums text-xl font-extrabold text-accent-light leading-none">
                {formatBRL(clientGroup.totalDebt)}
              </p>
              {clientGroup.totalCommission > 0 && (
                <p className="font-mono tabular-nums text-[11px] text-zinc-300 mt-1">
                  Comissão: {formatBRL(clientGroup.totalCommission)}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Lista de Histórico de Serviços Realizados e Ainda Não Pagos */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              Histórico de Serviços Não Pagos
            </h3>
            <span className="text-[11px] text-zinc-400 font-medium">
              {clientGroup.count}{" "}
              {clientGroup.count === 1 ? "registro" : "registros"}
            </span>
          </div>

          <div className="space-y-2.5">
            {clientGroup.appointments.map((appt) => {
              const dateLabel = formatAppointmentDatePT(
                appt.appointment_date,
                true
              );
              const timeLabel = appt.appointment_time
                ? String(appt.appointment_time).slice(0, 5)
                : "";
              const serviceDesc = resolveServiceDescription(appt);
              const barberName =
                appt.barbers?.name || "Profissional da barbearia";
              const totalVal = Number(
                appt.amount ??
                  appt.total_price ??
                  appt.price ??
                  appt.services?.price ??
                  0
              );
              const commissionVal = Number(
                appt.commission_amount ?? appt.barber_commission_amount ?? 0
              );
              const productItems =
                Array.isArray(appt.product_items) && appt.product_items.length > 0
                  ? appt.product_items
                  : extractProductsFromNotes(appt.notes).items;

              return (
                <div
                  key={appt.id}
                  className="rounded-xl bg-[#09090d] border border-zinc-800/95 p-3.5 space-y-2.5"
                >
                  {/* Topo do Item: Data/Hora + Valor */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-700/80 font-mono tabular-nums text-[11px] font-semibold text-zinc-200">
                        <Calendar size={11} className="text-accent-light" />
                        {dateLabel}
                      </span>
                      {timeLabel && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 font-mono tabular-nums text-[11px] font-medium text-zinc-300">
                          <Clock size={11} className="text-zinc-400" />
                          {timeLabel}
                        </span>
                      )}
                    </div>

                    <span className="font-mono tabular-nums text-sm font-extrabold text-accent-light shrink-0">
                      {formatBRL(totalVal)}
                    </span>
                  </div>

                  {/* Meio: Descrição do Serviço + Produtos + Profissional Responsável */}
                  <div className="space-y-1.5 pt-0.5">
                    <div className="flex items-start gap-2">
                      <Scissors
                        size={14}
                        className="text-accent-light shrink-0 mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-xs sm:text-sm font-bold leading-snug">
                          {serviceDesc}
                        </p>
                        {productItems.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {productItems.map((prod) => (
                              <p
                                key={prod.key}
                                className="text-[11px] text-emerald-300 flex items-center gap-1 font-medium"
                              >
                                <ShoppingBag size={11} className="shrink-0" />
                                <span>{prod.label}</span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/80 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-zinc-300 font-medium truncate">
                        <UserCheck size={13} className="text-blue-400 shrink-0" />
                        <span>
                          Profissional:{" "}
                          <strong className="text-white font-semibold">
                            {barberName}
                          </strong>
                        </span>
                      </span>

                      {commissionVal > 0 && (
                        <span className="font-mono tabular-nums text-[11px] text-zinc-400 shrink-0">
                          Comissão: {formatBRL(commissionVal)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Rodapé de Ação Rápida para Dar Baixa no Pagamento */}
                  {onSelectPayment && (
                    <div className="pt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onSelectPayment(appt)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-xs font-bold transition-all active:scale-95 touch-manipulation"
                      >
                        <Wallet size={13} />
                        <span>Registrar pagamento</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
