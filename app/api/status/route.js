import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, max-age=0",
};

/**
 * GET /api/status
 * Endpoint público para consulta rápida pelo Chatbot (chatbot-JMBarberclub)
 * do estado do Modo Lotado (`is_crowded`).
 */
export async function GET() {
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
        { status: 200, headers: CORS_HEADERS }
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
      { status: 200, headers: CORS_HEADERS }
    );
  } catch {
    return NextResponse.json(
      {
        ok: true,
        is_crowded: false,
        updated_at: null,
        crowded_message: null,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
