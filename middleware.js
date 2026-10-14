import { NextResponse } from "next/server";

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const isServerAction = request.headers.has("next-action");

  // Verifica o cookie de sessão direta do painel do barbeiro
  const barberSessionCookie = request.cookies.get("jm_barber_session")?.value;
  const hasSession = Boolean(barberSessionCookie);

  function redirectTo(path) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Sem sessão ativa tentando abrir o painel administrativo -> redireciona para /login
  if (!hasSession && pathname.startsWith("/admin") && !isServerAction) {
    return redirectTo("/login");
  }

  // Já logado tentando abrir a tela de /login -> redireciona direto para a agenda
  if (hasSession && pathname === "/login") {
    return redirectTo("/admin/agenda");
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|workbox-.*|worker-.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
