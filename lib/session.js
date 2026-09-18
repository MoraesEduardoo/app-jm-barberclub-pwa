import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function requireAdminSession() {
  const supabase = getSupabaseServerClient();

  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Acesso negado: Sessão de usuário inválida ou expirada.');
  }

  return user;
}