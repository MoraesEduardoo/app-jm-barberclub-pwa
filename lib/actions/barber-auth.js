"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, ensureAuthUserForBarber, findAuthUserByBarberId } from "@/lib/supabase/admin";
import { phoneDigits, phoneToAuthEmail } from "@/lib/auth-identity";
import { validateNewPassword } from "@/lib/password-policy";
import { checkIpRateLimit, getClientIp, logSecurityEvent } from "@/lib/security";

function canonicalPhone(value) {
  const d = phoneDigits(value);
  return d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
}

/**
 * Verifica se o telefone pertence a um barbeiro ativo no sistema.
 * Não exige códigos de SMS ou e-mail.
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
      .select("id, name, phone, role, active, auth_user_id");

    if (error) throw error;

    const barber = barbers?.find((b) => canonicalPhone(b.phone) === digits);

    if (!barber) {
      return {
        ok: false,
        error: "Número não cadastrado na equipe. Fale com o gerente Matheus.",
      };
    }

    if (barber.active === false) {
      return {
        ok: false,
        error: "Este profissional está inativo no momento. Fale com o Matheus.",
      };
    }

    // Verifica se já possui usuário no Auth e auth_user_id vinculado
    const hasAuth = Boolean(barber.auth_user_id);

    return {
      ok: true,
      barberId: barber.id,
      name: barber.name,
      role: barber.role,
      hasAuth,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[checkBarberStatusAction]", err?.message || err);
    }
    return { ok: false, error: "Falha de conexão. Verifique sua internet." };
  }
}

/**
 * Fluxo Direto e Descomplicado de Primeiro Acesso e Nova Senha:
 * O barbeiro digita seu telefone, escolhe a nova senha e confirma.
 * O sistema valida que ele é um profissional cadastrado, salva a senha
 * no Supabase Auth, vincula a conta e já abre a sessão imediatamente.
 * Zero códigos externos ou SMS!
 */
export async function setupOrResetBarberPasswordAction({ phone, password, confirm }) {
  const reqHeaders = await headers();
  const clientIp = getClientIp(reqHeaders);

  // Rate limit por IP para prevenir força bruta automatizada
  const ipCheck = checkIpRateLimit(clientIp, { maxAttempts: 15, windowMinutes: 10, blockMinutes: 20 });
  if (!ipCheck.allowed) {
    return {
      ok: false,
      error: `Muitas tentativas a partir deste IP. Aguarde ${ipCheck.retryAfterMinutes} minutos.`,
    };
  }

  const digits = canonicalPhone(phone);
  if (!digits || digits.length < 10) {
    return { ok: false, error: "Digite um telefone válido com DDD." };
  }

  const validationError = validateNewPassword(password, confirm);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    const admin = createAdminClient();

    // 1. Localiza o barbeiro ativo no banco de dados
    const { data: barbers, error: fetchErr } = await admin
      .from("barbers")
      .select("id, name, phone, role, active, auth_user_id");

    if (fetchErr) throw fetchErr;

    const barber = barbers?.find((b) => canonicalPhone(b.phone) === digits);

    if (!barber || barber.active === false) {
      await logSecurityEvent({
        action: "DIRECT_AUTH_UNKNOWN_PHONE",
        ip: clientIp,
        success: false,
      });
      return {
        ok: false,
        error: "Número não cadastrado na equipe. Fale com o gerente Matheus.",
      };
    }

    // 2. Garante que o usuário existe no Supabase Auth
    const authUser = await ensureAuthUserForBarber(admin, barber.id);
    if (!authUser?.id) {
      throw new Error("Não foi possível inicializar a conta de autenticação.");
    }

    // 3. Atualiza a senha no Supabase Auth
    const { error: updateErr } = await admin.auth.admin.updateUserById(authUser.id, {
      password,
      user_metadata: {
        name: barber.name,
        phone: barber.phone,
        password_configured: true,
      },
    });

    if (updateErr) {
      if (updateErr.code === "weak_password") {
        return { ok: false, error: "A senha é muito simples. Use letras e números." };
      }
      throw updateErr;
    }

    // 4. Garante o vínculo dos campos user_id e auth_user_id na tabela barbers
    try {
      await admin
        .from("barbers")
        .update({ auth_user_id: authUser.id, user_id: authUser.id })
        .eq("id", barber.id);
    } catch {
      await admin
        .from("barbers")
        .update({ auth_user_id: authUser.id })
        .eq("id", barber.id);
    }

    await logSecurityEvent({
      action: "DIRECT_PASSWORD_SETUP_SUCCESS",
      barberId: barber.id,
      ip: clientIp,
      success: true,
    });

    // 5. Autentica e grava os cookies de sessão no navegador
    const supabase = await createClient();
    const cleanPhone = digits;
    const internalEmail = `${cleanPhone}@barbers.jmbarberclub.app`;
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password,
    });

    return {
      ok: true,
      signedIn: !signInErr,
      name: barber.name,
      message: signInErr
        ? "Senha definida com sucesso! Agora você já pode entrar com sua senha."
        : `Bem-vindo, ${barber.name}! Acesso liberado.`,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[setupOrResetBarberPasswordAction]", err?.message || err);
    }
    return {
      ok: false,
      error: "Ocorreu um erro ao definir sua senha. Tente novamente ou fale com o Matheus.",
    };
  }
}

/**
 * Função de Login Pura por Telemóvel + Senha (Regra de Ouro):
 * O barbeiro NUNCA digita e-mail.
 * O sistema recebe o telemóvel, limpa espaços e caracteres especiais,
 * deriva o e-mail interno invisível:
 * const internalEmail = `${cleanPhone}@barbers.jmbarberclub.app`;
 * e efetua o signInWithPassword de forma limpa, prevenindo o erro 500.
 */
export async function loginWithPhoneAction({ phone, password }) {
  const digits = canonicalPhone(phone);
  if (!digits || digits.length < 10) {
    return { ok: false, error: "Digite um telefone válido com DDD (mínimo 10 dígitos)." };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: "A senha precisa ter pelo menos 6 caracteres." };
  }

  const cleanPhone = digits;
  const internalEmail = `${cleanPhone}@barbers.jmbarberclub.app`;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password,
    });

    if (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[loginWithPhoneAction] Erro no login Supabase:", error.message);
      }
      return {
        ok: false,
        error: "Telefone ou senha incorretos. Se for seu primeiro acesso, use a opção 'Primeiro Acesso' para definir sua senha.",
      };
    }

    // Auto-vínculo para garantir que user_id e auth_user_id estejam preenchidos
    if (data?.user?.id) {
      try {
        const admin = createAdminClient();
        const { data: barbers } = await admin
          .from("barbers")
          .select("id, auth_user_id, user_id, phone");

        const barber = barbers?.find((b) => canonicalPhone(b.phone) === cleanPhone);

        if (barber) {
          try {
            await admin
              .from("barbers")
              .update({ auth_user_id: data.user.id, user_id: data.user.id })
              .eq("id", barber.id);
          } catch {
            await admin
              .from("barbers")
              .update({ auth_user_id: data.user.id })
              .eq("id", barber.id);
          }

          if (data.user.app_metadata?.barber_id !== barber.id) {
            await admin.auth.admin.updateUserById(data.user.id, {
              app_metadata: { ...(data.user.app_metadata || {}), barber_id: barber.id },
            });
          }
        }
      } catch {
        // Ignora erro em sincronização pós-login
      }
    }

    return { ok: true, user: data?.user };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[loginWithPhoneAction] Exceção capturada:", err?.message || err);
    }
    return {
      ok: false,
      error: "Falha de conexão com o servidor. Tente novamente.",
    };
  }
}

