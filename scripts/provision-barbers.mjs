import { createClient } from "@supabase/supabase-js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DOMAIN = process.env.NEXT_PUBLIC_BARBER_AUTH_DOMAIN || "barbers.jmbarberclub.app";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ficheiro .env");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// Inicializa a interface para fazer perguntas no terminal
const rl = readline.createInterface({ input, output });

const { data: barbers, error } = await admin.from("barbers").select("id, name, phone, active");
if (error) {
  console.error("Erro ao buscar barbeiros:", error);
  process.exit(1);
}

const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) {
  console.error("Erro ao listar utilizadores no Supabase Auth:", listError);
  process.exit(1);
}
const linked = new Set(list.users.map((u) => String(u.app_metadata?.barber_id)));

console.log("\n=== CONFIGURAÇÃO MANUAL DE SENHAS ===");

for (const b of barbers) {
  const digits = (b.phone || "").replace(/\D/g, "");

  if (!b.active) {
    console.log(`- ${b.name}: inativo, ignorado.`);
    continue;
  }
  if (digits.length < 10) {
    console.log(`- ${b.name}: telefone inválido, ignorado.`);
    continue;
  }
  if (linked.has(String(b.id))) {
    console.log(`- ${b.name}: já tem acesso criado.`);
    continue;
  }

  // Pede a senha manualmente no terminal
  const password = await rl.question(`\n> Digite a senha que deseja dar para ${b.name} (${digits}): `);

  if (!password || password.length < 6) {
    console.log(`[!] Senha muito curta para ${b.name} (mínimo 6 caracteres). Ignorando...`);
    continue;
  }

  const { error: createError } = await admin.auth.admin.createUser({
    email: `${digits}@${DOMAIN}`,
    password,
    email_confirm: true,
    app_metadata: { barber_id: b.id },
  });

  if (createError) {
    console.log(`[X] ERRO ao criar login para ${b.name}: -> ${createError.message}`);
  } else {
    console.log(`[✓] Sucesso! A senha de ${b.name} foi definida como: ${password}`);
  }
}

rl.close();
console.log("\nProcesso terminado!");