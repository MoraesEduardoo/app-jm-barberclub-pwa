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

    // Sincroniza dinamicamente o cálculo financeiro e de comissão por atendimento
    const enrichedRows = filteredRows.map((row) => {
      const fin = calculateAppointmentFinance(row, row.barbers);
      return {
        ...row,
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

export async function registerPayment(id, { payment_method, amount, description }) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };

    const owned = await loadOwnedAppointment(ctx, id);
    if (owned.error) return { error: owned.error };

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return { error: "Valor de pagamento inválido." };
    }

    const barberId = owned.appointment.barber_id;

    // Carrega dados completos do agendamento e do barbeiro para comissão + cálculo de conclusão antecipada (10 em 10 min)
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

    const fin = calculateAppointmentFinance(
      {
        ...currentAppt,
        price: parsedAmount,
        total_price: parsedAmount,
      },
      barberData
    );

    const commissionAmount = fin.commissionAmount;
    const earlyTiming = computeEarlyCompletionTiming(currentAppt);

    // 1. Tenta a função atômica RPC register_payment_atomic (para registar em cash_flow se aplicável)
    try {
      await ctx.supabase.rpc("register_payment_atomic", {
        p_appointment_id: id,
        p_barber_id: barberId,
        p_payment_method: payment_method,
        p_amount: parsedAmount,
        p_description: description?.trim() || null,
      });
    } catch {
      // Continua para atualização explícita e sincronizada abaixo
    }

    // 2. Garante a gravação exata do pagamento, comissão e liberação antecipada de slots (10 em 10 min)
    const { error: updateError } = await ctx.supabase
      .from("appointments")
      .update({
        status: "concluido",
        payment_status: "pago",
        payment_method,
        price: parsedAmount,
        total_price: parsedAmount,
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
      duration_minutes: earlyTiming.durationMinutes,
      end_time: earlyTiming.endTime.slice(0, 5),
      freedMinutes: earlyTiming.freedMinutes,
      wasEarly: earlyTiming.wasEarly,
      commissionAmount,
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
    const { data: productsData, error: fetchProdErr } = await ctx.supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (fetchProdErr || !productsData || productsData.length === 0) {
      return { error: "Produtos não encontrados no catálogo." };
    }

    const productById = new Map(productsData.map((p) => [p.id, p]));
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

      const { error: stockErr } = await ctx.supabase
        .from("products")
        .update({
          stock_quantity: nextStock,
          updated_at: new Date().toISOString(),
        })
        .eq("id", product.id);

      if (stockErr) {
        // Reverte estoques já abatidos nesta operação
        for (const rb of updatedStockRollbacks) {
          await ctx.supabase
            .from("products")
            .update({ stock_quantity: rb.previousStock })
            .eq("id", rb.productId);
        }
        return {
          error: `Não foi possível atualizar o estoque de "${product.name}": ${stockErr.message}`,
        };
      }

      updatedStockRollbacks.push({
        productId: product.id,
        previousStock: currentStock,
      });

      const unitPrice = Number(product.price || 0);
      const itemSubtotal = Number((unitPrice * item.quantity).toFixed(2));
      totalProductsAddedPrice = Number((totalProductsAddedPrice + itemSubtotal).toFixed(2));

      const isConv = isConvenienceProduct(product);
      const tagPrefix = isConv ? "CONVENIENCIA" : "PRODUTO";
      const formattedSubtotal = itemSubtotal.toFixed(2).replace(".", ",");
      const tagLine = `[${tagPrefix}:${product.id}:${item.quantity}:${unitPrice.toFixed(2)}] ${item.quantity}x ${product.name} (R$ ${formattedSubtotal})`;
      newTagLines.push(tagLine);

      addedItems.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        unitPrice,
        subtotal: itemSubtotal,
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
      // Reverte o estoque de todos os produtos em caso de falha na atualização do agendamento
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

    const match = String(rawLine).match(/^\[(PRODUTO|CONVENIENCIA):([^:]+):(\d+):([0-9.]+)\]/);
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
 * Altera o serviço e/ou os dados cadastrais do cliente (nome e telemóvel) de um agendamento existente,
 * recalculando automaticamente:
 * - `client_name`, `client_phone`, `clean_phone`, `client_id` (sincronizando na tabela `public.clients` usando o telefone como chave primária)
 * - `service_id` e nome do serviço (`service`)
 * - `duration_minutes` e `end_time` (respeitando `custom_duration` de `barber_services` se houver profissional vinculado)
 * - `price` e `total_price` (respeitando `custom_price` de `barber_services` + soma de produtos vinculados ao atendimento)
 * - `barber_commission_amount` caso o atendimento já esteja pago, mantendo o Caixa 100% sincronizado.
 */
export async function updateAppointmentService({
  appointmentId,
  serviceId,
  clientName,
  clientPhone,
}) {
  try {
    const ctx = await requireBarber();
    if (ctx.error) return authError(ctx);

    if (!appointmentId) {
      return { error: "Agendamento inválido para atualização." };
    }

    const { data: current, error: fetchErr } = await ctx.supabase
      .from("appointments")
      .select(
        "id, barber_id, client_id, client_name, client_phone, service_id, service, appointment_time, duration_minutes, price, total_price, notes, status, payment_status"
      )
      .eq("id", appointmentId)
      .maybeSingle();

    if (fetchErr || !current) {
      return { error: "Agendamento não encontrado." };
    }

    if (!canAccessAppointment(ctx, current.barber_id)) {
      return { error: "Sem permissão para editar este agendamento." };
    }

    const effectiveServiceId = serviceId || current.service_id;
    const productsSubtotal = sumAttachedProductsFromNotes(current.notes);

    let serviceTitle = current.service || "Serviço";
    let servicePrice = Math.max(0, Number(current.price || 0) - productsSubtotal);
    let nextDuration = Number(current.duration_minutes || 30);
    let customDuration = null;
    let customPrice = null;

    if (effectiveServiceId) {
      const resolved = await resolveBarberServiceDetails(
        ctx.supabase,
        current.barber_id,
        effectiveServiceId
      );
      if (resolved.serviceTitle) {
        serviceTitle = resolved.serviceTitle;
        servicePrice = Number(resolved.price || 0);
        nextDuration = Number(resolved.durationMinutes || 30);
        customDuration = resolved.customDuration;
        customPrice = resolved.customPrice;
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

    const updatePayload = {
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
      updatePayload.client_id = syncedClient.clientId;
    }

    if (current.appointment_time) {
      updatePayload.end_time = addMinutesToTimeStr(current.appointment_time, nextDuration);
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
      updatePayload.barber_commission_amount = fin.commissionAmount;
    }

    const { error: updateErr } = await ctx.supabase
      .from("appointments")
      .update(updatePayload)
      .eq("id", appointmentId);

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
      clientName: updatePayload.client_name,
      clientPhone: finalPhone === "00000000000" ? "" : finalPhone,
      serviceId: effectiveServiceId,
      serviceName: serviceTitle,
      servicePrice,
      productsSubtotal,
      newTotal: nextTotal,
      durationMinutes: nextDuration,
      customDuration,
      customPrice,
    };
  } catch (err) {
    return { error: err?.message || "Erro inesperado ao atualizar o atendimento." };
  }
}
