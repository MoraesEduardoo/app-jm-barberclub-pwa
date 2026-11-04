"use server"

import { revalidatePath } from "next/cache";
import { requireBarber, requireChefe } from "@/lib/auth-server";
import { createAdminClient, findAuthUserByBarberId } from "@/lib/supabase/admin";
import { phoneToAuthEmail, phoneDigits } from "@/lib/auth-identity";
import { DEFAULT_PERMISSIONS, PERMISSION_KEYS, isChefe } from "@/lib/auth";
import {
  calculateAppointmentFinance,
  getBarberCommissionRates,
} from "@/lib/commission";
import bcrypt from "bcryptjs";

function fail(ctx) {
  throw new Error(ctx.error === "FORBIDDEN" ? "Sem permissão para esta ação." : "AUTH_EXPIRED");
}

export async function listTeam() {
  const ctx = await requireBarber();
  if (ctx.error) fail(ctx);

  const canViewAll =
    isChefe(ctx.barber) ||
    ctx.barber?.role === "manager" ||
    Boolean(ctx.barber?.permissions?.[PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS]);

  let query = ctx.supabase
    .from("barbers")
    .select("*")
    .order("role", { ascending: true })
    .order("name", { ascending: true });

  if (!canViewAll) {
    query = query.eq("id", ctx.barber.id);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Não foi possível carregar a equipe: ${error.message}`);

  // Consulta analítica de performance da vista view_barber_performance (best-effort)
  const perfMap = new Map();
  try {
    const { data: perfData } = await ctx.supabase
      .from("view_barber_performance")
      .select("barber_id, total_concluidos, faturamento_bruto, total_comissao, ticket_medio");
    if (perfData && Array.isArray(perfData)) {
      perfData.forEach((p) => perfMap.set(p.barber_id, p));
    }
  } catch {}

  return (data || []).map((b) => {
    const rates = getBarberCommissionRates(b);
    const perms = b.permissions || {};
    const specialties = Array.isArray(perms.specialties) ? perms.specialties : null;
    const perf = perfMap.get(b.id) || {};
    const faturamentoBruto = Number(perf.faturamento_bruto || 0);

    return {
      id: b.id,
      name: b.name,
      phone: b.phone,
      role: b.role,
      active: b.active !== false && b.is_active !== false,
      avatar_url: b.avatar_url || null,
      is_owner: rates.isOwner,
      commission_percent: rates.servicePercent,
      commission_rate: rates.servicePercent,
      product_commission_percent: rates.productPercent,
      commission_rule_label: rates.ruleLabel,
      specialties,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        ...perms,
        service_commission_percent: rates.servicePercent,
        product_commission_percent: rates.productPercent,
      },
      performance: {
        total_concluidos: perf.total_concluidos || 0,
        faturamento_bruto: faturamentoBruto,
        total_comissao: rates.isOwner
          ? faturamentoBruto
          : Number(perf.total_comissao || 0),
        ticket_medio: Number(perf.ticket_medio || 0),
      },
    };
  });
}

/**
 * Atualiza a comissão sobre serviços em número inteiro (0 a 100).
 * Exclusivo para utilizadores com cargo Chefe / Admin.
 */
export async function updateTeamMemberCommission(id, commissionPercent) {
  const ctx = await requireChefe();
  if (ctx.error || !isChefe(ctx.barber)) {
    throw new Error("Apenas o Chefe / Admin tem permissão para alterar percentagens de comissão.");
  }

  if (!id) throw new Error("Identificador do colaborador inválido.");

  const parsed = Number(commissionPercent);
  const value = Math.min(100, Math.max(0, Math.round(Number.isFinite(parsed) ? parsed : 50)));

  const { data: current, error: fetchErr } = await ctx.supabase
    .from("barbers")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !current) {
    throw new Error(`Colaborador não encontrado: ${fetchErr?.message || "ID inválido"}`);
  }

  const updatedPermissions = {
    ...DEFAULT_PERMISSIONS,
    ...(current.permissions || {}),
    service_commission_percent: value,
  };

  const payload = {
    commission_percent: value,
    permissions: updatedPermissions,
    updated_at: new Date().toISOString(),
  };

  if ("commission_rate" in current) {
    payload.commission_rate = value;
  }

  const { error } = await ctx.supabase
    .from("barbers")
    .update(payload)
    .eq("id", id);

  if (error) throw new Error(`Não foi possível atualizar a comissão: ${error.message}`);

  revalidatePath("/admin/equipe");
  revalidatePath("/admin/financeiro");
  revalidatePath("/admin/agenda");
  return value;
}

/**
 * Atualiza regras avançadas de comissão: serviços e produtos separadamente.
 * Valida rigorosamente se a sessão ativa pertence ao Chefe / Admin.
 */
export async function updateTeamMemberAdvancedCommissions(id, { servicesPercent, productsPercent }) {
  const ctx = await requireChefe();
  if (ctx.error || !isChefe(ctx.barber)) {
    throw new Error("Apenas o Chefe / Admin tem permissão para alterar percentagens de comissão.");
  }

  if (!id) {
    throw new Error("Identificador do colaborador não fornecido.");
  }

  const parsedServices = Number(servicesPercent);
  const parsedProducts = Number(productsPercent);

  const cleanServices = Math.min(
    100,
    Math.max(0, Math.round(Number.isFinite(parsedServices) ? parsedServices : 50))
  );
  const cleanProducts = Math.min(
    100,
    Math.max(0, Math.round(Number.isFinite(parsedProducts) ? parsedProducts : 10))
  );

  const { data: current, error: fetchErr } = await ctx.supabase
    .from("barbers")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !current) {
    throw new Error(`Barbeiro não encontrado: ${fetchErr?.message || "ID inválido"}`);
  }

  const updatedPermissions = {
    ...DEFAULT_PERMISSIONS,
    ...(current.permissions || {}),
    service_commission_percent: cleanServices,
    product_commission_percent: cleanProducts,
  };

  const updatePayload = {
    commission_percent: cleanServices,
    permissions: updatedPermissions,
    updated_at: new Date().toISOString(),
  };

  if ("commission_rate" in current) {
    updatePayload.commission_rate = cleanServices;
  }
  if ("product_commission_percent" in current) {
    updatePayload.product_commission_percent = cleanProducts;
  }
  if ("product_commission_rate" in current) {
    updatePayload.product_commission_rate = cleanProducts;
  }

  const { error } = await ctx.supabase
    .from("barbers")
    .update(updatePayload)
    .eq("id", id);

  if (error) throw new Error(`Não foi possível atualizar as comissões: ${error.message}`);

  revalidatePath("/admin/equipe");
  revalidatePath("/admin/financeiro");
  revalidatePath("/admin/agenda");

  return {
    success: true,
    commission_percent: cleanServices,
    product_commission_percent: cleanProducts,
  };
}

/**
 * Busca especialidades / serviços habilitados e configurações personalizadas (custom_duration, custom_price)
 * do colaborador diretamente na tabela `barber_services`.
 */
export async function getBarberServicesConfig(barberId) {
  const ctx = await requireBarber();
  if (ctx.error) fail(ctx);

  const admin = createAdminClient();
  const [servicesRes, bsRes] = await Promise.all([
    admin.from("services").select("*"),
    admin.from("barber_services").select("*").eq("barber_id", barberId),
  ]);

  const allServices = [...(servicesRes.data || [])]
    .filter((s) => s.active !== false && s.is_active !== false)
    .sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.display_order)) ? Number(a.display_order) : 9999;
      const orderB = Number.isFinite(Number(b?.display_order)) ? Number(b.display_order) : 9999;
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.name || "").localeCompare(String(b?.name || ""), "pt-BR");
    });
  const bsRows = bsRes.data || [];
  const bsByServiceId = new Map(bsRows.map((row) => [String(row.service_id), row]));

  return allServices.map((s) => {
    const row = bsByServiceId.get(String(s.id));
    const defaultDuration = Number(s.default_duration_minutes ?? s.duration_minutes ?? 30);
    const rawPrice = Number(s.price || 0);
    const defaultPrice = rawPrice >= 1000 ? rawPrice / 100 : rawPrice;

    const rawCustomDur = row ? row.custom_duration ?? row.custom_duration_minutes ?? null : null;
    const customDuration =
      rawCustomDur !== null && rawCustomDur !== undefined && Number(rawCustomDur) > 0
        ? Number(rawCustomDur)
        : null;

    const rawCustomPrice = row ? row.custom_price : null;
    const customPrice =
      rawCustomPrice !== null && rawCustomPrice !== undefined && Number(rawCustomPrice) >= 0
        ? Number(Number(rawCustomPrice).toFixed(2))
        : null;

    const isActive = row ? row.is_active !== false : true;

    return {
      service_id: s.id,
      name: s.name,
      category: s.category || "cabelo",
      default_duration_minutes: defaultDuration,
      default_price: Number(defaultPrice.toFixed(2)),
      is_active: isActive,
      custom_duration: customDuration,
      custom_duration_minutes: customDuration,
      custom_price: customPrice,
      effective_duration: customDuration ?? defaultDuration,
      effective_price: customPrice ?? Number(defaultPrice.toFixed(2)),
    };
  });
}

/**
 * Busca especialidades / serviços habilitados para o colaborador.
 */
export async function getBarberSpecialties(barberId) {
  const ctx = await requireBarber();
  if (ctx.error) fail(ctx);

  const admin = createAdminClient();
  try {
    const { data: tableData, error: tableErr } = await admin
      .from("barber_services")
      .select("*")
      .eq("barber_id", barberId);

    if (!tableErr && tableData && tableData.length > 0) {
      return tableData
        .filter((row) => row.is_active !== false)
        .map((row) => row.service_id);
    }
  } catch {
    // fallback
  }

  const { data: barberData } = await ctx.supabase
    .from("barbers")
    .select("permissions")
    .eq("id", barberId)
    .single();

  if (barberData?.permissions?.specialties) {
    return barberData.permissions.specialties;
  }

  const { data: allServices } = await ctx.supabase
    .from("services")
    .select("id")
    .eq("active", true);

  return (allServices || []).map((s) => s.id);
}

/**
 * Salva os serviços habilitados e os tempos/preços personalizados (custom_duration / custom_price)
 * do colaborador diretamente na tabela `barber_services`.
 * Se `custom_duration` ficar vazio (null), o sistema herda automaticamente o tempo padrão da tabela `services`.
 */
export async function updateBarberSpecialties(barberId, serviceIdsOrConfigs, customConfigsMap = null) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);

  const admin = createAdminClient();

  let enabledServiceIds = [];
  const configByServiceId = new Map();

  if (Array.isArray(serviceIdsOrConfigs)) {
    for (const item of serviceIdsOrConfigs) {
      if (item && typeof item === "object" && item.service_id) {
        const sid = String(item.service_id);
        const isActive = item.is_active !== false;
        if (isActive) enabledServiceIds.push(sid);
        configByServiceId.set(sid, {
          is_active: isActive,
          custom_duration: item.custom_duration,
          custom_price: item.custom_price,
        });
      } else if (item) {
        const sid = String(item);
        enabledServiceIds.push(sid);
      }
    }
  }

  if (customConfigsMap && typeof customConfigsMap === "object") {
    for (const [sid, cfg] of Object.entries(customConfigsMap)) {
      const existing = configByServiceId.get(String(sid)) || {};
      configByServiceId.set(String(sid), {
        ...existing,
        ...(typeof cfg === "object" ? cfg : { custom_duration: cfg }),
      });
    }
  }

  // Atualiza JSONB permissions.specialties no barbeiro para compatibilidade
  const { data: current } = await admin
    .from("barbers")
    .select("permissions")
    .eq("id", barberId)
    .single();

  const nextPermissions = {
    ...(current?.permissions || {}),
    specialties: enabledServiceIds,
  };

  const { error: barberErr } = await admin
    .from("barbers")
    .update({ permissions: nextPermissions })
    .eq("id", barberId);

  if (barberErr) throw new Error(`Erro ao salvar especialidades: ${barberErr.message}`);

  // Sincroniza todas as linhas na tabela barber_services preservando ou atualizando custom_duration e custom_price
  const { data: allServices } = await admin.from("services").select("id");
  const serviceIdsList = (allServices || []).map((s) => String(s.id));

  for (const sid of serviceIdsList) {
    const isEnabled = enabledServiceIds.includes(sid);
    const cfg = configByServiceId.get(sid);

    let cleanDur = undefined;
    if (cfg && cfg.custom_duration !== undefined) {
      if (cfg.custom_duration === null || String(cfg.custom_duration).trim() === "") {
        cleanDur = null;
      } else {
        const parsed = Math.round(Number(cfg.custom_duration));
        cleanDur = Number.isFinite(parsed) && parsed > 0 ? Math.max(5, parsed) : null;
      }
    }

    let cleanPrice = undefined;
    if (cfg && cfg.custom_price !== undefined) {
      if (cfg.custom_price === null || String(cfg.custom_price).trim() === "") {
        cleanPrice = null;
      } else {
        const parsed = Number(String(cfg.custom_price).replace(",", "."));
        cleanPrice = Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
      }
    }

    const baseRow = {
      barber_id: barberId,
      service_id: sid,
      is_active: isEnabled,
    };

    if (cleanPrice !== undefined) baseRow.custom_price = cleanPrice;

    if (cleanDur !== undefined) {
      const { error: errBoth } = await admin
        .from("barber_services")
        .upsert(
          {
            ...baseRow,
            custom_duration: cleanDur,
            custom_duration_minutes: cleanDur,
          },
          { onConflict: "barber_id,service_id" }
        );

      if (errBoth) {
        await admin
          .from("barber_services")
          .upsert(
            {
              ...baseRow,
              custom_duration_minutes: cleanDur,
            },
            { onConflict: "barber_id,service_id" }
          );
      }
    } else {
      await admin
        .from("barber_services")
        .upsert(baseRow, { onConflict: "barber_id,service_id" });
    }
  }

  revalidatePath("/admin/equipe");
  revalidatePath("/admin/servicos");
  revalidatePath("/admin/agenda");
  return enabledServiceIds;
}

/**
 * Histórico de Caixa e Faturamento individual do colaborador (hoje ou no mês).
 */
export async function getBarberCashHistory(barberId, period = "today") {
  const ctx = await requireBarber();
  if (ctx.error) fail(ctx);

  // Obtém intervalo de datas correto
  const { todayInShop, shopRange, financeRange } = await import("@/lib/dates");
  const range = period === "month" ? financeRange("mes") : { from: todayInShop(), to: todayInShop() };
  const { start, end } = shopRange(range.from, range.to);

  // Busca dados do barbeiro para determinar a regra de comissão (Matheus = 100%; Colaboradores = 50% serv. + 10% prod.)
  const { data: barberData } = await ctx.supabase
    .from("barbers")
    .select("id, name, phone, role, commission_percent, commission_rate, permissions")
    .eq("id", barberId)
    .single();

  const rates = getBarberCommissionRates(barberData || { id: barberId });

  // Busca agendamentos do período (incluindo notes e total_price para separar serviços e produtos)
  const { data: appointments, error } = await ctx.supabase
    .from("appointments")
    .select(`
      id, appointment_date, appointment_time, status, payment_method, payment_status, is_walk_in, price, total_price, barber_commission_amount,
      client_name, client_phone, notes,
      services ( id, name, price, default_duration_minutes )
    `)
    .eq("barber_id", barberId)
    .gte("appointment_date", start)
    .lt("appointment_date", end)
    .or("status.is.null,status.neq.cancelado")
    .order("appointment_date", { ascending: false });

  if (error) throw new Error(`Erro ao buscar histórico de caixa: ${error.message}`);

  const formatted = (appointments || []).map((a) => {
    const fin = calculateAppointmentFinance(a, barberData || { id: barberId });
    return {
      ...a,
      amount: fin.totalAmount,
      service_amount: fin.serviceAmount,
      products_amount: fin.productsAmount,
      commission_value: fin.commissionAmount,
      service_commission: fin.serviceCommission,
      product_commission: fin.productCommission,
      is_owner_barber: fin.isOwner,
      commission_rule_label: fin.ruleLabel,
    };
  });

  const pagos = formatted.filter((a) => a.payment_status === "pago");
  const pendentes = formatted.filter((a) => a.payment_status !== "pago");

  const totalFaturado = Number(pagos.reduce((sum, a) => sum + a.amount, 0).toFixed(2));
  const totalPendente = Number(pendentes.reduce((sum, a) => sum + a.amount, 0).toFixed(2));
  const totalCortes = pagos.length;
  const comissaoAcumulada = Number(
    pagos.reduce((sum, a) => sum + a.commission_value, 0).toFixed(2)
  );
  const comissaoPendente = Number(
    pendentes.reduce((sum, a) => sum + a.commission_value, 0).toFixed(2)
  );

  return {
    barberName: barberData?.name || "Colaborador",
    isOwner: rates.isOwner,
    commissionPercent: rates.servicePercent,
    productCommissionPercent: rates.productPercent,
    ruleLabel: rates.ruleLabel,
    shortLabel: rates.shortLabel,
    period,
    periodLabel: period === "month" ? "Mês atual" : "Hoje",
    totalFaturado,
    totalPendente,
    totalCortes,
    comissaoAcumulada,
    comissaoPendente,
    comissaoTotalPrevista: Number((comissaoAcumulada + comissaoPendente).toFixed(2)),
    appointments: formatted,
  };
}

// Cada barbeiro edita só o próprio perfil (o chefe pode editar qualquer um).
export async function updateOwnProfile(id, { name, avatar_url } = {}) {
  try {
    const ctx = await requireBarber();
    if (ctx?.error) {
      return {
        success: false,
        error: ctx.error === "FORBIDDEN" ? "Sem permissão para esta ação." : "Sessão expirada. Faça login novamente.",
      };
    }

    // Valida o ID do barbeiro a ser atualizado
    const targetId = id ? String(id).trim() : String(ctx.barber?.id || "").trim();
    if (!targetId) {
      return { success: false, error: "Identificador do barbeiro não fornecido." };
    }

    if (!isChefe(ctx.barber) && targetId !== String(ctx.barber?.id)) {
      return { success: false, error: "Sem permissão para editar este perfil." };
    }

    // Filtra estritamente as colunas válidas da tabela `barbers`
    const payload = {};
    if (name !== undefined) {
      const cleanName = String(name || "").trim();
      if (!cleanName) {
        return { success: false, error: "O nome não pode estar em branco." };
      }
      payload.name = cleanName;
    }

    if (avatar_url !== undefined) {
      payload.avatar_url = avatar_url ? String(avatar_url).trim() : null;
    }

    if (Object.keys(payload).length === 0) {
      return { success: true, updated: ctx.barber };
    }

    // 1. Tenta atualizar via cliente com sessão autenticada (respeitando RLS)
    let { data: updated, error } = await ctx.supabase
      .from("barbers")
      .update(payload)
      .eq("id", targetId)
      .select("id, name, phone, role, active, permissions, commission_percent, avatar_url")
      .maybeSingle();

    // 2. Se falhar por bloqueio de RLS ou política restritiva de update, tenta via admin client (Service Role)
    if (error) {
      console.warn("[updateOwnProfile] Erro ao atualizar via cliente de sessão, tentando admin client:", error.message);
      try {
        const admin = createAdminClient();
        const { data: adminData, error: adminError } = await admin
          .from("barbers")
          .update(payload)
          .eq("id", targetId)
          .select("id, name, phone, role, active, permissions, commission_percent, avatar_url")
          .maybeSingle();

        if (adminError) throw adminError;
        updated = adminData;
        error = null;
      } catch (adminErr) {
        console.error("[updateOwnProfile] Erro com admin client:", adminErr);
        return {
          success: false,
          error: `Não foi possível salvar as alterações: ${error?.message || adminErr.message}`,
        };
      }
    }

    try {
      revalidatePath("/admin", "layout");
      revalidatePath("/admin/agenda");
    } catch {}

    return {
      success: true,
      updated: updated || { ...ctx.barber, ...payload },
    };
  } catch (err) {
    console.error("[updateOwnProfile] Exceção capturada na Server Action:", err);
    return {
      success: false,
      error: err?.message || "Erro inesperado ao salvar alterações do perfil.",
    };
  }
}

export async function uploadBarberAvatar(barberId, formData) {
  try {
    const ctx = await requireBarber();
    if (ctx?.error) {
      return {
        success: false,
        error: ctx.error === "FORBIDDEN" ? "Sem permissão para esta ação." : "Sessão expirada. Faça login novamente.",
      };
    }

    const targetId = barberId ? String(barberId).trim() : String(ctx.barber?.id || "").trim();
    if (!targetId) {
      return { success: false, error: "Identificador do barbeiro não fornecido." };
    }

    if (!isChefe(ctx.barber) && targetId !== String(ctx.barber?.id)) {
      return { success: false, error: "Sem permissão para alterar esta foto." };
    }

    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return { success: false, error: "Nenhuma imagem foi selecionada." };
    }

    const extension = (file.name?.split(".").pop() || "jpg").toLowerCase();
    const safeExt = ["jpg", "jpeg", "png", "webp"].includes(extension) ? extension : "jpg";
    const path = `${targetId}-${Date.now()}.${safeExt}`;
    const contentType = file.type || `image/${safeExt === "jpg" ? "jpeg" : safeExt}`;

    // 1. Tenta upload via cliente de sessão
    let uploadError = null;
    const { error: sessionUploadErr } = await ctx.supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType });

    if (sessionUploadErr) {
      uploadError = sessionUploadErr;
      // 2. Se falhar no cliente de sessão (ex: RLS no Storage), tenta com admin client
      try {
        const admin = createAdminClient();
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const { error: adminUploadErr } = await admin.storage
          .from("avatars")
          .upload(path, buffer, { upsert: true, contentType });

        if (!adminUploadErr) {
          uploadError = null;
        } else {
          uploadError = adminUploadErr;
        }
      } catch (adminStorageErr) {
        console.error("[uploadBarberAvatar] Erro no fallback com admin storage:", adminStorageErr);
      }
    }

    if (uploadError) {
      return {
        success: false,
        error: `Não foi possível enviar a foto para o armazenamento: ${uploadError.message}`,
      };
    }

    const { data } = ctx.supabase.storage.from("avatars").getPublicUrl(path);
    const publicUrl = data?.publicUrl;

    if (!publicUrl) {
      return { success: false, error: "Não foi possível obter a URL pública da foto." };
    }

    // Atualiza a coluna avatar_url na tabela barbers
    const updateResult = await updateOwnProfile(targetId, { avatar_url: publicUrl });
    if (!updateResult.success) {
      return updateResult;
    }

    return { success: true, avatarUrl: publicUrl };
  } catch (err) {
    console.error("[uploadBarberAvatar] Exceção capturada no upload:", err);
    return {
      success: false,
      error: err?.message || "Erro inesperado ao realizar upload da foto de perfil.",
    };
  }
}

/** Só o chefe. Cria a linha em barbers E o utilizador de login (telefone + senha). */
export async function addTeamMember({ name, phone, password, role = "barber", commissionPercent = 50, commission_percent }) {
  try {
    const ctx = await requireChefe();
    if (ctx.error) fail(ctx);

    if (!name || !name.trim()) {
      return { success: false, error: "O nome do profissional é obrigatório." };
    }

    const cleanPhone = phoneDigits(phone);
    if (!cleanPhone || cleanPhone.length < 10) {
      return { success: false, error: "Informe um telefone válido com DDD (mínimo 10 dígitos)." };
    }

    if (!password || password.length < 6) {
      return { success: false, error: "A senha precisa ter no mínimo 6 caracteres." };
    }

    // =========================================================================
    // TRATAMENTO DA COLUNA commission_percent (NÚMERO INTEIRO / NUMERIC):
    // Aceita tanto commissionPercent quanto commission_percent do formulário.
    // O valor inteiro (ex: 25 para 25%, 50 para 50%) é convertido estritamente
    // para número numérico válido. Se vier nulo, indefinido ou vazio, adota
    // o padrão de negócio (25.0 ou 50.0). Se vier string "25", vira Number 25.
    // =========================================================================
    const assignedRole = ["admin", "manager", "barber"].includes(role) ? role : "barber";
    const isOwnerRole = assignedRole === "admin" || name.trim().toLowerCase() === "matheus";
    const rawCommInput = commissionPercent ?? commission_percent ?? 50;
    const parsedCommInput = Number(rawCommInput);
    const commissionToInsert = isOwnerRole
      ? 100
      : Math.min(100, Math.max(0, Math.round(Number.isFinite(parsedCommInput) ? parsedCommInput : 50)));

    const assignedPermissions = assignedRole === "admin"
      ? {
          manage_services: true,
          manage_schedule_others: true,
          view_all_appointments: true,
          manage_finance: true,
          service_commission_percent: 100,
          product_commission_percent: 100,
        }
      : assignedRole === "manager"
      ? {
          manage_services: true,
          manage_schedule_others: true,
          view_all_appointments: true,
          manage_finance: false,
          can_manage_finances: false,
          can_view_global_finances: false,
          can_register_expenses: false,
          service_commission_percent: commissionToInsert,
          product_commission_percent: 10,
        }
      : {
          ...(DEFAULT_PERMISSIONS || {}),
          service_commission_percent: commissionToInsert,
          product_commission_percent: 10,
        };

    const hashedPassword = password ? await bcrypt.hash(password, 10) : await bcrypt.hash("Barber123!", 10);

    const memberPayload = {
      name: name.trim(),
      phone: cleanPhone,
      role: assignedRole,
      active: true,
      commission_percent: commissionToInsert,
      commission_rate: commissionToInsert,
      permissions: assignedPermissions,
      avatar_url: null,
      password_hash: hashedPassword,
    };

    const { data: created, error: insertError } = await ctx.supabase
      .from("barbers")
      .insert(memberPayload)
      .select("id, name, phone, role, commission_percent, active")
      .single();

    if (insertError) {
      console.error("[addTeamMember] Erro ao inserir barbeiro no Supabase:", insertError);
      return {
        success: false,
        error: insertError.message || "Erro no banco de dados ao cadastrar colaborador.",
      };
    }

    // Cria também o expediente semanal padrão (Seg-Sáb 09:00-19:00, pausa 12:00-13:00) para não ficar sem horários
    try {
      const defaultDays = [1, 2, 3, 4, 5, 6].map((dayNum) => ({
        barber_id: created.id,
        day_of_week: dayNum,
        start_time: "09:00:00",
        end_time: "19:00:00",
        break_start_time: "12:00:00",
        break_end_time: "13:00:00",
        is_working_day: true,
      }));
      defaultDays.push({
        barber_id: created.id,
        day_of_week: 0,
        start_time: "09:00:00",
        end_time: "19:00:00",
        break_start_time: null,
        break_end_time: null,
        is_working_day: false,
      });
      await ctx.supabase.from("barber_schedules").insert(defaultDays);
    } catch {}

    revalidatePath("/admin/equipe");
    return { success: true, member: created };
  } catch (err) {
    console.error("[addTeamMember] Exceção capturada na Server Action:", err);
    return {
      success: false,
      error: err.message || "Ocorreu um erro inesperado ao cadastrar o membro da equipe.",
    };
  }
}

/** Só o chefe. Define uma nova senha para um barbeiro diretamente na tabela barbers. */
export async function resetTeamMemberPassword(id, newPassword) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);
  if (!newPassword || newPassword.length < 6) throw new Error("A senha precisa ter no mínimo 6 caracteres.");

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  const { error } = await ctx.supabase
    .from("barbers")
    .update({
      password_hash: hashedPassword,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw new Error(`Não foi possível redefinir a senha: ${error.message}`);
}

export async function toggleTeamMemberActive(id, active) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);
  if (String(id) === String(ctx.barber.id) && !active) throw new Error("Você não pode desativar a si mesmo.");

  const { error } = await ctx.supabase.from("barbers").update({ active }).eq("id", id);
  if (error) throw new Error(`Não foi possível atualizar o status do barbeiro: ${error.message}`);
  // requireBarber() já barra barbeiros inativos em qualquer chamada seguinte.
}

export async function updateTeamMemberRole(id, role) {
  const ctx = await requireChefe();
  if (ctx.error || !isChefe(ctx.barber)) {
    throw new Error("Apenas o Chefe / Admin tem permissão para alterar cargos da equipe.");
  }
  if (!['admin', 'manager', 'barber'].includes(role)) {
    throw new Error('Cargo inválido. Escolha "admin" (Chefe), "manager" (Gerente) ou "barber" (Barbeiro).');
  }
  if (String(id) === String(ctx.barber.id) && role !== 'admin') {
    throw new Error('Você não pode revogar seu próprio acesso de Chefe.');
  }

  const { data: current } = await ctx.supabase
    .from('barbers')
    .select('permissions')
    .eq('id', id)
    .maybeSingle();

  const existingPerms = current?.permissions || {};

  const rolePermissions = role === 'admin'
    ? {
        manage_services: true,
        manage_schedule_others: true,
        view_all_appointments: true,
        manage_finance: true,
      }
    : role === 'manager'
    ? {
        manage_services: true,
        manage_schedule_others: true,
        view_all_appointments: true,
        manage_finance: false,
        can_manage_finances: false,
        can_view_global_finances: false,
        can_register_expenses: false,
      }
    : {
        manage_services: false,
        manage_schedule_others: false,
        view_all_appointments: false,
        manage_finance: false,
      };

  const permissions = {
    ...DEFAULT_PERMISSIONS,
    ...existingPerms,
    ...rolePermissions,
  };

  const { error } = await ctx.supabase
    .from('barbers')
    .update({
      role,
      permissions,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw new Error(`Não foi possível atualizar o cargo: ${error.message}`);
  revalidatePath('/admin/equipe');
  return { success: true, role };
}

export async function updateTeamMemberPermission(id, key, value) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);
  if (!Object.values(PERMISSION_KEYS).includes(key)) throw new Error("Permissão inválida.");

  const { data: current, error: fetchError } = await ctx.supabase
    .from("barbers")
    .select("permissions")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(`Barbeiro não encontrado: ${fetchError.message}`);

  const nextPermissions = { ...DEFAULT_PERMISSIONS, ...(current.permissions || {}), [key]: Boolean(value) };
  const { error } = await ctx.supabase.from("barbers").update({ permissions: nextPermissions }).eq("id", id);
  if (error) throw new Error(`Não foi possível atualizar as permissões: ${error.message}`);
}

export async function removeTeamMember(id) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);
  if (String(id) === String(ctx.barber.id)) throw new Error("Você não pode remover a si mesmo.");

  const admin = createAdminClient();
  const authUser = await findAuthUserByBarberId(admin, id);

  const { error } = await ctx.supabase.from("barbers").delete().eq("id", id);
  if (error) throw new Error(`Não foi possível remover o barbeiro: ${error.message}`);

  if (authUser) await admin.auth.admin.deleteUser(authUser.id);

  // Limpeza best-effort dos códigos de recuperação do barbeiro removido.
  try {
    await admin.from("barber_recovery_codes").delete().eq("barber_id", String(id));
    await admin.from("barber_recovery_state").delete().eq("barber_id", String(id));
  } catch {}
}
