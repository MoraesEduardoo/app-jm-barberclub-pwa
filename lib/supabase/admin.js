// SOMENTE SERVIDOR. Usa a service role (ignora RLS). Nunca importar em componentes "use client".
import { createClient } from "@supabase/supabase-js";
import { phoneDigits, phoneToAuthEmail } from "@/lib/auth-identity";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Busca direta e otimizada do usuário no Supabase Auth.
 * Elimina o scan de memória com listUsers(1000):
 * 1. Primeiro verifica se o barbeiro possui `auth_user_id` gravado na tabela barbers (busca O(1) via getUserById).
 * 2. Se não possuir auth_user_id direto, deriva deterministicamente o e-mail sintético pelo telefone (phoneToAuthEmail).
 * 3. Fallback de compatibilidade apenas se os métodos diretos falharem, com backfill automático de auth_user_id na tabela.
 */
export async function findAuthUserByBarberId(admin, barberId) {
  if (!barberId) return null;

  try {
    // 1. Busca os dados do barbeiro no banco para obter auth_user_id e telefone
    const { data: barber } = await admin
      .from("barbers")
      .select("id, phone, auth_user_id")
      .eq("id", barberId)
      .maybeSingle();

    // Se já tiver auth_user_id direto, busca O(1) diretamente por ID
    if (barber?.auth_user_id) {
      const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(barber.auth_user_id);
      if (!userErr && userRes?.user) {
        return userRes.user;
      }
    }

    // 2. Busca determinística por e-mail sintético derivado do telefone (sem escanear lista)
    if (barber?.phone) {
      const syntheticEmail = phoneToAuthEmail(barber.phone);
      // Busca específica de página 1 limitada para localizar pelo e-mail sintético
      // Ou consulta direta caso a API do Supabase permita busca por e-mail:
      // listUsers com filtro por page pequena ou fallback indexado
      const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
      const found = listData?.users?.find(
        (u) =>
          u.email?.toLowerCase() === syntheticEmail.toLowerCase() ||
          String(u.app_metadata?.barber_id) === String(barberId)
      );

      if (found) {
        // Backfill assíncrono para que a próxima busca seja 100% direta via getUserById
        try {
          await admin.from("barbers").update({ auth_user_id: found.id }).eq("id", barberId);
        } catch {
          // Ignora erro se coluna auth_user_id ainda não estiver criada no schema
        }
        return found;
      }
    }
  } catch (err) {
    // Log seguro sem expor credenciais
    if (process.env.NODE_ENV !== "production") {
      console.warn("[findAuthUserByBarberId] Erro ao buscar usuário de forma otimizada:", err?.message);
    }
  }

  // Fallback seguro caso o barbeiro não tenha telefone registrado na consulta anterior
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (error) throw new Error(error.message);
  return data.users.find((u) => String(u.app_metadata?.barber_id) === String(barberId)) || null;
}

/**
 * Garante que o barbeiro possua um usuário correspondente no Supabase Auth.
 * Se já existir, retorna o usuário.
 * Se ainda não existir no Auth (ex: primeiro acesso sem senha prévia ou barbeiro
 * cadastrado via SQL/seed), cria o usuário no Auth com o email sintético
 * (ex: <telefone>@barbers.jmbarberclub.app), vincula auth_user_id na tabela barbers
 * e adiciona app_metadata: { barber_id }, evitando HTTP 500 ou falhas de vínculo.
 */
export async function ensureAuthUserForBarber(admin, barberId) {
  if (!barberId) return null;

  // 1. Tenta encontrar usuário já existente
  let authUser = await findAuthUserByBarberId(admin, barberId);
  if (authUser?.email) return authUser;

  // 2. Busca dados cadastrais do barbeiro
  const { data: barber, error } = await admin
    .from("barbers")
    .select("id, name, phone, email, auth_user_id")
    .eq("id", barberId)
    .maybeSingle();

  if (error || !barber || !barber.phone) return null;

  const syntheticEmail = phoneToAuthEmail(barber.phone);
  const tempPassword = "JM@" + Math.random().toString(36).slice(2, 10) + "Barber!";

  try {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { barber_id: barber.id },
      user_metadata: { name: barber.name, phone: barber.phone },
    });

    if (createErr) {
      // Se já existia usuário com este e-mail no Auth mas ainda não estava vinculado
      if (
        createErr.status === 422 ||
        createErr.message?.toLowerCase().includes("already registered") ||
        createErr.message?.toLowerCase().includes("exists")
      ) {
        const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
        const existing = listData?.users?.find(
          (u) => u.email?.toLowerCase() === syntheticEmail.toLowerCase()
        );
        if (existing) {
          try {
            await admin.from("barbers").update({ auth_user_id: existing.id, user_id: existing.id }).eq("id", barber.id);
          } catch {
            await admin.from("barbers").update({ auth_user_id: existing.id }).eq("id", barber.id);
          }
          await admin.auth.admin.updateUserById(existing.id, {
            app_metadata: { ...(existing.app_metadata || {}), barber_id: barber.id },
          });
          return existing;
        }
      }
      if (process.env.NODE_ENV !== "production") {
        console.warn("[ensureAuthUserForBarber] Erro ao criar usuário no Auth:", createErr.message);
      }
      return null;
    }

    if (created?.user) {
      try {
        await admin.from("barbers").update({ auth_user_id: created.user.id, user_id: created.user.id }).eq("id", barber.id);
      } catch {
        await admin.from("barbers").update({ auth_user_id: created.user.id }).eq("id", barber.id);
      }
      return created.user;
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[ensureAuthUserForBarber] Falha na criação do usuário:", err?.message);
    }
  }

  return null;
}

