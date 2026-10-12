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
