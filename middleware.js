import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request) {
  // Cria uma resposta inicial que o middleware vai modificar
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Atualiza os cookies no request para que os componentes do servidor vejam as mudanças
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          
          supabaseResponse = NextResponse.next({
            request,
          });
          
          // Atualiza os cookies no response para que o navegador do utilizador os guarde
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANTE: Chamar o getUser() aqui faz com que o Supabase valide o token.
  // Se o token estiver perto de expirar, o Supabase gera um novo automaticamente
  // e o código acima (setAll) guarda esse token renovado no navegador.
  await supabase.auth.getUser();

  return supabaseResponse;
}

// O matcher diz ao Next.js em quais rotas este middleware deve ser executado.
// Esta configuração faz com que rode em todo o lado, EXCETO em ficheiros estáticos (imagens, CSS, etc.)
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};