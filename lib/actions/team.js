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
  return data.map((b) => ({ ...b, permissions: { ...DEFAULT_PERMISSIONS, ...(b.permissions || {}) } }));
}

export async function updateTeamMemberCommission(id, commissionPercent) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);

  const value = Math.min(100, Math.max(0, Number(commissionPercent) || 0));
  const { error } = await ctx.supabase.from("barbers").update({ commission_percent: value }).eq("id", id);
  if (error) throw new Error(`Não foi possível atualizar a comissão: ${error.message}`);
  return value;
}

// Cada barbeiro edita só o próprio perfil (o chefe pode editar qualquer um).
export async function updateOwnProfile(id, { name, avatar_url }) {
  const ctx = await requireBarber();
  if (ctx.error) fail(ctx);
  if (!isChefe(ctx.barber) && String(id) !== String(ctx.barber.id)) {
    throw new Error("Sem permissão para editar este perfil.");
  }

  const payload = {};
  if (name !== undefined && name.trim()) payload.name = name.trim();
  if (avatar_url !== undefined) payload.avatar_url = avatar_url;

  const { error } = await ctx.supabase.from("barbers").update(payload).eq("id", id);
  if (error) throw new Error(`Não foi possível atualizar o perfil: ${error.message}`);
  revalidatePath("/admin", "layout");
}

export async function uploadBarberAvatar(barberId, formData) {
  const ctx = await requireBarber();
  if (ctx.error) fail(ctx);
  if (!isChefe(ctx.barber) && String(barberId) !== String(ctx.barber.id)) {
    throw new Error("Sem permissão para alterar esta foto.");
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") throw new Error("Nenhuma imagem foi enviada.");

  const extension = file.name?.split(".").pop() || "jpg";
  const path = `${barberId}-${Date.now()}.${extension}`;

  const { error: uploadError } = await ctx.supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
  if (uploadError) throw new Error(`Não foi possível enviar a foto: ${uploadError.message}`);

  const { data } = ctx.supabase.storage.from("avatars").getPublicUrl(path);
  await updateOwnProfile(barberId, { avatar_url: data.publicUrl });
  return data.publicUrl;
}

/** Só o chefe. Cria a linha em barbers E o utilizador de login (telefone + senha). */
export async function addTeamMember({ name, phone, password }) {
  const ctx = await requireChefe();
  if (ctx.error) fail(ctx);

  const cleanPhone = phoneDigits(phone);
  if (cleanPhone.length < 10) throw new Error("Telefone inválido.");
  if (!password || password.length < 6) throw new Error("A senha precisa ter no mínimo 6 caracteres.");

  const { data: created, error } = await ctx.supabase
    .from("barbers")
    .insert({
      name: name.trim(),
      phone: cleanPhone,
      role: "barber",
      active: true,
      permissions: DEFAULT_PERMISSIONS,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Não foi possível adicionar o barbeiro: ${error.message}`);

  const admin = createAdminClient();
  const { error: authError } = await admin.auth.admin.createUser({
    email: phoneToAuthEmail(cleanPhone),
    password,
    email_confirm: true,
    app_metadata: { barber_id: created.id }, // só a service role escreve aqui
  });

  if (authError) {
    // rollback: não deixa barbeiro sem login
    await ctx.supabase.from("barbers").delete().eq("id", created.id);
    throw new Error(`Não foi possível criar o acesso: ${authError.message}`);
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
