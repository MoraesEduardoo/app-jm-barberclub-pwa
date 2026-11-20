"use server";

import { revalidatePath } from "next/cache";
import { requireBarber } from "@/lib/auth-server";
import { PERMISSION_KEYS } from "@/lib/auth";

function isMissingStatusTableError(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const msg = String(error.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (msg.includes("barbershop_status") &&
      (msg.includes("does not exist") || msg.includes("not found") || msg.includes("schema cache")))
  );
}

/**
 * Consulta o status atual de movimento da barbearia ("Modo Lotado") no Supabase.
 */
export async function getBarbershopStatus() {
  try {
    const ctx = await requireBarber();
    if (ctx.error) {
      return { error: ctx.error === "FORBIDDEN" ? "Sem permissão." : "AUTH_EXPIRED" };
    }

    const { data, error } = await ctx.supabase
      .from("barbershop_status")
      .select("id, is_crowded, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      if (isMissingStatusTableError(error)) {
        return {
          is_crowded: false,
          updated_at: null,
          tableMissing: true,
        };
      }
      return {
        is_crowded: false,
        updated_at: null,
        error: error.message,
      };
    }

    if (!data) {
      const nowIso = new Date().toISOString();
      await ctx.supabase
        .from("barbershop_status")
        .upsert({ id: 1, is_crowded: false, updated_at: nowIso }, { onConflict: "id" });

      return {
        is_crowded: false,
        updated_at: nowIso,
      };
    }

    return {
      is_crowded: Boolean(data.is_crowded),
      updated_at: data.updated_at || null,
    };
  } catch (err) {
    return {
      is_crowded: false,
      updated_at: null,
      error: err?.message || "Não foi possível carregar o status da barbearia.",
    };
  }
}

/**
 * Ativa ou desativa o Modo Lotado (`is_crowded`) imediatamente no Supabase.
 */
export async function setBarbershopCrowdedMode(nextCrowded) {
  try {
    const ctx = await requireBarber(PERMISSION_KEYS.MANAGE_CROWDED_MODE);
    if (ctx.error) {
      return {
        error:
          ctx.error === "FORBIDDEN"
            ? "Você não tem permissão para alterar o Modo Lotado."
            : "AUTH_EXPIRED",
      };
    }

    const isCrowded = Boolean(nextCrowded);
    const updatedAt = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from("barbershop_status")
      .upsert(
        {
          id: 1,
          is_crowded: isCrowded,
          updated_at: updatedAt,
        },
        { onConflict: "id" }
      )
      .select("id, is_crowded, updated_at")
      .maybeSingle();

    if (error) {
      if (isMissingStatusTableError(error)) {
        return {
          error:
            "Tabela barbershop_status não encontrada no Supabase. Execute o comando SQL no SQL Editor para ativar o Modo Lotado.",
          tableMissing: true,
        };
      }
      return { error: `Erro ao salvar Modo Lotado: ${error.message}` };
    }

    revalidatePath("/admin/agenda");

    return {
      success: true,
      is_crowded: data ? Boolean(data.is_crowded) : isCrowded,
      updated_at: data?.updated_at || updatedAt,
    };
  } catch (err) {
    return {
      error: err?.message || "Erro inesperado ao atualizar o Modo Lotado.",
    };
  }
}
