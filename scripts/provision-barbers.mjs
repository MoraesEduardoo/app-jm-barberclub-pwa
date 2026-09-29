// Cria o login (Supabase Auth) para os barbeiros que já existem na tabela `barbers`.
// Rode UMA vez (é idempotente: quem já tem acesso é ignorado):
//
//   node --env-file=.env.local scripts/provision-barbers.mjs
//
// Requer Node 20.6+ e as variáveis NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
// Imprime uma senha provisória por barbeiro: entregue pessoalmente e apague o terminal.
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";

const DOMAIN = process.env.NEXT_PUBLIC_BARBER_AUTH_DOMAIN || "barbers.jmbarberclub.app";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // sem caracteres ambíguos
const tempPassword = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const { data: barbers, error } = await admin.from("barbers").select("id, name, phone, active");
if (error) throw error;

const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;
const linked = new Set(list.users.map((u) => String(u.app_metadata?.barber_id)));

for (const b of barbers) {
  const digits = (b.phone || "").replace(/\D/g, "");
  if (!b.active) { console.log(`- ${b.name}: inativo, ignorado`); continue; }
  if (digits.length < 10) { console.log(`- ${b.name}: telefone inválido, ignorado`); continue; }
  if (linked.has(String(b.id))) { console.log(`- ${b.name}: já tem acesso`); continue; }

  const password = tempPassword();
  const { error: createError } = await admin.auth.admin.createUser({
    email: `${digits}@${DOMAIN}`,
    password,
    email_confirm: true,
    app_metadata: { barber_id: b.id },
  });

  if (createError) console.log(`- ${b.name}: ERRO -> ${createError.message}`);
  else console.log(`- ${b.name} (${digits}): senha provisória = ${password}`);
}
