"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Flame, Loader2, CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getBarbershopStatus, setBarbershopCrowdedMode } from "@/lib/actions/status";
import { useBarber } from "@/lib/barber-context";
import { PERMISSION_KEYS } from "@/lib/auth";
import { cacheKeys, getCache, setCache } from "@/lib/admin-cache";
import { endSession } from "@/lib/session";
import { toast } from "@/lib/toast";

/**
 * CrowdedModeToggle:
 * Controle rápido no topo da Agenda para ativar/desativar o "Modo Lotado" no Supabase.
 * Mantém o estado sincronizado ao recarregar e entre dispositivos via Realtime.
 */
export default function CrowdedModeToggle() {
  const { can } = useBarber();
  const canManageCrowded = can(PERMISSION_KEYS.MANAGE_CROWDED_MODE);
  const statusKey = cacheKeys.barbershopStatus();
  const cached = getCache(statusKey);

  const [isCrowded, setIsCrowded] = useState(() =>
    typeof cached?.is_crowded === "boolean" ? cached.is_crowded : false
  );
  const [loading, setLoading] = useState(() => cached === undefined);
  const [saving, setSaving] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const mountedRef = useRef(true);

  const syncFromServer = useCallback(async () => {
    try {
      const res = await getBarbershopStatus();
      if (!mountedRef.current) return;

      if (res?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      const nextCrowded = Boolean(res?.is_crowded);
      setIsCrowded(nextCrowded);
      setTableMissing(Boolean(res?.tableMissing));
      setCache(statusKey, {
        is_crowded: nextCrowded,
        updated_at: res?.updated_at || null,
      });
    } catch {
      // Mantém último estado conhecido sem quebrar a tela
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [statusKey]);

  useEffect(() => {
    mountedRef.current = true;
    syncFromServer();

    let channel = null;
    let supabase = null;
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (url && anon && !url.includes("placeholder")) {
        supabase = createSupabaseBrowserClient();
        channel = supabase
          .channel("barbershop-status-live")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "barbershop_status",
            },
            (payload) => {
              const row = payload?.new;
              if (row && typeof row.is_crowded === "boolean" && mountedRef.current) {
                setIsCrowded(row.is_crowded);
                setCache(statusKey, {
                  is_crowded: row.is_crowded,
                  updated_at: row.updated_at || null,
                });
              }
            }
          )
          .subscribe();
      }
    } catch {
      // Realtime opcional; fallback já garantido via Server Action
    }

    return () => {
      mountedRef.current = false;
      if (supabase && channel) {
        try {
          supabase.removeChannel(channel);
        } catch {}
      }
    };
  }, [syncFromServer, statusKey]);

  async function handleToggle() {
    if (!canManageCrowded) {
      toast.error("Você não tem permissão para alterar o Modo Lotado.");
      return;
    }
    if (saving || loading) return;

    const previous = isCrowded;
    const nextState = !previous;

    setIsCrowded(nextState);
    setSaving(true);

    try {
      const res = await setBarbershopCrowdedMode(nextState);

      if (res?.error === "AUTH_EXPIRED") {
        endSession();
        return;
      }

      if (res?.error || !res?.success) {
        setIsCrowded(previous);
        if (res?.tableMissing) {
          setTableMissing(true);
        }
        toast.error(res?.error || "Não foi possível alterar o Modo Lotado.");
        return;
      }

      setTableMissing(false);
      setIsCrowded(Boolean(res.is_crowded));
      setCache(statusKey, {
        is_crowded: Boolean(res.is_crowded),
        updated_at: res.updated_at || new Date().toISOString(),
      });

      if (res.is_crowded) {
        toast.success(
          "Modo Lotado ativado! Clientes receberão aviso no chatbot para chegar antes."
        );
      } else {
        toast.info("Modo Lotado desativado. Fluxo normalizado no chatbot.");
      }
    } catch {
      setIsCrowded(previous);
      toast.error("Sem conexão ao salvar o status no Supabase.");
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }

  if (!canManageCrowded && !isCrowded) {
    return null;
  }

  return (
    <div
      className={`mb-3 rounded-2xl border px-3.5 py-2.5 transition-all ${
        isCrowded
          ? "border-amber-500/60 bg-gradient-to-r from-red-950/65 via-amber-950/45 to-[#120907] shadow-[0_0_24px_rgba(245,158,11,0.16)]"
          : "border-zinc-800/90 bg-[#09090b]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
              isCrowded
                ? "bg-red-500/20 border-amber-500/50 text-amber-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400"
            }`}
          >
            {saving || loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Flame size={17} className={isCrowded ? "animate-pulse" : ""} />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-white tracking-tight">
                Modo Lotado
              </span>
              {isCrowded ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-500/25 border border-red-500/50 text-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                  Lotado Ativo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400">
                  <CheckCircle2 size={10} className="text-emerald-400" />
                  Normal
                </span>
              )}
            </div>

            <p
              className={`text-[11px] leading-snug mt-0.5 ${
                isCrowded ? "text-amber-200/95 font-medium" : "text-zinc-400"
              }`}
            >
              {isCrowded
                ? "Modo Lotado ativo: clientes receberão aviso para chegar alguns minutos antes"
                : "Fluxo normal — ative quando a barbearia estiver com movimento intenso"}
            </p>
          </div>
        </div>

        {canManageCrowded ? (
          <button
            type="button"
            role="switch"
            aria-checked={isCrowded}
            aria-label={isCrowded ? "Desativar Modo Lotado" : "Ativar Modo Lotado"}
            disabled={saving || loading}
            onClick={handleToggle}
            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-all touch-manipulation select-none active:scale-95 disabled:opacity-60 ${
              isCrowded
                ? "bg-gradient-to-r from-red-600 to-amber-500 shadow-md shadow-red-900/40"
                : "bg-zinc-800 hover:bg-zinc-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                isCrowded ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/50 px-2 py-1 text-[10px] font-medium text-amber-300 shrink-0">
            <Lock size={10} /> Ativo
          </span>
        )}
      </div>

      {tableMissing && (
        <div className="mt-2 pt-2 border-t border-amber-500/25 flex items-start gap-1.5 text-[10px] text-amber-300">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            Tabela <code>barbershop_status</code> pendente no Supabase — execute a migration SQL no SQL Editor.
          </span>
        </div>
      )}
    </div>
  );
}
