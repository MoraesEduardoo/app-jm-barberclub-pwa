"use server"

import { revalidatePath } from "next/cache";
import { requireBarber, requireChefe } from "@/lib/auth-server";
import { createAdminClient, findAuthUserByBarberId } from "@/lib/supabase/admin";
import { phoneToAuthEmail, phoneDigits } from "@/lib/auth-identity";
import { DEFAULT_PERMISSIONS, PERMISSION_KEYS, isChefe } from "@/lib/auth";

function fail(ctx) {
  throw new Error(ctx.error === "FORBIDDEN" ? "Sem permissão para esta ação." : "AUTH_EXPIRED");
}

export async function listTeam() {
  const ctx = await requireBarber(PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS);
  if (ctx.error) fail(ctx);

  const { data, error } = await ctx.supabase
    .from("barbers")
    .select("id, name, phone, role, active, permissions, commission_percent, avatar_url")
    .order("role", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(`Não foi possível carregar a equipe: ${error.message}`);

  return data.map((b) => {
    // Normalização rigorosa da comissão para número inteiro (ex: 50 para 50%, 30 para 30%)
    let commission = b.commission_percent;
    if (commission !== null && commission !== undefined) {
      const num = Number(commission);
      // Se estava salvo como decimal antigo (ex: 0.50), converte para 50%
      commission = num > 0 && num <= 1 ? Math.round(num * 100) : Math.round(num);
    } else {
      commission = 50; // Padrão de mercado para barbearia
    }

    const perms = b.permissions || {};
    const productCommission =
      perms.product_commission_percent !== undefined
        ? Math.round(Number(perms.product_commission_percent) || 0)
        : 10;

    const specialties = Array.isArray(perms.specialties) ? perms.specialties : null;

    return {
      ...b,
      commission_percent: commission,
      product_commission_percent: productCommission,
      specialties,
      permissions: { ...DEFAULT_PERMISSIONS, ...perms },
    };
  });
}

/**
 * Atualiza a comissão sobre serviços em número inteiro (0 a 100).
 */
export async function updateTeamMemberCommission(id, commissionPercent) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);

  // Garante estritamente número inteiro entre 0 e 100
  const value = Math.min(100, Math.max(0, Math.round(Number(commissionPercent) || 0)));
  const { error } = await ctx.supabase
    .from("barbers")
    .update({ commission_percent: value })
    .eq("id", id);

  if (error) throw new Error(`Não foi possível atualizar a comissão: ${error.message}`);
  return value;
}

/**
 * Atualiza regras avançadas de comissão: serviços e produtos separadamente.
 */
export async function updateTeamMemberAdvancedCommissions(id, { servicesPercent, productsPercent }) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);

  const cleanServices = Math.min(100, Math.max(0, Math.round(Number(servicesPercent) || 0)));
  const cleanProducts = Math.min(100, Math.max(0, Math.round(Number(productsPercent) || 0)));

  const { data: current, error: fetchErr } = await ctx.supabase
    .from("barbers")
    .select("permissions")
    .eq("id", id)
    .single();

  if (fetchErr) throw new Error(`Barbeiro não encontrado: ${fetchErr.message}`);

  const updatedPermissions = {
    ...(current.permissions || {}),
    product_commission_percent: cleanProducts,
  };

  const { error } = await ctx.supabase
    .from("barbers")
    .update({
      commission_percent: cleanServices,
      permissions: updatedPermissions,
    })
    .eq("id", id);

  if (error) throw new Error(`Não foi possível atualizar as comissões: ${error.message}`);

  return {
    commission_percent: cleanServices,
    product_commission_percent: cleanProducts,
  };
}

/**
 * Busca especialidades / serviços habilitados para o colaborador.
 */
export async function getBarberSpecialties(barberId) {
  const ctx = await requireBarber();
  if (ctx.error) fail(ctx);

  // 1. Tenta carregar da tabela barber_services se existir
  try {
    const { data: tableData, error: tableErr } = await ctx.supabase
      .from("barber_services")
      .select("service_id")
      .eq("barber_id", barberId);

    if (!tableErr && tableData && tableData.length > 0) {
      return tableData.map((row) => row.service_id);
    }
  } catch {
    // Tabela não existente, prossegue para fallback
  }

  // 2. Fallback: recupera do campo JSONB permissions.specialties na tabela barbers
  const { data: barberData } = await ctx.supabase
    .from("barbers")
    .select("permissions")
    .eq("id", barberId)
    .single();

  if (barberData?.permissions?.specialties) {
    return barberData.permissions.specialties;
  }

  // Se nada foi configurado ainda, por padrão retorna todos os serviços ativos da barbearia
  const { data: allServices } = await ctx.supabase
    .from("services")
    .select("id")
    .eq("active", true);

  return (allServices || []).map((s) => s.id);
}

/**
 * Salva a lista de serviços habilitados para o colaborador.
 */
export async function updateBarberSpecialties(barberId, serviceIds) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);

  const cleanIds = Array.isArray(serviceIds) ? serviceIds : [];

  // Salva no JSONB permissions para garantir persistência imediata e sem conflito
  const { data: current } = await ctx.supabase
    .from("barbers")
    .select("permissions")
    .eq("id", barberId)
    .single();

  const nextPermissions = {
    ...(current?.permissions || {}),
    specialties: cleanIds,
  };

  const { error: barberErr } = await ctx.supabase
    .from("barbers")
    .update({ permissions: nextPermissions })
    .eq("id", barberId);

  if (barberErr) throw new Error(`Erro ao salvar especialidades: ${barberErr.message}`);

  // Se a tabela relacional barber_services existir no banco, sincroniza também
  try {
    await ctx.supabase.from("barber_services").delete().eq("barber_id", barberId);
    if (cleanIds.length > 0) {
      const rows = cleanIds.map((sid) => ({ barber_id: barberId, service_id: sid }));
      await ctx.supabase.from("barber_services").insert(rows);
    }
  } catch {
    // Ignora caso a tabela barber_services ainda não tenha sido criada no Supabase
  }

  return cleanIds;
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

  // Busca dados do barbeiro para saber a taxa de comissão atual
  const { data: barberData } = await ctx.supabase
    .from("barbers")
    .select("id, name, commission_percent, permissions")
    .eq("id", barberId)
    .single();

  let commissionPercent = barberData?.commission_percent;
  if (commissionPercent !== null && commissionPercent !== undefined) {
    const num = Number(commissionPercent);
    commissionPercent = num > 0 && num <= 1 ? Math.round(num * 100) : Math.round(num);
  } else {
    commissionPercent = 50;
  }

  // Busca agendamentos do período
  const { data: appointments, error } = await ctx.supabase
    .from("appointments")
    .select(`
      id, appointment_date, status, payment_method, payment_status, is_walk_in,
      client_name, client_phone,
      services ( id, name, price, default_duration_minutes )
    `)
    .eq("barber_id", barberId)
    .gte("appointment_date", start)
    .lt("appointment_date", end)
    .or("status.is.null,status.neq.cancelado")
    .order("appointment_date", { ascending: false });

  if (error) throw new Error(`Erro ao buscar histórico de caixa: ${error.message}`);

  const formatted = (appointments || []).map((a) => {
    const price = Number(a.services?.price || 0);
    const commValue = Number(((price * commissionPercent) / 100).toFixed(2));
    return {
      ...a,
      amount: price,
      commission_value: commValue,
    };
  });

  const pagos = formatted.filter((a) => a.payment_status === "pago");
  const pendentes = formatted.filter((a) => a.payment_status !== "pago");

  const totalFaturado = pagos.reduce((sum, a) => sum + a.amount, 0);
  const totalPendente = pendentes.reduce((sum, a) => sum + a.amount, 0);
  const totalCortes = pagos.length;
  const comissaoAcumulada = Number(((totalFaturado * commissionPercent) / 100).toFixed(2));

  return {
    barberName: barberData?.name || "Colaborador",
    commissionPercent,
    period,
    periodLabel: period === "month" ? "Mês atual" : "Hoje",
    totalFaturado,
    totalPendente,
    totalCortes,
    comissaoAcumulada,
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
export async function addTeamMember({ name, phone, password, commissionPercent = 50, commission_percent }) {
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
    const rawComm = commissionPercent !== undefined ? commissionPercent : commission_percent;
    let numericComm = 25.0; // Padrão seguro caso não informado

    if (rawComm !== undefined && rawComm !== null && String(rawComm).trim() !== "") {
      const parsed = parseFloat(String(rawComm).replace(",", "."));
      if (!isNaN(parsed) && isFinite(parsed)) {
        // Se por engano vier em formato decimal fracionário menor que 1 (ex: 0.25), converte para 25
        if (parsed > 0 && parsed <= 1) {
          numericComm = Math.round(parsed * 100);
        } else {
          numericComm = Math.min(100, Math.max(0, Math.round(parsed)));
        }
      }
    }

    // Garante que é um número primitivo real (ex: 25 ou 25.0) para inserção no Supabase
    const commissionToInsert = Number(numericComm);

    // =========================================================================
    // INSERÇÃO EXPLICITA COM TODOS OS CAMPOS OBRIGATÓRIOS DO SCHEMA:
    // - name: text (NOT NULL)
    // - phone: text
    // - role: 'barber' (default)
    // - commission_percent: numeric (NOT NULL, ex: 25)
    // - active: true (default)
    // - permissions: {} (jsonb default)
    // - avatar_url: null
    // =========================================================================
    const memberPayload = {
      name: name.trim(),
      phone: cleanPhone,
      role: "barber",
      active: true,
      commission_percent: commissionToInsert,
      permissions: DEFAULT_PERMISSIONS || {},
      avatar_url: null,
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

    // Cria o usuário correspondente no Supabase Auth para login via telefone + senha
    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.createUser({
      email: phoneToAuthEmail(cleanPhone),
      password,
      email_confirm: true,
      app_metadata: { barber_id: created.id },
    });

    if (authError) {
      console.error("[addTeamMember] Erro ao criar acesso Auth no Supabase:", authError);
      // Rollback: não deixa registro órfão na tabela barbers sem credenciais de login
      await ctx.supabase.from("barbers").delete().eq("id", created.id);
      return {
        success: false,
        error: `Não foi possível criar o login de acesso: ${authError.message}`,
      };
    }

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

/** Só o chefe. Define uma nova senha para um barbeiro (não há "esqueci a senha" por SMS). */
export async function resetTeamMemberPassword(id, newPassword) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);
  if (!newPassword || newPassword.length < 6) throw new Error("A senha precisa ter no mínimo 6 caracteres.");

  const admin = createAdminClient();
  const authUser = await findAuthUserByBarberId(admin, id);
  if (!authUser) throw new Error("Esse barbeiro ainda não tem acesso criado.");

  const { error } = await admin.auth.admin.updateUserById(authUser.id, { password: newPassword });
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
