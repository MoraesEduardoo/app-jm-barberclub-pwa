import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) {
      console.error("[auth/verify]", error.code, error.message);
      return redirectTo(request, "/recuperar-senha?erro=link");
    }
  } catch (e) {
    console.error("[auth/verify]", e);
    return redirectTo(request, "/recuperar-senha?erro=rede");
  }

  return redirectTo(request, "/update-password");
}
