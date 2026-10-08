import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Valida o token e renova-o se estiver perto de expirar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isServerAction = request.headers.has('next-action');

  function redirectTo(path) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = '';
    const res = NextResponse.redirect(url);
    // preserva cookies renovados pelo Supabase
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  }

  // Sem sessão a tentar abrir o painel -> /login.
  // Server Actions ficam de fora: elas próprias devolvem { error: 'AUTH_EXPIRED' }.
  if (!user && pathname.startsWith('/admin') && !isServerAction) {
    return redirectTo('/login');
  }

  // Já logado a abrir /login -> painel.
  if (user && pathname === '/login') {
    return redirectTo('/admin/agenda');
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|workbox-.*|worker-.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
