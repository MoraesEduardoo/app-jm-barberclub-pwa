import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

/**
 * GET /api/status
 * Endpoint público para consulta rápida pelo Chatbot (chatbot-JMBarberclub)
 * do estado do Modo Lotado (`is_crowded`), com origem CORS restrita.
 */
export async function GET(request) {
  const corsHeaders = buildCorsHeaders(request, { methods: "GET, OPTIONS" });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("barbershop_status")
      .select("id, is_crowded, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          ok: true,
          is_crowded: false,
          updated_at: null,
          crowded_message: null,
        },
        { status: 200, headers: corsHeaders }
      );
    }

    const isCrowded = Boolean(data?.is_crowded);

    return NextResponse.json(
      {
        ok: true,
        is_crowded: isCrowded,
        updated_at: data?.updated_at || null,
        crowded_message: isCrowded
          ? "Movimento intenso hoje na barbearia: chegue alguns minutos antes do seu horário."
          : null,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch {
    return NextResponse.json(
      {
        ok: true,
        is_crowded: false,
        updated_at: null,
        crowded_message: null,
      },
      { status: 200, headers: corsHeaders }
    );
  }
}

export async function OPTIONS(request) {
  const corsHeaders = buildCorsHeaders(request, { methods: "GET, OPTIONS" });
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
