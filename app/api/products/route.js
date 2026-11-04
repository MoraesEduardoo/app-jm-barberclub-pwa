import { NextResponse } from "next/server";
import { listProducts } from "@/lib/actions/products";

export const dynamic = "force-dynamic";

/**
 * GET /api/products
 * Endpoint rápido de consulta do catálogo de produtos em estoque.
 * Evita bloqueios na fila sequencial de Server Actions durante transições de modais.
 */
export async function GET() {
  try {
    const data = await listProducts();
    const safeList = Array.isArray(data) ? data : [];

    return NextResponse.json(
      {
        ok: true,
        count: safeList.length,
        data: safeList,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Erro ao consultar produtos em estoque.",
        data: [],
      },
      { status: 200 }
    );
  }
}
