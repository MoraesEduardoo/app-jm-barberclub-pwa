import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkIpRateLimit, getClientIp, logSecurityEvent } from "@/lib/security";

export const dynamic = "force-dynamic";

function redirectTo(request, path) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  // 303: transforma o POST em GET na página de destino
  return NextResponse.redirect(url, 303);
}

/** Valida o token de recuperação (uso único), abre a sessão em cookies e segue. */
export async function POST(request) {
  const clientIp = getClientIp(request.headers);

  // Rate limiting por IP na validação de OTP para impedir ataques automatizados
  const ipCheck = checkIpRateLimit(clientIp, { maxAttempts: 15, windowMinutes: 15, blockMinutes: 30 });
  if (!ipCheck.allowed) {
    await logSecurityEvent({
      action: "OTP_VERIFY_RATE_LIMIT_BLOCKED",
      ip: clientIp,
      success: false,
    });
    return redirectTo(request, "/recuperar-senha?erro=limite");
  }

  let tokenHash = "";
  let type = "";
  try {
    const form = await request.formData();
    tokenHash = String(form.get("token_hash") || "");
    type = String(form.get("type") || "");
  } catch {
    return redirectTo(request, "/recuperar-senha?erro=link");
  }

  if (!tokenHash || type !== "recovery") {
    return redirectTo(request, "/recuperar-senha?erro=link");
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[auth/verify]", error.code, error.message);
      }
      await logSecurityEvent({
        action: "OTP_VERIFY_FAILED",
        ip: clientIp,
        success: false,
        details: { errorCode: error.code },
      });
      return redirectTo(request, "/recuperar-senha?erro=link");
    }

    await logSecurityEvent({
      action: "OTP_VERIFY_SUCCESS",
      ip: clientIp,
      success: true,
    });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[auth/verify]", e?.message || e);
    }
    return redirectTo(request, "/recuperar-senha?erro=rede");
  }

  return redirectTo(request, "/update-password");
}
