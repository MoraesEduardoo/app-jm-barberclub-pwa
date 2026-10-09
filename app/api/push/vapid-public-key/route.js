import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/push/vapid-public-key
 * 
 * Endpoint que expõe a chave pública VAPID para os navegadores clientes.
 * Permite que o frontend obtenha a chave pública mesmo que NEXT_PUBLIC_VAPID_PUBLIC_KEY
 * não tenha sido pré-embutida estaticamente durante a compilação do Next.js.
 */
export async function GET() {
  const rawKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    process.env.VAPID_PUBLIC_KEY ||
    '';

  const publicKey = (rawKey || '').trim().replace(/^["']|["']$/g, '');

  if (!publicKey) {
    return NextResponse.json(
      {
        configured: false,
        publicKey: null,
        error:
          'A chave pública VAPID não está configurada no servidor. Defina NEXT_PUBLIC_VAPID_PUBLIC_KEY nas variáveis de ambiente.',
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    configured: true,
    publicKey,
  });
}
