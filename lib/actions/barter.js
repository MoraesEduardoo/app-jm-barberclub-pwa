"use server";

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { hasPermission, PERMISSION_KEYS } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function authError(ctx) {
  return new Error(ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED");
}

/**
 * Lista todos os clientes com permuta ativa.
 */
export async function listActiveBarterClients() {
  const ctx = await requireBarber();
  if (ctx.error) throw authError(ctx);

  const { data, error } = await ctx.supabase
    .from("clients")
    .select("id, name, phone, clean_phone, notes, is_barter, barter_category, barter_notes, barter_includes_william, barter_updated_at, created_at")
    .eq("is_barter", true)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Erro ao listar parceiros de permuta: ${error.message}`);
  }

  return data || [];
}

/**
 * Busca clientes existentes por nome ou telefone (para auto-complete na busca de parceiro).
 */
export async function searchClientsForBarter(searchTerm = "") {
  const ctx = await requireBarber();
  if (ctx.error) throw authError(ctx);

  const term = String(searchTerm || "").trim();
  if (!term || term.length < 2) return [];

  const cleanDigits = term.replace(/\D/g, "");

  let query = ctx.supabase
    .from("clients")
    .select("id, name, phone, clean_phone, is_barter, barter_category, barter_notes, barter_includes_william")
    .limit(10);

  if (cleanDigits.length >= 3) {
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${cleanDigits}%,clean_phone.ilike.%${cleanDigits}%`);
  } else {
    query = query.ilike("name", `%${term}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Erro na busca de clientes: ${error.message}`);
  }

  return data || [];
}

/**
 * Ativa a permuta para um cliente existente (ou cria caso seja novo).
 */
export async function setClientBarterStatus({
  clientId = null,
  name = "",
  phone = "",
  barterCategory = null,
  barterNotes = "",
  barterIncludesWilliam = false,
  includesWilliam = false,
  isBarter = true,
}) {
  const ctx = await requireBarber();
  if (ctx.error) throw authError(ctx);

  const admin = createAdminClient();
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  const trimmedCategory = barterCategory && String(barterCategory).trim() ? String(barterCategory).trim() : null;
  const trimmedNotes = String(barterNotes || "").trim();
  const effectiveIncludesWilliam = Boolean(barterIncludesWilliam || includesWilliam);

  let targetClientId = clientId;

  // 1. Se não foi passado clientId mas temos phone, procura cliente existente
  if (!targetClientId && cleanPhone.length >= 8) {
    const { data: existing } = await admin
      .from("clients")
      .select("id")
      .or(`phone.eq.${cleanPhone},clean_phone.eq.${cleanPhone}`)
      .maybeSingle();

    if (existing?.id) {
      targetClientId = existing.id;
    }
  }

  // 2. Se ainda não temos cliente e temos dados para criar, cria cliente
  if (!targetClientId) {
    const effectiveName = String(name || "").trim() || "Parceiro de Permuta";
    if (cleanPhone.length < 8) {
      throw new Error("Telefone/WhatsApp válido é obrigatório para cadastrar parceiro.");
    }

    const { data: created, error: createErr } = await admin
      .from("clients")
      .insert({
        name: effectiveName,
        phone: cleanPhone,
        clean_phone: cleanPhone,
        is_barter: Boolean(isBarter),
        barter_category: isBarter ? (trimmedCategory || null) : null,
        barter_notes: trimmedNotes || null,
        barter_includes_william: isBarter ? effectiveIncludesWilliam : false,
        barter_updated_at: new Date().toISOString(),
      })
      .select("id, name, phone, is_barter, barter_category, barter_notes, barter_includes_william")
      .single();

    if (createErr || !created) {
      throw new Error(`Erro ao cadastrar parceiro: ${createErr?.message || "falha ao salvar"}`);
    }

    revalidatePath("/admin/clientes");
    revalidatePath("/admin/agenda");
    return { success: true, client: created };
  }

  // 3. Atualiza o cliente existente
  const updatePayload = {
    is_barter: Boolean(isBarter),
    barter_category: isBarter ? (trimmedCategory || null) : null,
    barter_notes: isBarter ? (trimmedNotes || null) : null,
    barter_includes_william: isBarter ? effectiveIncludesWilliam : false,
    barter_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (name && String(name).trim()) {
    updatePayload.name = String(name).trim();
  }

  const { data: updated, error: updErr } = await admin
    .from("clients")
    .update(updatePayload)
    .eq("id", targetClientId)
    .select("id, name, phone, is_barter, barter_category, barter_notes, barter_includes_william")
    .single();

  if (updErr || !updated) {
    throw new Error(`Erro ao atualizar permuta: ${updErr?.message || "falha ao salvar"}`);
  }

  // 4. Se a permuta foi ativada, atualiza também os agendamentos futuros pendentes
  // Busca barbeiros Matheus e William
  const { data: targetBarbers } = await admin
    .from("barbers")
    .select("id, role, name");

  const matheusId = targetBarbers?.find(
    (b) => b.role === "admin" || (b.name && b.name.toLowerCase().includes("matheus"))
  )?.id;

  const williamId = targetBarbers?.find(
    (b) => b.name && b.name.toLowerCase().includes("william")
  )?.id;

  if (isBarter) {
    // 4.1 Matheus sempre participa quando a permuta está ativa
    if (matheusId) {
      await admin
        .from("appointments")
        .update({
          is_barter: true,
          barter_category: trimmedCategory || null,
          barter_notes: trimmedNotes || null,
          barter_includes_william: effectiveIncludesWilliam,
          payment_status: "permuta",
          barber_commission_amount: 0.00,
          tip_amount: 0.00,
        })
        .eq("client_id", targetClientId)
        .eq("barber_id", matheusId)
        .in("status", ["agendado", "pendente", "confirmado"]);
    }

    // 4.2 William participa apenas se effectiveIncludesWilliam for true
    if (williamId) {
      if (effectiveIncludesWilliam) {
        await admin
          .from("appointments")
          .update({
            is_barter: true,
            barter_category: trimmedCategory || null,
            barter_notes: trimmedNotes || null,
            barter_includes_william: true,
            payment_status: "permuta",
            barber_commission_amount: 0.00,
            tip_amount: 0.00,
          })
          .eq("client_id", targetClientId)
          .eq("barber_id", williamId)
          .in("status", ["agendado", "pendente", "confirmado"]);
      } else {
        // Se a permuta NÃO inclui o William, assegura que agendamentos pendentes com o William sejam normais
        await admin
          .from("appointments")
          .update({
            is_barter: false,
            barter_category: null,
            barter_notes: null,
            barter_includes_william: false,
            payment_status: "pendente",
          })
          .eq("client_id", targetClientId)
          .eq("barber_id", williamId)
          .in("status", ["agendado", "pendente", "confirmado"]);
      }
    }
  } else {
    // 4.3 Se a permuta foi revogada, remove a permuta dos agendamentos futuros pendentes (de Matheus e William)
    const barberIds = [matheusId, williamId].filter(Boolean);
    if (barberIds.length > 0) {
      await admin
        .from("appointments")
        .update({
          is_barter: false,
          barter_category: null,
          barter_notes: null,
          barter_includes_william: false,
          payment_status: "pendente",
        })
        .eq("client_id", targetClientId)
        .in("barber_id", barberIds)
        .in("status", ["agendado", "pendente", "confirmado"]);
    }
  }

  revalidatePath("/admin/clientes");
  revalidatePath("/admin/agenda");
  return { success: true, client: updated };
}

/**
 * Encerra/desativa a permuta de um cliente (revogação).
 * Preserva histórico passado e faz futuros agendamentos voltarem a ser normais.
 */
export async function revokeClientBarter(clientId) {
  if (!clientId) throw new Error("ID do cliente não informado.");
  return setClientBarterStatus({
    clientId,
    isBarter: false,
    barterNotes: "",
  });
}
