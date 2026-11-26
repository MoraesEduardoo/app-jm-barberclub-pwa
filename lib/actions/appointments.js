"use server"

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { hasPermission, isChefe, PERMISSION_KEYS } from "@/lib/auth";
import { notifyNewAppointment, notifyCancelledAppointment } from "@/lib/push";
import { executeAppointmentCancellation } from "@/lib/cancellation";
import { shopRange, SHOP_UTC_OFFSET, todayInShop } from "@/lib/dates";
import { galleryPublicUrl } from "@/lib/gallery-url";
import { listSchedule, listExceptions } from "@/lib/actions/schedule";
import { dayOfWeekFromDate } from "@/lib/constants/schedule";
import {
  generateAvailableSlots,
  generateFullDaySlotsWithStatus,
  roundUpToNextSlot,
  extractBusyRangesFromAppointments,
} from "@/lib/slots";
import {
  calculateAppointmentFinance,
  sumAttachedProductsFromNotes,
  isConvenienceProduct,
  isOwnerBarber,
} from "@/lib/commission";

function dayRange(date) {
  return shopRange(date, date);
}

function addMinutesToTimeStr(timeStr, minutesToAdd) {
  const parts = String(timeStr || "09:00:00").split(":").map(Number);
  const totalMin = (parts[0] || 0) * 60 + (parts[1] || 0) + (Number(minutesToAdd) || 30);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

/**
 * Regista ou atualiza o cliente na tabela `public.clients` utilizando o número de telemóvel
 * (`phone` normalizado apenas com dígitos) como chave primária / identificador único principal.
 * Garante que qualquer cliente de encaixe rápido ou agendamento fique salvo imediatamente
 * na aba de Clientes para futuras consultas.
 */
async function upsertClientByPhone(fallbackSupabase, { name, phone, existingClientId = null }) {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    let db = fallbackSupabase;
    try {
      db = createAdminClient();
    } catch {
      db = fallbackSupabase;
    }

    const cleanPhone = String(phone || "").replace(/\D/g, "");
    const cleanName = String(name || "").trim();
    const effectiveName = cleanName || "Cliente avulso";
    const hasValidPhone = cleanPhone.length >= 8 && cleanPhone !== "00000000000";

    if (hasValidPhone) {
      // 1. Procura registo existente pelo telefone limpo (chave principal) ou pelo client_id
      const { data: existingRows } = await db
        .from("clients")
        .select("id, name, phone")
        .or(
          existingClientId
            ? `phone.eq.${cleanPhone},id.eq.${existingClientId}`
            : `phone.eq.${cleanPhone}`
        )
        .limit(5);

      const matchedByPhone = (existingRows || []).find(
        (r) => String(r.phone || "").replace(/\D/g, "") === cleanPhone
      );
      const targetRow = matchedByPhone || (existingRows && existingRows[0]) || null;

      if (targetRow?.id) {
        const nextName =
          cleanName &&
          cleanName.toLowerCase() !== "cliente" &&
          cleanName.toLowerCase() !== "cliente avulso"
            ? cleanName
            : targetRow.name || effectiveName;

        await db
          .from("clients")
          .update({
            name: nextName,
            phone: cleanPhone,
            updated_at: new Date().toISOString(),
          })
          .eq("id", targetRow.id);

        return { clientId: targetRow.id, cleanPhone, clientName: nextName };
      }

      // 2. Upsert direto usando phone como conflito único
      const { data: upserted, error: upsertErr } = await db
        .from("clients")
        .upsert(
          {
            name: effectiveName,
            phone: cleanPhone,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "phone" }
        )
        .select("id, name, phone")
        .maybeSingle();

      if (!upsertErr && upserted?.id) {
        return { clientId: upserted.id, cleanPhone, clientName: upserted.name || effectiveName };
      }

      // Fallback insert caso a constraint UNIQUE(phone) ainda não tenha sido aplicada
      const { data: inserted } = await db
        .from("clients")
        .insert({
          name: effectiveName,
          phone: cleanPhone,
          updated_at: new Date().toISOString(),
        })
        .select("id, name, phone")
        .maybeSingle();

      return {
        clientId: inserted?.id || existingClientId || null,
        cleanPhone,
        clientName: effectiveName,
      };
    }

    // Se o barbeiro editou apenas o nome de um cliente já vinculado por ID
    if (existingClientId && cleanName) {
      await db
        .from("clients")
        .update({
          name: cleanName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingClientId);
      return { clientId: existingClientId, cleanPhone: "", clientName: cleanName };
    }

    return { clientId: existingClientId || null, cleanPhone: "", clientName: effectiveName };
  } catch {
    return {
      clientId: existingClientId || null,
      cleanPhone: String(phone || "").replace(/\D/g, ""),
      clientName: String(name || "").trim() || "Cliente avulso",
    };
  }
}

/**
 * Consulta diretamente na tabela `barber_services` (filtrando por barber_id e service_id)
 * para obter o `custom_duration` (ou `custom_duration_minutes`) e `custom_price`.
 * Caso não haja tempo personalizado configurado (`null`), herda o tempo padrão da tabela `services`.
 */
async function resolveBarberServiceDetails(supabase, barberId, serviceId) {
  let defaultDuration = 30;
  let defaultPrice = 0;
  let serviceTitle = null;
  let customDuration = null;
  let customPrice = null;

  if (!serviceId) {
    return {
      serviceTitle: null,
      defaultDuration: 30,
      customDuration: null,
      durationMinutes: 30,
      defaultPrice: 0,
      customPrice: null,
      price: 0,
    };
  }

  const [svcRes, bsRes] = await Promise.all([
    supabase
      .from("services")
      .select("name, price, duration_minutes, default_duration_minutes")
      .eq("id", serviceId)
      .maybeSingle(),
    barberId
      ? supabase
          .from("barber_services")
          .select("*")
          .eq("barber_id", barberId)
          .eq("service_id", serviceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const svc = svcRes?.data;
  if (svc) {
    serviceTitle = svc.name || null;
    const rawPrice = Number(svc.price || 0);
    defaultPrice = rawPrice >= 1000 ? rawPrice / 100 : rawPrice;
    const dur = svc.duration_minutes ?? svc.default_duration_minutes;
    if (dur && Number(dur) > 0) {
      defaultDuration = Number(dur);
    }
  }

  const bs = bsRes?.data;
  if (bs) {
    const rawCustomDur = bs.custom_duration ?? bs.custom_duration_minutes ?? null;
    if (rawCustomDur !== null && rawCustomDur !== undefined && Number(rawCustomDur) > 0) {
      customDuration = Number(rawCustomDur);
    }
    if (bs.custom_price !== null && bs.custom_price !== undefined && Number(bs.custom_price) >= 0) {
      customPrice = Number(Number(bs.custom_price).toFixed(2));
    }
  }

  const durationMinutes = customDuration ?? defaultDuration;
  const price = customPrice ?? defaultPrice;

  return {
    serviceTitle,
    defaultDuration,
    customDuration,
    durationMinutes,
    defaultPrice,
    customPrice,
    price,
  };
}

/**
 * Resolve múltiplos serviços selecionados (array `serviceIds` ou texto combinado `Corte + Barba`)
 * consultando em paralelo `services` e `barber_services` para somar preços e durações reais.
 */
async function resolveMultipleBarberServicesDetails(
  supabase,
  barberId,
  serviceIdsInput = [],
  fallbackServiceText = ""
) {
  const normalizedIds = Array.from(
    new Set(
      (Array.isArray(serviceIdsInput) ? serviceIdsInput : [serviceIdsInput])
        .map((id) => (id ? String(id).trim() : ""))
        .filter(Boolean)
    )
  );

  const splitNames = String(fallbackServiceText || "")
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Se não houver IDs ou se o texto tiver múltiplos serviços ("Corte + Barba") e apenas 1 ID foi passado,
  // carrega o catálogo ativo para resolver todos os serviços pelo ID ou pelo nome
  if (normalizedIds.length === 0 || (splitNames.length > 1 && normalizedIds.length === 1)) {
    const { data: allServices } = await supabase
      .from("services")
      .select("id, name, price, duration_minutes, default_duration_minutes");

    const catalog = Array.isArray(allServices) ? allServices : [];
    if (splitNames.length > 1 && catalog.length > 0) {
      const matchedIds = [];
      for (const partName of splitNames) {
        const found = catalog.find(
          (s) => String(s.name || "").trim().toLowerCase() === partName.toLowerCase()
        );
        if (found?.id && !matchedIds.includes(String(found.id))) {
          matchedIds.push(String(found.id));
        }
      }
      if (matchedIds.length > 0) {
        normalizedIds.splice(0, normalizedIds.length, ...matchedIds);
      }
    }
  }

  if (normalizedIds.length === 0) {
    return {
      serviceIds: [],
      primaryServiceId: null,
      serviceTitle: fallbackServiceText || "Serviço",
      totalDurationMinutes: 30,
      totalPrice: 0,
      items: [],
    };
  }

  const [svcRes, bsRes] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, price, duration_minutes, default_duration_minutes")
      .in("id", normalizedIds),
    barberId
      ? supabase
          .from("barber_services")
          .select("*")
          .eq("barber_id", barberId)
          .in("service_id", normalizedIds)
      : Promise.resolve({ data: [] }),
  ]);

  const svcById = new Map((svcRes?.data || []).map((s) => [String(s.id), s]));
  const bsByServiceId = new Map((bsRes?.data || []).map((b) => [String(b.service_id), b]));

  let totalDurationMinutes = 0;
  let totalPrice = 0;
  const items = [];

  for (const sid of normalizedIds) {
    const svc = svcById.get(String(sid));
    if (!svc) continue;
    const bs = bsByServiceId.get(String(sid));

    const defaultDur = Number(svc.duration_minutes ?? svc.default_duration_minutes ?? 30) || 30;
    const rawPrice = Number(svc.price || 0);
    const defaultPrice = rawPrice >= 1000 ? rawPrice / 100 : rawPrice;

    const rawCustomDur = bs ? bs.custom_duration ?? bs.custom_duration_minutes ?? null : null;
    const customDuration =
      rawCustomDur !== null && rawCustomDur !== undefined && Number(rawCustomDur) > 0
        ? Number(rawCustomDur)
        : null;

    const rawCustomPrice = bs ? bs.custom_price : null;
    const customPrice =
      rawCustomPrice !== null && rawCustomPrice !== undefined && Number(rawCustomPrice) >= 0
        ? Number(Number(rawCustomPrice).toFixed(2))
        : null;

    const durationMinutes = customDuration ?? defaultDur;
    const price = customPrice ?? defaultPrice;

    totalDurationMinutes += durationMinutes;
    totalPrice = Number((totalPrice + price).toFixed(2));

    items.push({
      id: String(svc.id),
      name: svc.name || "Serviço",
      durationMinutes,
      price,
      customDuration,
      customPrice,
      defaultDuration: defaultDur,
      defaultPrice,
    });
  }

  if (items.length === 0) {
    const single = await resolveBarberServiceDetails(supabase, barberId, normalizedIds[0]);
    return {
      serviceIds: normalizedIds,
      primaryServiceId: normalizedIds[0] || null,
      serviceTitle: single.serviceTitle || fallbackServiceText || "Serviço",
      totalDurationMinutes: single.durationMinutes || 30,
      totalPrice: Number(single.price || 0),
      items: [],
    };
  }

  return {
    serviceIds: items.map((i) => i.id),
    primaryServiceId: items[0].id,
    serviceTitle: items.map((i) => i.name).join(" + "),
    totalDurationMinutes: Math.max(10, totalDurationMinutes),
    totalPrice,
    items,
  };
}

/**
 * Server Action pública para consultar a duração e o preço efetivos de um serviço
 * para um profissional específico (Matheus, William, etc.).
 */
export async function getBarberServiceDuration({ barberId, serviceId }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return null;
    return await resolveBarberServiceDetails(ctx.supabase, barberId, serviceId);
  } catch {
    return null;
  }
}

/**
 * Consulta os horários livres de 10 em 10 minutos respeitando o `custom_duration`
 * da tabela `barber_services` (ou o tempo padrão de `services` quando `null`).
 * Retorna SEMPRE todos os slots disponíveis desde a abertura (ex: 09:00) até o fecho (ex: 20:30),
 * acompanhados de `slotDetails` ({ time, isPast, isFuture }) para destacar os horários futuros
 * e identificar visualmente os que já passaram, permitindo encaixes em qualquer hora livre do dia.
 */
export async function getAvailableSlotsForBarber({ barberId, date, serviceId = null }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { slots: [], slotDetails: [] };

    const targetDate = date ? String(date).slice(0, 10) : todayInShop();
    const isToday = targetDate === todayInShop();

    // 1. Resolve imediatamente o tempo personalizado (custom_duration) do barbeiro + serviço
    const resolved = await resolveBarberServiceDetails(ctx.supabase, barberId, serviceId);
    const serviceDur = resolved.durationMinutes;

    // 2. Carrega expediente e exceções do dia para garantir cálculo exato com serviceDur
    const [scheduleRows, exceptions] = await Promise.all([
      listSchedule(barberId),
      listExceptions(barberId),
    ]);

    const isBlockedDate =
      Array.isArray(exceptions) &&
      exceptions.some(
        (ex) =>
          String(ex.exception_date || ex.override_date || "").slice(0, 10) === targetDate &&
          !ex.start_time
      );
    if (isBlockedDate) {
      return {
        slots: [],
        slotDetails: [],
        isDayOff: true,
        durationMinutes: serviceDur,
        customDuration: resolved.customDuration,
        defaultDuration: resolved.defaultDuration,
        price: resolved.price,
      };
    }

    const dow = dayOfWeekFromDate(targetDate);
    const daySchedule = (scheduleRows || []).find((r) => r.day_of_week === dow) || null;
    if (!daySchedule || !daySchedule.active) {
      return {
        slots: [],
        slotDetails: [],
        isDayOff: true,
        durationMinutes: serviceDur,
        customDuration: resolved.customDuration,
        defaultDuration: resolved.defaultDuration,
        price: resolved.price,
      };
    }

    // Garante que o expediente comece às 09:00 nos dias de manhã (ou no start_time configurado para o dia, ex: Segunda) até o fecho
    const effectiveSchedule = {
      ...daySchedule,
      start_time: daySchedule.start_time || "09:00",
      end_time: daySchedule.end_time || (dow === 0 ? "12:30" : "20:30"),
    };

    const { start, end } = dayRange(targetDate);
    const [apptsRes, blockedRes, leavesRes] = await Promise.all([
      ctx.supabase
        .from("appointments")
        .select(
          "id, barber_id, appointment_date, appointment_time, appointment_end_time, end_time, duration_minutes, buffer_minutes, status"
        )
        .eq("barber_id", barberId)
        .or(`appointment_date.eq.${targetDate},and(appointment_date.gte.${start},appointment_date.lt.${end})`),
      ctx.supabase
        .from("blocked_dates")
        .select("id")
        .or(`barber_id.eq.${barberId},barber_id.is.null`)
        .eq("date", targetDate)
        .limit(1),
      ctx.supabase
        .from("barber_leaves")
        .select("id, date, start_date, end_date")
        .or(`barber_id.eq.${barberId},barber_id.is.null`),
    ]);

    const hasBlockedDate = Array.isArray(blockedRes?.data) && blockedRes.data.length > 0;
    const hasLeave =
      Array.isArray(leavesRes?.data) &&
      leavesRes.data.some((lv) => {
        const d = lv.date ? String(lv.date).slice(0, 10) : null;
        const s = lv.start_date ? String(lv.start_date).slice(0, 10) : null;
        const e = lv.end_date ? String(lv.end_date).slice(0, 10) : null;
        return d === targetDate || (s && e && s <= targetDate && e >= targetDate);
      });

    if (hasBlockedDate || hasLeave) {
      return {
        slots: [],
        slotDetails: [],
        isDayOff: true,
        durationMinutes: serviceDur,
        customDuration: resolved.customDuration,
        defaultDuration: resolved.defaultDuration,
        price: resolved.price,
      };
    }

    const appts = apptsRes?.data || [];
    const busyRanges = extractBusyRangesFromAppointments(appts, barberId);

    // Adiciona também eventuais exceções parciais do dia (barber_exceptions com start_time e end_time)
    if (Array.isArray(exceptions)) {
      exceptions.forEach((ex) => {
        const exDate = String(ex.exception_date || ex.override_date || "").slice(0, 10);
        if (exDate === targetDate && ex.is_available === false && ex.start_time && ex.end_time) {
          busyRanges.push({
            start: String(ex.start_time).slice(0, 5),
            end: String(ex.end_time).slice(0, 5),
            bufferMinutes: 0,
          });
        }
      });
    }

    const nowFortaleza = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Fortaleza" })
    );
    const cutoffNow = isToday ? roundUpToNextSlot(nowFortaleza) : null;

    // Gera todos os slots livres desde a abertura (ex: 09:00) até o fecho (ex: 20:30),
    // marcando quais já passaram hoje (`isPast: true`) e quais estão para a frente (`isFuture: true`)
    const slotDetails = generateFullDaySlotsWithStatus(effectiveSchedule, busyRanges, serviceDur, {
      nowTime: cutoffNow,
      bufferMinutes: 0,
    });

    const allFreeSlots = slotDetails.map((s) => s.time);

    return {
      slots: allFreeSlots,
      slotDetails,
      busyRanges,
      cutoffNow,
      scheduleStart: String(effectiveSchedule.start_time).slice(0, 5),
      scheduleEnd: String(effectiveSchedule.end_time).slice(0, 5),
      durationMinutes: serviceDur,
      customDuration: resolved.customDuration,
      defaultDuration: resolved.defaultDuration,
      price: resolved.price,
    };
  } catch {
    return { slots: [], slotDetails: [], busyRanges: [] };
  }
}

function authError(ctx) {
  return { error: ctx?.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };
}

function canAccessAppointment(ctx, barberId) {
  const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
  return canAll || String(barberId) === String(ctx.barber.id);
}

// Barbeiro sem "ver toda a agenda" só mexe nos próprios atendimentos.
async function loadOwnedAppointment(ctx, id) {
  const { data, error } = await ctx.supabase
    .from("appointments")
    .select("id, barber_id")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { error: "Agendamento não encontrado." };

  if (!canAccessAppointment(ctx, data.barber_id)) {
    return { error: "Sem permissão para este agendamento." };
  }
  return { appointment: data };
}

// Foto de referência escolhida pelo cliente ao agendar. Best-effort e em consulta separada:
// se a migration 004 ainda não rodou (ou der qualquer erro), a agenda continua igual.
async function attachReferencePhotos(supabase, rows) {
  try {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return rows;

    const { data, error } = await supabase
      .from("appointments")
      .select("id, haircut_gallery ( id, title, image_path )")
      .in("id", ids)
      .not("reference_photo_id", "is", null)
      .limit(1000);
    if (error || !data?.length) return rows;

    const byId = new Map(data.filter((r) => r.haircut_gallery).map((r) => [r.id, r.haircut_gallery]));
    return rows.map((r) => {
      const g = byId.get(r.id);
      return g
        ? { ...r, reference_photo: { id: g.id, title: g.title, image_url: galleryPublicUrl(g.image_path) } }
        : r;
    });
  } catch {
    return rows;
  }
}

// Tenta carregar flags de pré-agendamento sem quebrar se a coluna ainda não existir
async function attachPreScheduledFlags(supabase, rows) {
  try {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return rows;

    const { data, error } = await supabase
      .from("appointments")
      .select("id, is_pre_scheduled, pre_scheduled, origin, source")
      .in("id", ids)
      .limit(1000);

    if (error || !data?.length) return rows;

    const byId = new Map(data.map((r) => [r.id, r]));
    return rows.map((r) => {
      const extra = byId.get(r.id);
      return extra ? { ...r, ...extra } : r;
    });
  } catch {
    return rows;
  }
}

export async function listAppointmentsByDate(date, scopeBarberId = null) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const { createAdminClient } = await import("@/lib/supabase/admin");
    let db = ctx.supabase;
    try {
      db = createAdminClient();
    } catch {
      db = ctx.supabase;
    }

    const targetDate = String(date || todayInShop()).slice(0, 10);
    const { end } = dayRange(targetDate);
    const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);

    // O servidor decide o escopo; o parâmetro do cliente não é confiável.
    const effectiveBarberId = canAll ? scopeBarberId : ctx.barber.id;

    let data = null;
    let error = null;

    let query = db
      .from("appointments")
      .select(`
        *,
        services ( * ),
        barbers ( id, name, phone, role, commission_percent, permissions )
      `)
      .or(`appointment_date.eq.${targetDate},and(appointment_date.gte.${targetDate}T00:00:00.000Z,appointment_date.lt.${end})`)
      .order("appointment_time", { ascending: true })
      .order("appointment_date", { ascending: true })
      .range(0, 999);

    if (effectiveBarberId) query = query.eq("barber_id", effectiveBarberId);

    const primaryRes = await query;
    if (!primaryRes.error) {
      data = primaryRes.data || [];
    } else {
      // Fallback sem joins caso alguma coluna de relação varie no banco
      let fallbackQuery = db
        .from("appointments")
        .select("*")
        .or(`appointment_date.eq.${targetDate},and(appointment_date.gte.${targetDate}T00:00:00.000Z,appointment_date.lt.${end})`)
        .range(0, 999);
      if (effectiveBarberId) fallbackQuery = fallbackQuery.eq("barber_id", effectiveBarberId);
      const fallbackRes = await fallbackQuery;
      data = fallbackRes.data || [];
      error = fallbackRes.error;
    }

    if (error) return { error: `Não foi possível carregar os agendamentos: ${error.message}` };

    // Garante que apenas registos pertencentes ao dia `targetDate` (em data literal ou fuso de Fortaleza) permaneçam,
    // sem perder agendamentos gravados à meia-noite UTC.
    const filteredRows = (data || []).filter((row) => {
      const rawDate = String(row.appointment_date || "");
      if (!rawDate) return false;
      if (rawDate.length === 10 || rawDate.includes("T00:00:00")) {
        return rawDate.slice(0, 10) === targetDate;
      }
      try {
        const localDate = new Date(rawDate).toLocaleDateString("en-CA", {
          timeZone: "America/Fortaleza",
        });
        return localDate === targetDate || rawDate.slice(0, 10) === targetDate;
      } catch {
        return rawDate.slice(0, 10) === targetDate;
      }
    });

    // Ordena cronologicamente pelo horário do atendimento
    filteredRows.sort((a, b) => {
      const timeA = String(a.appointment_time || "99:99").slice(0, 5);
      const timeB = String(b.appointment_time || "99:99").slice(0, 5);
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });

    // Sincroniza dinamicamente o cálculo financeiro, nome de múltiplos serviços e comissão por atendimento
    const enrichedRows = filteredRows.map((row) => {
      const fin = calculateAppointmentFinance(row, row.barbers);
      const effectiveServiceName = row.service || row.services?.name || "Serviço";
      return {
        ...row,
        service: effectiveServiceName,
        services: row.services
          ? { ...row.services, name: effectiveServiceName }
          : { id: row.service_id || null, name: effectiveServiceName, price: fin.serviceAmount },
        price: fin.totalAmount,
        total_price: fin.totalAmount,
        service_amount: fin.serviceAmount,
        products_amount: fin.productsAmount,
        barber_commission_amount: fin.commissionAmount,
        service_commission: fin.serviceCommission,
        product_commission: fin.productCommission,
        is_owner_barber: fin.isOwner,
        commission_rule_label: fin.ruleLabel,
      };
    });

    const withPhotos = await attachReferencePhotos(db, enrichedRows);
    return { data: await attachPreScheduledFlags(db, withPhotos) };
  } catch (error) {
    return { error: "Ocorreu um erro ao carregar os agendamentos" };
  }
}

export async function createWalkInAppointment({ barber_id, service_id, client_name, client_phone, date, time, is_walk_in }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const canAll = hasPermission(ctx.barber, PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
    const targetBarberId = canAll ? barber_id : ctx.barber.id;

    // Preserva a data e a hora locais exatamente como escolhidas (sem desvio UTC)
    const dateOnly = date ? String(date).slice(0, 10) : todayInShop();
    const nowFortaleza = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Fortaleza" }));
    const nowHHMM = `${String(nowFortaleza.getHours()).padStart(2, "0")}:${String(nowFortaleza.getMinutes()).padStart(2, "0")}:00`;
    const formattedTime = time ? (String(time).length === 5 ? `${time}:00` : String(time)) : nowHHMM;
    const isWalkInFlag = is_walk_in !== undefined ? Boolean(is_walk_in) : !Boolean(time && dateOnly !== todayInShop());

    // Obtém detalhes do serviço e consulta barber_services (barber_id + service_id) para usar custom_duration e custom_price
    const resolved = await resolveBarberServiceDetails(ctx.supabase, targetBarberId, service_id);
    const servicePrice = resolved.price;
    const serviceTitle = resolved.serviceTitle;
    const durationMin = resolved.durationMinutes;
    const calculatedEndTime = addMinutesToTimeStr(formattedTime, durationMin);

    // 1. Garante SEMPRE o salvamento do cliente na tabela `public.clients` tendo o telefone como chave primária
    const syncedClient = await upsertClientByPhone(ctx.supabase, {
      name: client_name,
      phone: client_phone,
    });
    const cleanDigits = syncedClient.cleanPhone;
    const finalClientName = syncedClient.clientName || client_name?.trim() || "Cliente avulso";
    const syncedClientId = syncedClient.clientId || null;

    // Se houver telefone válido (>= 8 dígitos), horário agendado manual (não-encaixe) e data presente/futura,
    // usa a RPC transacional atômica; para datas retroativas (dias anteriores) ou encaixes, grava diretamente
    const isRetroactiveDate = dateOnly < todayInShop();
    if (cleanDigits.length >= 8 && time && !isWalkInFlag && !isRetroactiveDate) {
      try {
        const { data: rpcRes, error: rpcErr } = await ctx.supabase.rpc("chatbot_create_appointment", {
          p_client_name: finalClientName,
          p_client_phone: cleanDigits,
          p_barber_id: targetBarberId,
          p_service_id: service_id,
          p_service_ids: [service_id],
          p_date: dateOnly,
          p_time: formattedTime,
          p_duration_minutes: durationMin,
          p_buffer_minutes: 0,
          p_notes: "Registrado pelo Painel do Barbeiro",
        });

        if (
          rpcErr?.code === "23505" ||
          (rpcRes &&
            rpcRes.success === false &&
            (rpcRes.code === "SLOT_ALREADY_BOOKED" || rpcRes.code === "SLOT_OCCUPIED"))
        ) {
          return {
            error:
              rpcRes?.message ||
              rpcRes?.error ||
              "Este horário acabou de ser ocupado por outro cliente. Escolha outro horário.",
            code: "SLOT_ALREADY_BOOKED",
          };
        }

        if (!rpcErr && rpcRes?.success && rpcRes?.appointment_id) {
          await ctx.supabase
            .from("appointments")
            .update({
              client_id: syncedClientId || rpcRes.client_id || null,
              client_name: finalClientName,
              client_phone: cleanDigits,
              clean_phone: cleanDigits,
              is_walk_in: isWalkInFlag,
              service: serviceTitle,
              source: "painel",
              origin: "painel",
              duration_minutes: durationMin,
              end_time: calculatedEndTime,
              price: servicePrice,
              total_price: servicePrice,
            })
            .eq("id", rpcRes.appointment_id);

          try {
            await notifyNewAppointment(rpcRes.appointment_id);
          } catch {}

          revalidatePath("/admin/agenda");
          revalidatePath("/admin/clientes");
          return {
            success: true,
            id: rpcRes.appointment_id,
            client_id: syncedClientId || rpcRes.client_id || null,
            date: dateOnly,
            time: formattedTime.slice(0, 5),
            duration_minutes: durationMin,
          };
        }
      } catch {}
    }

    const insertPayload = {
      barber_id: targetBarberId,
      service_id,
      service: serviceTitle,
      price: servicePrice,
      total_price: servicePrice,
      client_name: finalClientName,
      client_phone: cleanDigits || "00000000000",
      clean_phone: cleanDigits || "00000000000",
      appointment_date: dateOnly,
      appointment_time: formattedTime,
      end_time: calculatedEndTime,
      duration_minutes: durationMin,
      buffer_minutes: 0,
      status: "confirmado",
      payment_status: "pendente",
      is_walk_in: isWalkInFlag,
      source: "painel",
      origin: "painel",
    };

    if (syncedClientId) {
      insertPayload.client_id = syncedClientId;
    }

    const { data: created, error } = await ctx.supabase
      .from("appointments")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      const isConflict =
        error.code === "23505" ||
        String(error.message || "").includes("CONFLITO_HORARIO") ||
        String(error.message || "").includes("idx_appointments_unique_active_slot");
      if (isConflict) {
        return {
          error: "Este horário já está ocupado para este profissional. Escolha outro horário.",
          code: "SLOT_ALREADY_BOOKED",
        };
      }
      return { error: `Não foi possível registrar o atendimento: ${error.message}` };
    }

    try {
      await notifyNewAppointment(created.id);
    } catch (pushError) {
      console.error("[appointments] Agendamento salvo, mas o push falhou:", pushError);
    }

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/clientes");
    return {
      success: true,
      id: created.id,
      client_id: syncedClientId,
      date: dateOnly,
      time: formattedTime.slice(0, 5),
      duration_minutes: durationMin,
    };
  } catch (error) {
    return { error: "Ocorreu um erro ao registrar o agendamento" };
  }
}

export async function updateAppointmentStatus(id, status, { reason } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    // Se a alteração for para cancelado, aciona o fluxo completo de cancelamento e liberação
    if (status === "cancelado") {
      const cancelResult = await executeAppointmentCancellation({
        appointmentId: id,
        reason,
        cancelledBy: `barbeiro:${ctx.barber.id}`,
        supabaseClient: ctx.supabase,
      });

      if (cancelResult.error) {
        return { error: cancelResult.error };
      }

      return {
        success: true,
        freedSlot: true,
        notifications: cancelResult.notifications,
      };
    }

    const { error } = await ctx.supabase.from("appointments").update({ status }).eq("id", id);
    if (error) return { error: `Não foi possível atualizar o status: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (error) {
    return { error: "Ocorreu um erro ao atualizar o status" };
  }
}

/**
 * Server Action dedicada e explícita para cancelamento de agendamento no painel.
 * Executa as 3 regras: atualiza status para 'cancelado', libera vaga e notifica barbeiro/equipe.
 */
export async function cancelAppointment(id, { reason = null } = {}) {
  return updateAppointmentStatus(id, "cancelado", { reason });
}

/**
 * Confirma o agendamento / pré-agendamento no banco de dados.
 */
export async function confirmAppointment(id) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const { error } = await ctx.supabase
      .from("appointments")
      .update({ status: "confirmado" })
      .eq("id", id);

    if (error) return { error: `Não foi possível confirmar: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch {
    return { error: "Ocorreu um erro ao confirmar o agendamento" };
  }
}

/**
 * Remarca um pré-agendamento ou agendamento para uma nova data e horário.
 */
export async function rescheduleAppointment({ id, newDate, newTime, newBarberId = null }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    if (!newDate || !newTime) {
      return { error: "Nova data e horário são obrigatórios." };
    }

    const payload = {
      appointment_date: newDate,
      appointment_time: newTime.length === 5 ? `${newTime}:00` : newTime,
      status: "confirmado",
    };

    if (newBarberId) {
      payload.barber_id = newBarberId;
    }

    const { error } = await ctx.supabase
      .from("appointments")
      .update(payload)
      .eq("id", id);

    if (error) return { error: `Não foi possível remarcar: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch {
    return { error: "Ocorreu um erro ao remarcar o agendamento" };
  }
}


/**
 * Remove definitivamente um agendamento do banco de dados (exclusão de registro).
 * Apenas barbeiros autorizados ou o dono do atendimento.
 */
export async function deleteAppointment(id) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const { error } = await ctx.supabase.from("appointments").delete().eq("id", id);
    if (error) return { error: `Não foi possível remover o agendamento: ${error.message}` };

    revalidatePath("/admin/agenda");
    return { success: true };
  } catch (error) {
    return { error: "Ocorreu um erro ao remover o agendamento" };
  }
}

/**
 * Calcula o ajuste de horário e duração (em intervalos de 10 em 10 minutos)
 * quando um atendimento é finalizado antecipadamente (seja em "Finalizar e Receber" ou "Fiado").
 * Libera imediatamente na agenda todos os slots de 10 em 10 min subsequentes ao momento da baixa.
 */
function computeEarlyCompletionTiming(appointment) {
  const rawStatus = String(appointment?.status || "").toLowerCase().trim();
  const alreadyCompleted =
    rawStatus === "concluido" ||
    rawStatus === "concluído" ||
    rawStatus === "completed";

  const startStr = String(appointment?.appointment_time || "09:00").slice(0, 5);
  const [sh, sm] = startStr.split(":").map(Number);
  const startMin = (Number.isFinite(sh) ? sh : 9) * 60 + (Number.isFinite(sm) ? sm : 0);
  const scheduledDuration = Math.max(
    10,
    Number(
      appointment?.duration_minutes ??
        appointment?.services?.duration_minutes ??
        appointment?.services?.default_duration_minutes ??
        30
    ) || 30
  );
  const scheduledEndMin = startMin + scheduledDuration;
  const defaultEndTime =
    appointment?.end_time && String(appointment.end_time).length >= 5
      ? String(appointment.end_time).slice(0, 5) + ":00"
      : addMinutesToTimeStr(startStr, scheduledDuration);

  // Se o atendimento já estava concluído antes (ex: quitando um Fiado antigo), preserva o tempo gravado
  if (alreadyCompleted) {
    return {
      durationMinutes: scheduledDuration,
      endTime: defaultEndTime,
      freedMinutes: 0,
      wasEarly: false,
    };
  }

  const apptDate = String(appointment?.appointment_date || "").slice(0, 10);
  const today = todayInShop();
  const nowFortaleza = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Fortaleza" })
  );
  const nowMin = nowFortaleza.getHours() * 60 + nowFortaleza.getMinutes();
  // Arredonda o minuto atual para o próximo passo de 10 em 10 minutos
  const nowRounded10 = Math.ceil(nowMin / 10) * 10;

  let effectiveEndMin = scheduledEndMin;

  if (apptDate === today) {
    if (nowMin >= startMin && nowRounded10 < scheduledEndMin) {
      // Caso 1: Atendimento em andamento e finalizado antes do término previsto -> libera a partir do próximo slot de 10 min
      effectiveEndMin = Math.max(startMin + 10, nowRounded10);
    } else if (nowMin < startMin && scheduledDuration > 10) {
      // Caso 2: Cliente atendido adiantado antes do horário marcado -> reduz ocupação ao mínimo de 10 min para destravar a grade
      effectiveEndMin = startMin + 10;
    }
  } else if (apptDate > today && scheduledDuration > 10) {
    // Caso 3: Baixa antecipada em data futura -> reduz ao bloco mínimo de 10 min para liberar os slots seguintes
    effectiveEndMin = startMin + 10;
  }

  const nextDuration = Math.max(10, effectiveEndMin - startMin);
  const eh = Math.floor(effectiveEndMin / 60) % 24;
  const em = effectiveEndMin % 60;
  const nextEndTime = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}:00`;
  const freedMinutes = Math.max(0, scheduledDuration - nextDuration);

  return {
    durationMinutes: nextDuration,
    endTime: nextEndTime,
    freedMinutes,
    wasEarly: freedMinutes > 0,
  };
}

export async function registerPayment(id, { payment_method, amount, tip_amount = 0, description }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return { error: "Valor de pagamento inválido." };
    }

    const parsedTip = Math.max(0, parseFloat(tip_amount) || 0);
    const barberId = owned.appointment.barber_id;

    // Carrega dados completos do agendamento e do barbeiro para comissão + cálculo de conclusão antecipada (10 em 10 min)
    const [apptRes, bRes] = await Promise.all([
      ctx.supabase
        .from("appointments")
        .select(
          "id, barber_id, appointment_date, appointment_time, end_time, duration_minutes, status, payment_status, price, total_price, tip_amount, notes, services(price, duration_minutes, default_duration_minutes)"
        )
        .eq("id", id)
        .maybeSingle(),
      ctx.supabase
        .from("barbers")
        .select("id, name, phone, role, commission_percent, commission_rate, permissions")
        .eq("id", barberId)
        .maybeSingle(),
    ]);

    const currentAppt = apptRes?.data || owned.appointment;
    const barberData = bRes?.data || { id: barberId };

    const fin = calculateAppointmentFinance(
      {
        ...currentAppt,
        price: parsedAmount,
        total_price: parsedAmount,
        tip_amount: parsedTip,
      },
      barberData
    );

    const commissionAmount = fin.commissionAmount;
    const earlyTiming = computeEarlyCompletionTiming(currentAppt);

    // 1. Tenta a função atômica RPC register_payment_atomic (com p_tip_amount para registrar no cash_flow)
    try {
      await ctx.supabase.rpc("register_payment_atomic", {
        p_appointment_id: id,
        p_barber_id: barberId,
        p_payment_method: payment_method,
        p_amount: parsedAmount + parsedTip,
        p_description: description?.trim() || null,
        p_tip_amount: parsedTip,
      });
    } catch {
      // Continua para atualização explícita e sincronizada abaixo
    }

    // 2. Garante a gravação exata do pagamento, comissão, gorjeta e liberação antecipada de slots (10 em 10 min)
    const { error: updateError } = await ctx.supabase
      .from("appointments")
      .update({
        status: "concluido",
        payment_status: "pago",
        payment_method,
        price: parsedAmount,
        total_price: parsedAmount,
        tip_amount: parsedTip,
        barber_commission_amount: commissionAmount,
        duration_minutes: earlyTiming.durationMinutes,
        end_time: earlyTiming.endTime,
        buffer_minutes: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      return { error: `Erro na liquidação do pagamento: ${updateError.message}` };
    }

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/financeiro");
    revalidatePath("/admin/clientes");
    revalidatePath("/admin/equipe");
    return {
      success: true,
      status: "concluido",
      payment_status: "pago",
      payment_method,
      price: parsedAmount,
      total_price: parsedAmount,
      tip_amount: parsedTip,
      total_received: Number((parsedAmount + parsedTip).toFixed(2)),
      duration_minutes: earlyTiming.durationMinutes,
      end_time: earlyTiming.endTime.slice(0, 5),
      freedMinutes: earlyTiming.freedMinutes,
      wasEarly: earlyTiming.wasEarly,
      commissionAmount,
      barberTotalPayout: fin.barberTotalPayout,
      serviceCommission: fin.serviceCommission,
      productCommission: fin.productCommission,
    };
  } catch (error) {
    return { error: "Ocorreu um erro crítico ao registrar o pagamento" };
  }
}

/**
 * Dá baixa no atendimento na modalidade "Fiado" (Contas a Receber):
 * - Marca `status = 'concluido'` para encerrar o atendimento na agenda;
 * - Mantém `payment_status = 'pendente'` e define `payment_method = 'fiado'` para ir direto para Contas a Receber ("Quem não pagou");
 * - Ajusta `duration_minutes` e `end_time` em intervalos de 10 em 10 minutos se concluído antecipadamente,
 *   liberando a agenda do barbeiro imediatamente sem travar novos encaixes ou agendamentos.
 */
export async function completeAppointmentFiado(id) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const barberId = owned.appointment.barber_id;

    const [apptRes, bRes] = await Promise.all([
      ctx.supabase
        .from("appointments")
        .select(
          "id, barber_id, appointment_date, appointment_time, end_time, duration_minutes, status, payment_status, price, total_price, notes, services(price, duration_minutes, default_duration_minutes)"
        )
        .eq("id", id)
        .maybeSingle(),
      ctx.supabase
        .from("barbers")
        .select("id, name, phone, role, commission_percent, commission_rate, permissions")
        .eq("id", barberId)
        .maybeSingle(),
    ]);

    const currentAppt = apptRes?.data || owned.appointment;
    const barberData = bRes?.data || { id: barberId };

    const fin = calculateAppointmentFinance(currentAppt, barberData);
    const earlyTiming = computeEarlyCompletionTiming(currentAppt);

    const { error: updateError } = await ctx.supabase
      .from("appointments")
      .update({
        status: "concluido",
        payment_status: "pendente",
        payment_method: "fiado",
        price: fin.totalAmount,
        total_price: fin.totalAmount,
        barber_commission_amount: fin.commissionAmount,
        duration_minutes: earlyTiming.durationMinutes,
        end_time: earlyTiming.endTime,
        buffer_minutes: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      return { error: `Não foi possível registar baixa no Fiado: ${updateError.message}` };
    }

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/financeiro");
    revalidatePath("/admin/clientes");
    return {
      success: true,
      status: "concluido",
      payment_status: "pendente",
      payment_method: "fiado",
      price: fin.totalAmount,
      total_price: fin.totalAmount,
      duration_minutes: earlyTiming.durationMinutes,
      end_time: earlyTiming.endTime.slice(0, 5),
      freedMinutes: earlyTiming.freedMinutes,
      wasEarly: earlyTiming.wasEarly,
      commissionAmount: fin.commissionAmount,
    };
  } catch (error) {
    return { error: "Ocorreu um erro ao finalizar o atendimento no Fiado" };
  }
}

/**
 * Vincula um ou múltiplos produtos vendidos (public.products) diretamente ao agendamento do cliente,
 * abatendo automaticamente o stock_quantity de cada produto e somando o valor total ao atendimento.
 * Aceita tanto { appointmentId, items: [{ productId, quantity }] } quanto { appointmentId, productId, quantity }.
 */
export async function addProductToAppointment({
  appointmentId,
  productId,
  quantity = 1,
  items,
}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return authError(ctx);

    if (!appointmentId) {
      return { error: "Agendamento inválido." };
    }

    // Normaliza lista de itens (suporta carrinho múltiplo ou item único legado)
    const rawItems =
      Array.isArray(items) && items.length > 0
        ? items
        : productId
          ? [{ productId, quantity }]
          : [];

    const mergedMap = new Map();
    for (const entry of rawItems) {
      const pid = entry?.productId;
      const qty = Math.max(0, parseInt(entry?.quantity, 10) || 0);
      if (!pid || qty <= 0) continue;
      mergedMap.set(pid, (mergedMap.get(pid) || 0) + qty);
    }

    const normalizedItems = Array.from(mergedMap.entries()).map(([pid, qty]) => ({
      productId: pid,
      quantity: qty,
    }));

    if (normalizedItems.length === 0) {
      return { error: "Selecione pelo menos um produto para adicionar ao atendimento." };
    }

    const { data: current, error: fetchApptErr } = await ctx.supabase
      .from("appointments")
      .select("id, barber_id, price, total_price, notes, service, payment_status, services(price, name)")
      .eq("id", appointmentId)
      .maybeSingle();

    if (fetchApptErr || !current) {
      return { error: "Agendamento não encontrado." };
    }

    if (!canAccessAppointment(ctx, current.barber_id)) {
      return { error: "Sem permissão para alterar este atendimento." };
    }

    const productIds = normalizedItems.map((i) => i.productId);
    const { data: productsData } = await ctx.supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    const productById = new Map((productsData || []).map((p) => [p.id, p]));

    // Caso algum item selecionado venha do catálogo em memória/fallback de Conveniência, resolve pelo listProducts
    if (productById.size < normalizedItems.length) {
      try {
        const { listProducts } = await import("@/lib/actions/products");
        const catalogAll = await listProducts();
        for (const p of catalogAll || []) {
          if (p?.id && !productById.has(p.id)) {
            productById.set(p.id, p);
          }
        }
      } catch {}
    }

    if (productById.size === 0) {
      return { error: "Produtos não encontrados no catálogo." };
    }

    const canManageConvenience = isChefe(ctx.barber) || isOwnerBarber(ctx.barber);

    // 1. Validação prévia de existência, permissão de Conveniência e estoque de TODOS os itens selecionados
    for (const item of normalizedItems) {
      const product = productById.get(item.productId);
      if (!product) {
        return { error: "Um dos produtos selecionados não foi encontrado." };
      }
      if (isConvenienceProduct(product) && !canManageConvenience) {
        return {
          error:
            "Apenas o Barbeiro Chefe (Administrador) tem permissão para registar itens de Conveniência.",
        };
      }
      const currentStock = Number(product.stock_quantity || 0);
      if (currentStock < item.quantity) {
        return {
          error:
            currentStock <= 0
              ? `O item "${product.name}" está sem estoque disponível.`
              : `Estoque insuficiente para "${product.name}" (solicitado: ${item.quantity}, disponível: ${currentStock} un.).`,
        };
      }
    }

    // 2. Baixa no estoque de cada produto com controle de rollback em caso de erro
    const updatedStockRollbacks = [];
    const addedItems = [];
    const newTagLines = [];
    let totalProductsAddedPrice = 0;

    for (const item of normalizedItems) {
      const product = productById.get(item.productId);
      const currentStock = Number(product.stock_quantity || 0);
      const nextStock = Math.max(0, currentStock - item.quantity);
      const isPersistedUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        String(product.id || "")
      );

      if (isPersistedUUID) {
        const { error: stockErr } = await ctx.supabase
          .from("products")
          .update({
            stock_quantity: nextStock,
            updated_at: new Date().toISOString(),
          })
          .eq("id", product.id);

        if (!stockErr) {
          updatedStockRollbacks.push({
            productId: product.id,
            previousStock: currentStock,
          });
        }
      }

      const unitPrice = Number(product.price || 0);
      const rawCost = Number(product.cost_price || 0);
      const descCostMatch = String(product.description || "").match(/\[CUSTO:([0-9.]+)\]/i);
      const unitCostPrice =
        rawCost > 0 ? rawCost : descCostMatch ? parseFloat(descCostMatch[1]) || 0 : 0;
      const itemSubtotal = Number((unitPrice * item.quantity).toFixed(2));
      const itemTotalCost = Number((unitCostPrice * item.quantity).toFixed(2));
      totalProductsAddedPrice = Number((totalProductsAddedPrice + itemSubtotal).toFixed(2));

      const isConv = isConvenienceProduct(product);
      const tagPrefix = isConv ? "CONVENIENCIA" : "PRODUTO";
      const formattedSubtotal = itemSubtotal.toFixed(2).replace(".", ",");
      const tagLine = `[${tagPrefix}:${product.id}:${item.quantity}:${unitPrice.toFixed(2)}:${unitCostPrice.toFixed(2)}] ${item.quantity}x ${product.name} (R$ ${formattedSubtotal})`;
      newTagLines.push(tagLine);

      addedItems.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        unitPrice,
        unitCostPrice,
        subtotal: itemSubtotal,
        totalCost: itemTotalCost,
        isConvenience: isConv,
        category: isConv ? "conveniencia" : "barbearia",
        remainingStock: nextStock,
      });
    }

    const currentTotal = Number(
      current.total_price ?? current.price ?? current.services?.price ?? 0,
    );
    const nextTotal = Number((currentTotal + totalProductsAddedPrice).toFixed(2));

    const joinedNewLines = newTagLines.join("\n");
    const nextNotes = current.notes
      ? `${current.notes}\n${joinedNewLines}`
      : joinedNewLines;

    const updateApptPayload = {
      price: nextTotal,
      total_price: nextTotal,
      notes: nextNotes,
      updated_at: new Date().toISOString(),
    };

    if (current.barber_id) {
      const { data: bData } = await ctx.supabase
        .from("barbers")
        .select("id, name, phone, role, commission_percent, commission_rate, permissions")
        .eq("id", current.barber_id)
        .maybeSingle();
      const fin = calculateAppointmentFinance(
        {
          ...current,
          price: nextTotal,
          total_price: nextTotal,
          notes: nextNotes,
        },
        bData
      );
      updateApptPayload.barber_commission_amount = fin.commissionAmount;
    }

    const { error: updateApptErr } = await ctx.supabase
      .from("appointments")
      .update(updateApptPayload)
      .eq("id", appointmentId);

    if (updateApptErr) {
      for (const rb of updatedStockRollbacks) {
        await ctx.supabase
          .from("products")
          .update({ stock_quantity: rb.previousStock })
          .eq("id", rb.productId);
      }
      return {
        error: `Não foi possível vincular os produtos ao atendimento: ${updateApptErr.message}`,
      };
    }

    // 3. Regista também na tabela dedicada public.appointment_convenience_items (best-effort)
    try {
      const convRows = addedItems.map((it) => ({
        appointment_id: appointmentId,
        product_id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          String(it.productId || "")
        )
          ? it.productId
          : null,
        barber_id: current.barber_id || ctx.barber?.id || null,
        item_name: it.name,
        category: it.category,
        is_convenience: it.isConvenience,
        quantity: it.quantity,
        unit_price: it.unitPrice,
        subtotal: it.subtotal,
      }));
      await ctx.supabase.from("appointment_convenience_items").insert(convRows);
    } catch {}

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/financeiro");
    revalidatePath("/admin/servicos");

    return {
      success: true,
      newTotal: nextTotal,
      updatedNotes: nextNotes,
      addedItems,
      addedItem: addedItems[0] || null,
    };
  } catch (err) {
    return { error: err?.message || "Erro inesperado ao adicionar produtos ao atendimento." };
  }
}

export async function addProductsToAppointment(params) {
  return addProductToAppointment(params);
}

/**
 * Remove um produto previamente vinculado ao agendamento, devolvendo a quantidade
 * ao estoque na tabela public.products e abatendo o valor do total do atendimento.
 */
export async function removeProductFromAppointment({ appointmentId, rawLine }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return authError(ctx);

    if (!appointmentId || !rawLine) {
      return { error: "Dados inválidos para remover o produto." };
    }

    const { data: current, error: fetchApptErr } = await ctx.supabase
      .from("appointments")
      .select("id, barber_id, price, total_price, notes, payment_status, services(price)")
      .eq("id", appointmentId)
      .maybeSingle();

    if (fetchApptErr || !current) {
      return { error: "Agendamento não encontrado." };
    }

    if (!canAccessAppointment(ctx, current.barber_id)) {
      return { error: "Sem permissão para alterar este atendimento." };
    }

    const match = String(rawLine).match(
      /^\[(PRODUTO|CONVENIENCIA):([^:]+):(\d+):([0-9.]+)(?::([0-9.]+))?\]/
    );
    const tagType = match ? match[1] : "PRODUTO";
    const isConv = tagType === "CONVENIENCIA";
    if (isConv && !isChefe(ctx.barber) && !isOwnerBarber(ctx.barber)) {
      return {
        error:
          "Apenas o Barbeiro Chefe (Administrador) tem permissão para remover itens de Conveniência.",
      };
    }
    const productId = match ? match[2] : null;
    const qty = match ? parseInt(match[3], 10) || 1 : 1;
    const unitPrice = match ? parseFloat(match[4]) || 0 : 0;
    const itemSubtotal = Number((unitPrice * qty).toFixed(2));

    if (productId) {
      const { data: prod } = await ctx.supabase
        .from("products")
        .select("id, stock_quantity")
        .eq("id", productId)
        .maybeSingle();

      if (prod) {
        await ctx.supabase
          .from("products")
          .update({
            stock_quantity: Number(prod.stock_quantity || 0) + qty,
            updated_at: new Date().toISOString(),
          })
          .eq("id", productId);
      }
    }

    const lines = String(current.notes || "").split("\n");
    const idx = lines.findIndex((l) => l.trim() === String(rawLine).trim());
    if (idx !== -1) lines.splice(idx, 1);
    const nextNotes = lines.join("\n").trim() || null;

    const baseServicePrice = Number(current.services?.price ?? 0);
    const currentTotal = Number(current.total_price ?? current.price ?? baseServicePrice);
    const nextTotal = Math.max(0, Number((currentTotal - itemSubtotal).toFixed(2)));

    const updateRemovePayload = {
      price: nextTotal,
      total_price: nextTotal,
      notes: nextNotes,
      updated_at: new Date().toISOString(),
    };

    if (current.barber_id) {
      const { data: bData } = await ctx.supabase
        .from("barbers")
        .select("id, name, phone, role, commission_percent, commission_rate, permissions")
        .eq("id", current.barber_id)
        .maybeSingle();
      const fin = calculateAppointmentFinance(
        {
          ...current,
          price: nextTotal,
          total_price: nextTotal,
          notes: nextNotes,
        },
        bData
      );
      updateRemovePayload.barber_commission_amount = fin.commissionAmount;
    }

    const { error: updateErr } = await ctx.supabase
      .from("appointments")
      .update(updateRemovePayload)
      .eq("id", appointmentId);

    if (updateErr) {
      return { error: `Erro ao atualizar agendamento: ${updateErr.message}` };
    }

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/financeiro");
    revalidatePath("/admin/servicos");

    return {
      success: true,
      newTotal: nextTotal,
      updatedNotes: nextNotes,
    };
  } catch (err) {
    return { error: err?.message || "Erro ao remover produto do atendimento." };
  }
}

/**
 * Altera um ou múltiplos serviços (`serviceIds` / `serviceId`) e/ou os dados cadastrais do cliente
 * (nome e telemóvel) de um agendamento existente, recalculando automaticamente:
 * - `client_name`, `client_phone`, `clean_phone`, `client_id` (sincronizando na tabela `public.clients` usando o telefone como chave primária)
 * - `service_id` (ID principal), `service_ids` (array de IDs selecionados) e `service` (ex: "Corte + Sobrancelha + Barba")
 * - `duration_minutes` e `end_time` (somando a duração de todos os serviços selecionados respeitando `barber_services`)
 * - `price` e `total_price` (somando os preços de todos os serviços selecionados + produtos vinculados ao atendimento)
 * - `barber_commission_amount` mantendo a timeline e o Caixa 100% sincronizados.
 */
export async function updateAppointmentService({
  appointmentId,
  serviceId,
  serviceIds,
  clientName,
  clientPhone,
}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return authError(ctx);

    if (!appointmentId) {
      return { error: "Agendamento inválido para atualização." };
    }

    let current = null;
    const primaryFetch = await ctx.supabase
      .from("appointments")
      .select(
        "id, barber_id, client_id, client_name, client_phone, service_id, service_ids, service, appointment_time, duration_minutes, price, total_price, notes, status, payment_status"
      )
      .eq("id", appointmentId)
      .maybeSingle();

    if (!primaryFetch.error && primaryFetch.data) {
      current = primaryFetch.data;
    } else {
      const fallbackFetch = await ctx.supabase
        .from("appointments")
        .select(
          "id, barber_id, client_id, client_name, client_phone, service_id, service, appointment_time, duration_minutes, price, total_price, notes, status, payment_status"
        )
        .eq("id", appointmentId)
        .maybeSingle();
      current = fallbackFetch.data;
    }

    if (!current) {
      return { error: "Agendamento não encontrado." };
    }

    if (!canAccessAppointment(ctx, current.barber_id)) {
      return { error: "Sem permissão para editar este agendamento." };
    }

    const requestedIds =
      Array.isArray(serviceIds) && serviceIds.length > 0
        ? serviceIds.filter(Boolean)
        : serviceId
        ? [serviceId]
        : Array.isArray(current.service_ids) && current.service_ids.length > 0
        ? current.service_ids
        : current.service_id
        ? [current.service_id]
        : [];

    const productsSubtotal = sumAttachedProductsFromNotes(current.notes);

    let serviceTitle = current.service || "Serviço";
    let servicePrice = Math.max(0, Number(current.price || 0) - productsSubtotal);
    let nextDuration = Number(current.duration_minutes || 30);
    let effectiveServiceId = requestedIds[0] || current.service_id || null;
    let effectiveServiceIds = requestedIds.map(String);
    let resolvedItems = [];

    if (requestedIds.length > 0) {
      const resolvedMulti = await resolveMultipleBarberServicesDetails(
        ctx.supabase,
        current.barber_id,
        requestedIds,
        current.service
      );
      if (resolvedMulti.items.length > 0 || resolvedMulti.serviceTitle) {
        effectiveServiceId = resolvedMulti.primaryServiceId || effectiveServiceId;
        effectiveServiceIds =
          resolvedMulti.serviceIds.length > 0 ? resolvedMulti.serviceIds : effectiveServiceIds;
        serviceTitle = resolvedMulti.serviceTitle;
        servicePrice = Number(resolvedMulti.totalPrice || 0);
        nextDuration = Number(resolvedMulti.totalDurationMinutes || 30);
        resolvedItems = resolvedMulti.items;
      }
    }

    const nextTotal = Number((servicePrice + productsSubtotal).toFixed(2));

    // Sincroniza dados cadastrais do cliente (nome e telemóvel) na base de dados
    const nextClientNameRaw =
      clientName !== undefined ? String(clientName || "").trim() : current.client_name;
    const nextClientName = nextClientNameRaw || current.client_name || "Cliente";

    const nextClientPhoneRaw =
      clientPhone !== undefined ? String(clientPhone || "") : current.client_phone || "";
    const cleanPhoneDigits = nextClientPhoneRaw.replace(/\D/g, "");

    const syncedClient = await upsertClientByPhone(ctx.supabase, {
      name: nextClientName,
      phone: cleanPhoneDigits,
      existingClientId: current.client_id || null,
    });

    const finalPhone =
      syncedClient.cleanPhone ||
      (cleanPhoneDigits.length >= 8 ? cleanPhoneDigits : "00000000000");

    const calculatedEndTime = current.appointment_time
      ? addMinutesToTimeStr(current.appointment_time, nextDuration)
      : null;

    const baseUpdatePayload = {
      client_name: syncedClient.clientName || nextClientName,
      client_phone: finalPhone,
      clean_phone: finalPhone,
      service_id: effectiveServiceId,
      service: serviceTitle,
      duration_minutes: nextDuration,
      price: nextTotal,
      total_price: nextTotal,
      updated_at: new Date().toISOString(),
    };

    if (syncedClient.clientId) {
      baseUpdatePayload.client_id = syncedClient.clientId;
    }

    if (calculatedEndTime) {
      baseUpdatePayload.end_time = calculatedEndTime;
    }

    // Recalcula a comissão do barbeiro (Matheus = 100%; Colaboradores = 50% serviços + 10% produtos)
    if (current.barber_id) {
      const { data: bData } = await ctx.supabase
        .from("barbers")
        .select("id, name, phone, role, commission_percent, commission_rate, permissions")
        .eq("id", current.barber_id)
        .maybeSingle();

      const fin = calculateAppointmentFinance(
        {
          ...current,
          price: nextTotal,
          total_price: nextTotal,
          notes: current.notes,
        },
        bData
      );
      baseUpdatePayload.barber_commission_amount = fin.commissionAmount;
    }

    // Tenta gravar incluindo a coluna `service_ids` (uuid[]) com fallback automático caso a coluna ainda não exista no banco remoto
    let updateErr = null;
    const withArrayRes = await ctx.supabase
      .from("appointments")
      .update({
        ...baseUpdatePayload,
        service_ids: effectiveServiceIds,
      })
      .eq("id", appointmentId);

    if (withArrayRes.error) {
      const fallbackUpdateRes = await ctx.supabase
        .from("appointments")
        .update(baseUpdatePayload)
        .eq("id", appointmentId);
      updateErr = fallbackUpdateRes.error;
    }

    if (updateErr) {
      return { error: `Não foi possível atualizar o atendimento: ${updateErr.message}` };
    }

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/financeiro");
    revalidatePath("/admin/clientes");

    return {
      success: true,
      appointmentId,
      clientId: syncedClient.clientId || current.client_id || null,
      clientName: baseUpdatePayload.client_name,
      clientPhone: finalPhone === "00000000000" ? "" : finalPhone,
      serviceId: effectiveServiceId,
      serviceIds: effectiveServiceIds,
      serviceName: serviceTitle,
      servicePrice,
      productsSubtotal,
      newTotal: nextTotal,
      durationMinutes: nextDuration,
      endTime: calculatedEndTime ? calculatedEndTime.slice(0, 5) : null,
      items: resolvedItems,
    };
  } catch (err) {
    return { error: err?.message || "Erro inesperado ao atualizar o atendimento." };
  }
}

const WEEKDAY_LABELS_PT = {
  domingo: "Domingo",
  segunda: "Segunda-feira",
  terca: "Terça-feira",
  quarta: "Quarta-feira",
  quinta: "Quinta-feira",
  sexta: "Sexta-feira",
  sabado: "Sábado",
};

/**
 * Consulta a disponibilidade real de um profissional em uma data específica:
 * - Expediente semanal (`barber_schedules`) -> horário de abertura, fecho e se o dia é útil;
 * - Exceções/bloqueios (`barber_exceptions` / `barber_schedule_overrides`), `blocked_dates` e `barber_leaves`;
 * - Agendamentos ativos já ocupados no dia (excluindo `excludeAppointmentId`).
 */
async function resolveDayAvailabilityForBarber(
  supabase,
  { barberId, targetDate, excludeAppointmentId = null }
) {
  const cleanDate = String(targetDate || todayInShop()).slice(0, 10);
  const dow = dayOfWeekFromDate(cleanDate);
  const weekdayLabel = WEEKDAY_LABELS_PT[dow] || dow;
  const defaultOpen = "09:00";
  const defaultClose = dow === "domingo" ? "12:30" : "20:30";

  let scheduleOpen = defaultOpen;
  let scheduleClose = defaultClose;
  let isDayOff = false;
  let closedReason = null;

  const { start: dayStartIso, end: dayEndIso } = dayRange(cleanDate);

  const [scheduleRows, excRes, blockedRes, leavesRes, apptsRes] = await Promise.all([
    listSchedule(barberId).catch(() => []),
    supabase
      .from("barber_exceptions")
      .select("id, barber_id, exception_date, start_time, end_time, is_available, is_blocked, reason")
      .eq("barber_id", barberId)
      .eq("exception_date", cleanDate),
    supabase
      .from("blocked_dates")
      .select("id, barber_id, date, reason")
      .or(`barber_id.eq.${barberId},barber_id.is.null`)
      .eq("date", cleanDate),
    supabase
      .from("barber_leaves")
      .select("id, barber_id, date, start_date, end_date, reason")
      .or(`barber_id.eq.${barberId},barber_id.is.null`),
    supabase
      .from("appointments")
      .select(
        "id, barber_id, client_name, appointment_date, appointment_time, start_time, end_time, duration_minutes, status"
      )
      .eq("barber_id", barberId)
      .or(
        `appointment_date.eq.${cleanDate},and(appointment_date.gte.${dayStartIso},appointment_date.lt.${dayEndIso})`
      ),
  ]);

  const dayRow = (scheduleRows || []).find((r) => r.day_of_week === dow) || null;
  if (dayRow) {
    if (dayRow.start_time) scheduleOpen = String(dayRow.start_time).slice(0, 5);
    if (dayRow.end_time) scheduleClose = String(dayRow.end_time).slice(0, 5);
    if (dayRow.active === false) {
      isDayOff = true;
      closedReason = `A barbearia / profissional não funciona neste dia (${weekdayLabel}).`;
    }
  }

  let exceptionsList = excRes?.data || [];
  if (excRes?.error) {
    try {
      const overRes = await supabase
        .from("barber_schedule_overrides")
        .select("id, barber_id, override_date, start_time, end_time, is_day_off, reason")
        .eq("barber_id", barberId)
        .eq("override_date", cleanDate);
      exceptionsList = (overRes?.data || []).map((o) => ({
        ...o,
        exception_date: o.override_date,
        is_available: o.is_day_off === false,
      }));
    } catch {}
  }

  const fullDayException = (exceptionsList || []).find(
    (ex) => !ex.start_time && !ex.end_time && ex.is_available !== true
  );
  if (fullDayException) {
    isDayOff = true;
    closedReason =
      fullDayException.reason ||
      `Data bloqueada na agenda do profissional (${weekdayLabel}).`;
  }

  const blockedRow = Array.isArray(blockedRes?.data) ? blockedRes.data[0] : null;
  if (blockedRow) {
    isDayOff = true;
    closedReason =
      blockedRow.reason || `Data bloqueada para atendimentos (${weekdayLabel}).`;
  }

  const activeLeave = (leavesRes?.data || []).find((lv) => {
    const d = lv.date ? String(lv.date).slice(0, 10) : null;
    const s = lv.start_date ? String(lv.start_date).slice(0, 10) : null;
    const e = lv.end_date ? String(lv.end_date).slice(0, 10) : null;
    return d === cleanDate || (s && e && s <= cleanDate && e >= cleanDate);
  });
  if (activeLeave) {
    isDayOff = true;
    closedReason =
      activeLeave.reason || `Profissional de folga / ausente nesta data (${weekdayLabel}).`;
  }

  const busyIntervals = [];

  // Inclui bloqueios parciais (exceções com intervalo start_time..end_time)
  (exceptionsList || []).forEach((ex) => {
    if (ex.start_time && ex.end_time && ex.is_available === false) {
      const sStr = String(ex.start_time).slice(0, 5);
      const eStr = String(ex.end_time).slice(0, 5);
      const [sh, sm] = sStr.split(":").map(Number);
      const [eh, em] = eStr.split(":").map(Number);
      if (Number.isFinite(sh) && Number.isFinite(sm) && Number.isFinite(eh) && Number.isFinite(em)) {
        const sMin = sh * 60 + sm;
        const eMin = eh * 60 + em;
        if (eMin > sMin) {
          busyIntervals.push({
            id: `exc-${ex.id}`,
            clientName: ex.reason || "Horário bloqueado",
            startStr: sStr,
            endStr: eStr,
            startMin: sMin,
            endMin: eMin,
          });
        }
      }
    }
  });

  // Inclui agendamentos ativos do profissional no dia (excluindo o atendimento que está sendo movido)
  const activeOthers = (apptsRes?.data || []).filter((a) => {
    if (!a) return false;
    if (excludeAppointmentId && String(a.id) === String(excludeAppointmentId)) return false;
    const st = String(a.status || "confirmado").toLowerCase().trim();
    if (st === "cancelado" || st === "cancelled") return false;
    const rawDate = String(a.appointment_date || "");
    if (!rawDate) return false;
    if (rawDate.length === 10 || rawDate.includes("T00:00:00")) {
      return rawDate.slice(0, 10) === cleanDate;
    }
    try {
      const localDate = new Date(rawDate).toLocaleDateString("en-CA", {
        timeZone: "America/Fortaleza",
      });
      return localDate === cleanDate || rawDate.slice(0, 10) === cleanDate;
    } catch {
      return rawDate.slice(0, 10) === cleanDate;
    }
  });

  for (const other of activeOthers) {
    const rawStart = other.start_time || other.appointment_time || "";
    const otherStartStr = String(rawStart).slice(0, 5);
    if (!otherStartStr.includes(":")) continue;
    const [oh, om] = otherStartStr.split(":").map(Number);
    if (!Number.isFinite(oh) || !Number.isFinite(om)) continue;
    const otherStartMin = oh * 60 + om;
    const otherDur = Math.max(10, Number(other.duration_minutes) || 30);

    let otherEndMin = otherStartMin + otherDur;
    if (other.end_time && String(other.end_time).includes(":")) {
      const [eh, em] = String(other.end_time).slice(0, 5).split(":").map(Number);
      if (Number.isFinite(eh) && Number.isFinite(em) && eh * 60 + em > otherStartMin) {
        otherEndMin = eh * 60 + em;
      }
    }

    const endFormatted = `${String(Math.floor(otherEndMin / 60) % 24).padStart(2, "0")}:${String(
      otherEndMin % 60
    ).padStart(2, "0")}`;

    busyIntervals.push({
      id: other.id,
      clientName: other.client_name || "Outro cliente",
      startStr: otherStartStr,
      endStr: endFormatted,
      startMin: otherStartMin,
      endMin: otherEndMin,
    });
  }

  return {
    date: cleanDate,
    weekdayLabel,
    isDayOff,
    closedReason,
    startTime: scheduleOpen,
    endTime: scheduleClose,
    busyIntervals,
  };
}

/**
 * Retorna os horários de funcionamento, bloqueios e intervalos ocupados do profissional
 * em qualquer data escolhida no modal "Mover / Reorganizar Atendimento".
 */
export async function getMoveAppointmentDayContext({
  appointmentId = null,
  barberId,
  targetDate,
}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return authError(ctx);

    if (!barberId || !targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate).slice(0, 10))) {
      return { error: "Data ou profissional inválido." };
    }

    const dayCtx = await resolveDayAvailabilityForBarber(ctx.supabase, {
      barberId,
      targetDate: String(targetDate).slice(0, 10),
      excludeAppointmentId: appointmentId,
    });

    return {
      ok: true,
      ...dayCtx,
    };
  } catch (err) {
    return {
      error: err?.message || "Não foi possível consultar a agenda desta data.",
    };
  }
}

/**
 * Reposiciona (move) um atendimento na timeline para um novo dia (`newDate`, opcional) e/ou
 * novo horário (`newStartTime`), recalculando automaticamente o `end_time` com base na
 * duração total dos serviços e validando:
 * 1. Se a barbearia / profissional funciona na data escolhida (ex: segunda-feira / folgas);
 * 2. Respeito ao horário de abertura e fim do expediente do profissional naquele dia;
 * 3. Ausência de conflito direto (sobreposição) com outros agendamentos ativos do mesmo profissional no dia.
 */
export async function moveAppointmentTime({ appointmentId, newStartTime, newDate = null }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return authError(ctx);

    if (!appointmentId) {
      return { error: "Atendimento inválido." };
    }

    const cleanStart = String(newStartTime || "").trim().slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(cleanStart)) {
      return { error: "Selecione um horário válido no formato HH:MM." };
    }

    const [sh, sm] = cleanStart.split(":").map(Number);
    if (!Number.isFinite(sh) || !Number.isFinite(sm) || sh < 0 || sh > 23 || sm < 0 || sm > 59) {
      return { error: "Horário selecionado inválido." };
    }
    const newStartMin = sh * 60 + sm;

    let cleanNewDate = null;
    if (newDate !== null && newDate !== undefined && String(newDate).trim() !== "") {
      cleanNewDate = String(newDate).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanNewDate)) {
        return { error: "Selecione uma data válida (AAAA-MM-DD)." };
      }
    }

    // 1. Carrega o agendamento atual
    let current = null;
    const primaryRes = await ctx.supabase
      .from("appointments")
      .select(
        "id, barber_id, client_name, appointment_date, appointment_time, end_time, duration_minutes, service_id, service_ids, service, status"
      )
      .eq("id", appointmentId)
      .maybeSingle();

    if (!primaryRes.error && primaryRes.data) {
      current = primaryRes.data;
    } else {
      const fallbackRes = await ctx.supabase
        .from("appointments")
        .select(
          "id, barber_id, client_name, appointment_date, appointment_time, end_time, duration_minutes, service_id, service, status"
        )
        .eq("id", appointmentId)
        .maybeSingle();
      current = fallbackRes.data;
    }

    if (!current) {
      return { error: "Atendimento não encontrado." };
    }

    if (!canAccessAppointment(ctx, current.barber_id)) {
      return { error: "Sem permissão para mover este atendimento." };
    }

    const targetDate = cleanNewDate || String(current.appointment_date || todayInShop()).slice(0, 10);
    const barberId = current.barber_id;

    // 2. Calcula a duração correta somando todos os serviços selecionados no atendimento
    let totalDuration = Number(current.duration_minutes) || 0;
    const candidateServiceIds =
      Array.isArray(current.service_ids) && current.service_ids.length > 0
        ? current.service_ids
        : current.service_id
        ? [current.service_id]
        : [];

    if (candidateServiceIds.length > 0 || current.service) {
      const resolvedMulti = await resolveMultipleBarberServicesDetails(
        ctx.supabase,
        barberId,
        candidateServiceIds,
        current.service
      );
      if (resolvedMulti.totalDurationMinutes > 0) {
        totalDuration = Math.max(totalDuration, resolvedMulti.totalDurationMinutes);
      }
    }
    if (!totalDuration || totalDuration < 10) {
      totalDuration = 30;
    }

    const newEndMin = newStartMin + totalDuration;
    const formattedStartTime = `${cleanStart}:00`;
    const formattedEndTime = addMinutesToTimeStr(formattedStartTime, totalDuration);
    const cleanEnd = formattedEndTime.slice(0, 5);

    // 3. Valida expediente, folgas e agendamentos ocupados na data de destino
    const dayCtx = await resolveDayAvailabilityForBarber(ctx.supabase, {
      barberId,
      targetDate,
      excludeAppointmentId: appointmentId,
    });

    if (dayCtx.isDayOff) {
      return {
        error:
          dayCtx.closedReason ||
          "A barbearia / profissional não funciona nesta data. Escolha outro dia.",
      };
    }

    const [openH, openM] = dayCtx.startTime.split(":").map(Number);
    const [closeH, closeM] = dayCtx.endTime.split(":").map(Number);
    const openMin = (Number.isFinite(openH) ? openH : 9) * 60 + (Number.isFinite(openM) ? openM : 0);
    const closeMin =
      (Number.isFinite(closeH) ? closeH : 20) * 60 + (Number.isFinite(closeM) ? closeM : 30);

    if (newStartMin < openMin) {
      return {
        error: `O horário escolhido (${cleanStart}) é anterior à abertura do expediente (${dayCtx.startTime}).`,
      };
    }

    if (newEndMin > closeMin) {
      return {
        error: `O atendimento (${cleanStart} – ${cleanEnd}, ${totalDuration} min) ultrapassa o fim do expediente (${dayCtx.endTime}). Escolha um horário mais cedo.`,
      };
    }

    // 4. Verifica conflitos diretos de horário com outros agendamentos ativos do mesmo barbeiro na data escolhida
    for (const other of dayCtx.busyIntervals) {
      if (newStartMin < other.endMin && newEndMin > other.startMin) {
        return {
          error: `Conflito de horário com ${other.clientName} (${other.startStr} – ${other.endStr}). Escolha um horário livre.`,
        };
      }
    }

    // 5. Atualiza appointment_date, appointment_time, start_time, end_time e duration_minutes no Supabase
    const baseUpdatePayload = {
      appointment_date: targetDate,
      appointment_time: formattedStartTime,
      end_time: formattedEndTime,
      duration_minutes: totalDuration,
      updated_at: new Date().toISOString(),
    };

    let updateErr = null;
    const withStartRes = await ctx.supabase
      .from("appointments")
      .update({
        ...baseUpdatePayload,
        start_time: formattedStartTime,
      })
      .eq("id", appointmentId);

    if (withStartRes.error) {
      const fallbackUpdateRes = await ctx.supabase
        .from("appointments")
        .update(baseUpdatePayload)
        .eq("id", appointmentId);
      updateErr = fallbackUpdateRes.error;
    }

    if (updateErr) {
      return {
        error: `Não foi possível mover o atendimento: ${updateErr.message}`,
      };
    }

    revalidatePath("/admin/agenda");

    return {
      success: true,
      appointmentId,
      date: targetDate,
      startTime: cleanStart,
      endTime: cleanEnd,
      durationMinutes: totalDuration,
    };
  } catch (err) {
    return {
      error: err?.message || "Erro inesperado ao reposicionar o horário do atendimento.",
    };
  }
}

/**
 * Quita em lote ("Quitar Tudo em Lote") todas as comandas pendentes / fiados de um cliente:
 * - Atualiza status = 'concluido', payment_status = 'pago', payment_method = paymentMethod
 * - Atualiza fiado_records (status = 'settled', settled_at = now()) quando existente
 * - Registra entradas correspondentes no Livro Caixa (cash_flow / cash_entries)
 * - Transfere as comissões retidas para o extrato liberado de cada barbeiro
 */
export async function settleCustomerFiadoBatch({
  appointmentIds = [],
  paymentMethod = "pix",
  customerName = "Cliente",
}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return authError(ctx);

    const validIds = Array.from(
      new Set(
        (Array.isArray(appointmentIds) ? appointmentIds : [])
          .map((id) => (id ? String(id).trim() : ""))
          .filter(Boolean)
      )
    );

    if (validIds.length === 0) {
      return { error: "Nenhuma comanda pendente selecionada para quitação." };
    }

    const validMethod = ["pix", "cartao", "dinheiro", "cash", "card"].includes(
      String(paymentMethod).toLowerCase()
    )
      ? String(paymentMethod).toLowerCase()
      : "pix";

    const { data: appts, error: fetchErr } = await ctx.supabase
      .from("appointments")
      .select(
        "id, barber_id, client_name, service, price, total_price, notes, payment_status, services(name, price), barbers(id, name, role, commission_percent, commission_rate)"
      )
      .in("id", validIds);

    if (fetchErr || !Array.isArray(appts) || appts.length === 0) {
      return { error: "Não foi possível localizar as comandas para quitação em lote." };
    }

    let totalSettledAmount = 0;
    let totalSettledCommission = 0;
    let settledCount = 0;

    for (const appt of appts) {
      if (!canAccessAppointment(ctx, appt.barber_id)) continue;

      const fin = calculateAppointmentFinance(appt, appt.barbers);
      const amountToPay = Number(fin.totalAmount || appt.total_price || appt.price || 0);
      const commAmount = Number(fin.commissionAmount || 0);
      const desc = `Quitação de Fiado — ${appt.client_name || customerName} (${appt.service || appt.services?.name || "Atendimento"})`;

      try {
        await ctx.supabase.rpc("register_payment_atomic", {
          p_appointment_id: appt.id,
          p_barber_id: appt.barber_id,
          p_payment_method: validMethod,
          p_amount: amountToPay,
          p_description: desc,
        });
      } catch {}

      const { error: updErr } = await ctx.supabase
        .from("appointments")
        .update({
          status: "concluido",
          payment_status: "pago",
          payment_method: validMethod,
          price: amountToPay,
          total_price: amountToPay,
          barber_commission_amount: commAmount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", appt.id);

      if (!updErr) {
        settledCount += 1;
        totalSettledAmount = Number((totalSettledAmount + amountToPay).toFixed(2));
        totalSettledCommission = Number((totalSettledCommission + commAmount).toFixed(2));

        // Atualiza fiado_records se a tabela estiver presente
        try {
          await ctx.supabase
            .from("fiado_records")
            .update({
              status: "settled",
              settled_payment_method: validMethod,
              settled_at: new Date().toISOString(),
              settled_by_barber_id: ctx.barber.id,
            })
            .eq("appointment_id", appt.id);
        } catch {}
      }
    }

    revalidatePath("/admin/agenda");
    revalidatePath("/admin/financeiro");
    revalidatePath("/admin/financeiro/completo");
    revalidatePath("/admin/clientes");

    return {
      success: true,
      settledCount,
      totalSettledAmount,
      totalSettledCommission,
      paymentMethod: validMethod,
    };
  } catch (err) {
    return {
      error: err?.message || "Erro ao quitar comandas em lote.",
    };
  }
}

