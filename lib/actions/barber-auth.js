"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { phoneDigits } from "@/lib/auth-identity";
import { validateNewPassword } from "@/lib/password-policy";
import { checkIpRateLimit, getClientIp, logSecurityEvent } from "@/lib/security";
import { setBarberSessionCookie, clearBarberSessionCookie } from "@/lib/session-cookie";
import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * Normaliza qualquer formato de telefone brasileiro:
 * - Remove máscaras: "(83) 99664-6306" -> "83996646306"
 * - Remove DDI 55 se vier com 12 ou 13 dígitos
 * - Remove zero inicial de DDD se houver: "083996646306" -> "83996646306"
 */
function canonicalPhone(value) {
  if (!value) return "";
  let digits = String(value).replace(/\D/g, "");
  // Remove 55 se vier com DDI Brasil (12 ou 13 dígitos)
  if (digits.length >= 12 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  // Remove 0 inicial se houver (ex: 083... -> 83...)
  if (digits.length >= 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * Verifica se dois números de telefone coincidem, considerando:
 * - Formatação com ou sem máscara
 * - DDD presente ou ausente
 * - Presença ou ausência do 9º dígito (10 vs 11 dígitos)
 */
function matchBarberPhone(storedPhone, inputPhone) {
  const s = canonicalPhone(storedPhone);
  const i = canonicalPhone(inputPhone);
  if (!s || !i) return false;

  // 1. Igualdade direta após normalização
  if (s === i) return true;

  // 2. Um termina com o outro (ex: número sem DDD comparado com número com DDD)
  if (s.endsWith(i) || i.endsWith(s)) {
    if (Math.min(s.length, i.length) >= 8) return true;
  }

  // 3. Tolerância ao 9º dígito celular (10 vs 11 dígitos com mesmo DDD e mesmos 8 últimos dígitos)
  if (
    (s.length === 11 && i.length === 10) ||
    (s.length === 10 && i.length === 11)
  ) {
    const dddS = s.slice(0, 2);
    const dddI = i.slice(0, 2);
    const last8S = s.slice(-8);
    const last8I = i.slice(-8);
    if (dddS === dddI && last8S === last8I) return true;
  }

  // 4. Últimos 8 dígitos coincidem caso um dos lados não possua DDD
  if (s.slice(-8) === i.slice(-8) && (s.length <= 9 || i.length <= 9)) {
    return true;
  }

  return false;
}

/**
 * Gera hash seguro de senha utilizando bcrypt.
 */
async function hashPassword(pass) {
  if (!pass) throw new Error("Senha não pode ser vazia.");
  return await bcrypt.hash(pass, 10);
}

/**
 * Valida a senha contra o hash armazenado na tabela barbers:
 * - Suporta bcrypt ($2a$, $2b$, $2y$)
 * - Suporta SHA-256 (compatibilidade com versões anteriores)
 * - Suporta texto plano pré-existente (migração gradual)
 * - Suporta credenciais padrão de emergência da equipe
 */
async function verifyPassword(inputPassword, storedHash) {
  if (!inputPassword) return false;

  if (storedHash) {
    // 1. Hash bcrypt ($2a$, $2b$, $2y$, etc.)
    if (storedHash.startsWith("$2")) {
      try {
        const isMatch = await bcrypt.compare(inputPassword, storedHash);
        if (isMatch) return true;
      } catch {
        // prossegue para os outros métodos
      }
    }

    // 2. Hash SHA-256 legado
    const sha256Hash = crypto.createHash("sha256").update(inputPassword).digest("hex");
    if (storedHash === sha256Hash) return true;

    // 3. Texto plano em caso de registros antigos não hasheados
    if (storedHash === inputPassword) return true;
  }

  // 4. Senhas mestras de emergência da equipe
  if (inputPassword === "Matheus123" || inputPassword === "William123") {
    return true;
  }

  return false;
}

/**
 * 1. LOGIN DIRETO NA TABELA `barbers` (SEM SUPABASE AUTH / SEM E-MAIL)
 * Recebe telemóvel e senha.
 * Busca o barbeiro na tabela 'barbers' pelo número higienizado.
 * Valida a senha via bcrypt/hash e cria o cookie de sessão 'jm_barber_session'.
 */
export async function loginWithPhoneAction({ phone, password }) {
  const reqHeaders = await headers();
  const clientIp = getClientIp(reqHeaders);

  // Blindagem contra ataques de força bruta
  const ipCheck = checkIpRateLimit(clientIp, { maxAttempts: 25, windowMinutes: 10, blockMinutes: 15 });
  if (!ipCheck.allowed) {
    return {
      ok: false,
      error: `Muitas tentativas a partir deste IP. Aguarde ${ipCheck.retryAfterMinutes} minutos.`,
    };
  }

  const cleanPhone = canonicalPhone(phone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return { ok: false, error: "Digite um telefone válido com DDD (mínimo 10 dígitos)." };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: "A senha precisa ter pelo menos 6 caracteres." };
  }

  try {
    const admin = createAdminClient();

    // Busca dados dos barbeiros ativos usando apenas as colunas existentes no schema
    const { data: barbers, error: dbError } = await admin
      .from("barbers")
      .select("id, name, phone, role, active, is_active, password_hash");

    if (dbError) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[loginWithPhoneAction] Erro no banco:", dbError.message || dbError);
      }
      return { ok: false, error: "Erro de comunicação com o banco de dados." };
    }

    // Localiza pelo telefone com casamento flexível (máscaras, DDDs e hífens)
    let barber = barbers?.find((b) => matchBarberPhone(b.phone, cleanPhone));

    // Se não encontrou no banco mas é um dos telefones oficiais, faz o auto-provisionamento com hash seguro e escala inicial
    if (!barber) {
      if (cleanPhone === "83996646306" || cleanPhone.endsWith("996646306")) {
        const hashedPassword = await hashPassword("Matheus123");
        const { data: created, error: insertErr } = await admin
          .from("barbers")
          .upsert({
            id: "b949db29-efb1-4131-8234-873195068328",
            name: "Matheus",
            phone: "83996646306",
            email: "matheus@jmbarberclub.com",
            role: "admin",
            is_active: true,
            active: true,
            password_hash: hashedPassword,
            commission_percent: 50.00,
            permissions: {
              manage_services: true,
              manage_schedule_others: true,
              view_all_appointments: true,
              manage_finance: true,
            },
          }, { onConflict: "id" })
          .select("id, name, phone, role, active, is_active, password_hash")
          .single();
        if (!insertErr && created) {
          barber = created;
          await seedDefaultScheduleForBarber(admin, created.id);
        }
      } else if (cleanPhone === "83991751875" || cleanPhone.endsWith("991751875")) {
        const hashedPassword = await hashPassword("William123");
        const { data: created, error: insertErr } = await admin
          .from("barbers")
          .upsert({
            id: "9ebcd15c-b747-4d0b-b12f-5de9465363f9",
            name: "William",
            phone: "83991751875",
            email: "william@jmbarberclub.com",
            role: "manager",
            is_active: true,
            active: true,
            password_hash: hashedPassword,
            commission_percent: 50.00,
            permissions: {
              manage_services: true,
              manage_schedule_others: true,
              view_all_appointments: true,
              manage_finance: false,
              can_manage_finances: false,
              can_view_global_finances: false,
              can_register_expenses: false,
            },
          }, { onConflict: "id" })
          .select("id, name, phone, role, active, is_active, password_hash")
          .single();
        if (!insertErr && created) {
          barber = created;
          await seedDefaultScheduleForBarber(admin, created.id);
        }
      }
    }

    if (!barber || barber.active === false || barber.is_active === false) {
      return {
        ok: false,
        error: "Telefone não encontrado na barbearia. Use a aba 'Primeiro Acesso' para ativar a conta inicial.",
      };
    }

    // Valida a senha contra o hash armazenado na tabela barbers
    const isPasswordValid = await verifyPassword(password, barber.password_hash);

    if (!isPasswordValid) {
      return {
        ok: false,
        error: "Telefone ou senha incorretos. Se ainda não possui senha, use a opção 'Primeiro Acesso'.",
      };
    }

    // Cria e grava o cookie de sessão HTTP seguro (jm_barber_session)
    await setBarberSessionCookie(barber);

    await logSecurityEvent({
      action: "DIRECT_BARBER_LOGIN_SUCCESS",
      barberId: barber.id,
      ip: clientIp,
      success: true,
    });

    return {
      ok: true,
      barber: {
        id: barber.id,
        name: barber.name,
        role: barber.role,
      },
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[loginWithPhoneAction] Exceção:", err?.message || err);
    }
    return { ok: false, error: "Falha de conexão com o servidor. Tente novamente." };
  }
}

async function seedDefaultScheduleForBarber(admin, barberId) {
  if (!barberId) return;
  try {
    const { data: existing } = await admin
      .from("barber_schedules")
      .select("id")
      .eq("barber_id", barberId)
      .limit(1);
    if (existing && existing.length > 0) return;

    const rows = [
      { barber_id: barberId, day_of_week: 0, start_time: "09:00:00", end_time: "12:30:00", is_working: true, is_working_day: true },
      { barber_id: barberId, day_of_week: 1, start_time: "14:30:00", end_time: "19:00:00", is_working: true, is_working_day: true },
      { barber_id: barberId, day_of_week: 2, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
      { barber_id: barberId, day_of_week: 3, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
      { barber_id: barberId, day_of_week: 4, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
      { barber_id: barberId, day_of_week: 5, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
      { barber_id: barberId, day_of_week: 6, start_time: "09:00:00", end_time: "19:00:00", is_working: true, is_working_day: true },
    ];
    await admin.from("barber_schedules").insert(rows);
  } catch {}
}

/**
 * 2. PRIMEIRO ACESSO / ATIVAÇÃO RÁPIDA DE SENHA (COM BOOTSTRAP DE BANCO 100% VAZIO)
 * - Localiza o barbeiro na tabela 'barbers' pelo número de telefone tratado (com ou sem máscara).
 * - Se o banco estiver vazio ou for Matheus/William, cria o registo inicial automaticamente com escala semanal.
 * - Gera o hash seguro via bcrypt e cria a sessão autenticada de imediato.
 */
export async function setupOrResetBarberPasswordAction({ phone, password, confirm, name }) {
  const reqHeaders = await headers();
  const clientIp = getClientIp(reqHeaders);

  const cleanPhone = canonicalPhone(phone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return { ok: false, error: "Digite um telefone válido com DDD (mínimo 10 dígitos)." };
  }

  const validationError = validateNewPassword(password, confirm);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    const admin = createAdminClient();

    // 1. Busca os barbeiros cadastrados no banco para validar existência
    const { data: barbers, error: fetchErr } = await admin
      .from("barbers")
      .select("id, name, phone, role, active, is_active, auth_user_id, password_hash");

    if (fetchErr) {
      console.error("[setupOrResetBarberPasswordAction] Erro ao buscar barbeiros:", fetchErr.message || fetchErr);
      throw fetchErr;
    }

    // Localiza o barbeiro com comparação tolerante a máscaras, parênteses e hífens
    let barber = barbers?.find((b) => matchBarberPhone(b.phone, cleanPhone));

    // Se for um dos telefones oficiais da barbearia (ou banco 100% vazio no primeiro acesso), cria-o
    if (!barber) {
      const initialHash = await hashPassword(password);
      if (cleanPhone === "83996646306" || cleanPhone.endsWith("996646306")) {
        const { data: created, error: insertErr } = await admin
          .from("barbers")
          .upsert({
            id: "b949db29-efb1-4131-8234-873195068328",
            name: "Matheus",
            phone: "83996646306",
            email: "matheus@jmbarberclub.com",
            role: "admin",
            is_active: true,
            active: true,
            password_hash: initialHash,
            commission_percent: 50.00,
            permissions: {
              manage_services: true,
              manage_schedule_others: true,
              view_all_appointments: true,
              manage_finance: true,
            },
          }, { onConflict: "id" })
          .select("id, name, phone, role, active, is_active, password_hash")
          .single();
        if (!insertErr && created) {
          barber = created;
          await seedDefaultScheduleForBarber(admin, created.id);
        }
      } else if (cleanPhone === "83991751875" || cleanPhone.endsWith("991751875")) {
        const { data: created, error: insertErr } = await admin
          .from("barbers")
          .upsert({
            id: "9ebcd15c-b747-4d0b-b12f-5de9465363f9",
            name: "William",
            phone: "83991751875",
            email: "william@jmbarberclub.com",
            role: "manager",
            is_active: true,
            active: true,
            password_hash: initialHash,
            commission_percent: 50.00,
            permissions: {
              manage_services: true,
              manage_schedule_others: true,
              view_all_appointments: true,
              manage_finance: false,
              can_manage_finances: false,
              can_view_global_finances: false,
              can_register_expenses: false,
            },
          }, { onConflict: "id" })
          .select("id, name, phone, role, active, is_active, password_hash")
          .single();
        if (!insertErr && created) {
          barber = created;
          await seedDefaultScheduleForBarber(admin, created.id);
        }
      } else if (!barbers || barbers.length === 0) {
        // Bootstrap de emergência caso a tabela barbers esteja 100% vazia e outro telefone faça o 1º acesso
        const { data: created, error: insertErr } = await admin
          .from("barbers")
          .insert({
            name: name?.trim() || "Administrador Chefe",
            phone: cleanPhone,
            role: "admin",
            is_active: true,
            active: true,
            password_hash: initialHash,
            commission_percent: 50.00,
            permissions: {
              manage_services: true,
              manage_schedule_others: true,
              view_all_appointments: true,
              manage_finance: true,
            },
          })
          .select("id, name, phone, role, active, is_active, password_hash")
          .single();
        if (!insertErr && created) {
          barber = created;
          await seedDefaultScheduleForBarber(admin, created.id);
        }
      }
    }

    if (!barber || barber.active === false || barber.is_active === false) {
      return {
        ok: false,
        error: "Número de telefone não cadastrado na equipe. Fale com o chefe Matheus.",
      };
    }

    // 2. Gera o hash seguro com bcrypt (fator de custo 10)
    const hashedPassword = await hashPassword(password);

    // 3. Grava a nova senha na coluna oficial 'password_hash' da tabela 'barbers'
    const updatePayload = {
      password_hash: hashedPassword,
      updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await admin
      .from("barbers")
      .update(updatePayload)
      .eq("id", barber.id);

    if (updateErr) {
      console.error("[setupOrResetBarberPasswordAction] Erro no update do password_hash:", updateErr.message || updateErr);
      
      // Fallback defensivo: se porventura o schema tiver coluna 'password' em vez de 'password_hash'
      if (updateErr.message && updateErr.message.includes("password_hash")) {
        const { error: fallbackErr } = await admin
          .from("barbers")
          .update({ password: hashedPassword, updated_at: new Date().toISOString() })
          .eq("id", barber.id);

        if (fallbackErr) {
          console.error("[setupOrResetBarberPasswordAction] Erro no fallback:", fallbackErr.message);
          return { ok: false, error: "Não foi possível gravar a senha no banco de dados." };
        }
      } else {
        return { ok: false, error: "Não foi possível gravar a senha no banco de dados." };
      }
    }

    // Sincroniza também no Supabase Auth se houver vínculo direto
    if (barber.auth_user_id) {
      try {
        await admin.auth.admin.updateUserById(barber.auth_user_id, { password });
      } catch (authErr) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[setupOrResetBarberPasswordAction] Aviso sync Auth:", authErr?.message);
        }
      }
    }

    // 4. Define o cookie de sessão imediatamente
    await setBarberSessionCookie({
      ...barber,
      password_hash: hashedPassword,
    });

    await logSecurityEvent({
      action: "DIRECT_PASSWORD_SETUP_SUCCESS",
      barberId: barber.id,
      ip: clientIp,
      success: true,
    });

    return {
      ok: true,
      signedIn: true,
      name: barber.name,
      message: `Senha definida com sucesso! Bem-vindo, ${barber.name}.`,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[setupOrResetBarberPasswordAction] Exceção:", err?.message || err);
    }
    return {
      ok: false,
      error: "Ocorreu um erro ao definir sua senha. Tente novamente.",
    };
  }
}

/**
 * 3. LOGOUT DO PAINEL
 * Limpa o cookie 'jm_barber_session' de forma atômica.
 */
export async function logoutBarberAction() {
  await clearBarberSessionCookie();
  return { ok: true };
}

/**
 * 4. VERIFICAÇÃO RÁPIDA DE STATUS POR TELEFONE
 */
export async function checkBarberStatusAction(phone) {
  const digits = canonicalPhone(phone);
  if (!digits || digits.length < 10) {
    return { ok: false, error: "Digite um número com DDD (mínimo 10 dígitos)." };
  }

  try {
    const admin = createAdminClient();
    const { data: barbers, error } = await admin
      .from("barbers")
      .select("id, name, phone, role, active, password_hash");

    if (error) throw error;

    const barber = barbers?.find((b) => matchBarberPhone(b.phone, digits));

    if (!barber || barber.active === false) {
      return {
        ok: false,
        error: "Número não cadastrado na equipe. Fale com o gerente Matheus.",
      };
    }

    const hasPassword = Boolean(barber.password_hash);

    return {
      ok: true,
      barberId: barber.id,
      name: barber.name,
      role: barber.role,
      hasPassword,
    };
  } catch (err) {
    return { ok: false, error: "Falha de conexão com o banco de dados." };
  }
}
