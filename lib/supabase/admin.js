// SOMENTE SERVIDOR. Usa a service role (ignora RLS). Nunca importar em componentes "use client".
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Equipa pequena: listar e filtrar é suficiente (evita precisar de coluna extra).
export async function findAuthUserByBarberId(admin, barberId) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.find((u) => String(u.app_metadata?.barber_id) === String(barberId)) || null;
}
