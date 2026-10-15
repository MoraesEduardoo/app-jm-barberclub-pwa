import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/services
 * Endpoint público consumido pelo Chatbot oficial da JM Barberclub
 * Retorna todos os serviços ativos com nomes, preços, durações e fotos ilustrativas.
 */
export async function GET() {
  try {
    const admin = createAdminClient();

    // 1. Busca todos os serviços ordenados
    const { data: services, error: sErr } = await admin
      .from('services')
      .select('*')
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (sErr) {
      return NextResponse.json({ ok: false, error: sErr.message }, { status: 500 });
    }

    // 2. Busca galeria para fallback de fotos
    let gallery = [];
    try {
      const { data: gData } = await admin.from('haircut_gallery').select('*').eq('is_active', true);
      gallery = gData || [];
    } catch {
      // fallback
    }

    const formatted = (services || []).map((s) => {
      let img = s.image_url || s.storage_url || null;

      if (!img && gallery.length > 0) {
        const match = gallery.find((g) => {
          if (!g.title) return false;
          const gT = g.title.toLowerCase();
          const sN = s.name.toLowerCase();
          return (
            gT === sN ||
            gT.includes(sN) ||
            sN.includes(gT) ||
            (sN.includes('degradê') && gT.includes('degradê')) ||
            (sN.includes('lowfade') && gT.includes('lowfade')) ||
            (sN.includes('barboterapia') && gT.includes('barboterapia'))
          );
        });
        if (match) {
          img = match.image_url || match.storage_url;
        }
      }

      const numPrice = Number(s.price || 0);
      const normalizedPrice = numPrice >= 1000 ? numPrice / 100 : numPrice;

      return {
        id: s.id,
        name: s.name,
        description: s.description || null,
        category: s.category || 'corte',
        price: Number(normalizedPrice.toFixed(2)),
        price_in_cents: Math.round(normalizedPrice * 100),
        duration_minutes: s.default_duration_minutes || s.duration_minutes || 30,
        image_url: img,
        is_active: s.is_active !== false && s.active !== false,
      };
    });

    const activeServices = formatted.filter((s) => s.is_active);

    return NextResponse.json(
      {
        ok: true,
        count: activeServices.length,
        data: activeServices,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
