"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles,
  CheckCircle2,
  Circle,
  Users2,
  Scissors,
  Clock,
  Loader2,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import {
  getShopBootstrapStatus,
  bootstrapInitialTeamAction,
  bootstrapInitialServicesCatalogAction,
  bootstrapInitialSchedulesAction,
} from "@/lib/actions/bootstrap";
import { useBarber } from "@/lib/barber-context";
import { toast } from "@/lib/toast";

export default function SystemBootstrapCard({ onBootstrapChange }) {
  const { isChefe, isLeadership, refreshTeam } = useBarber();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyStep, setBusyStep] = useState(null); // 'team' | 'services' | 'schedules' | 'all'

  const checkStatus = useCallback(async () => {
    try {
      const res = await getShopBootstrapStatus();
      if (!res?.error) {
        setStatus(res);
      }
    } catch {
      // ignora silenciosamente
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLeadership) {
      checkStatus();
    } else {
      setLoading(false);
    }
  }, [isLeadership, checkStatus]);

  if (loading || !status || status.isFullyBootstrapped || !isLeadership) {
    return null;
  }

  async function handleBootstrapTeam() {
    setBusyStep("team");
    try {
      const res = await bootstrapInitialTeamAction();
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success("Equipe inicial (Matheus e William) e escalas registadas com sucesso!");
        await refreshTeam();
        await checkStatus();
        if (onBootstrapChange) onBootstrapChange();
      }
    } catch {
      toast.error("Falha ao inicializar a equipe.");
    } finally {
      setBusyStep(null);
    }
  }

  async function handleBootstrapServices() {
    setBusyStep("services");
    try {
      const res = await bootstrapInitialServicesCatalogAction();
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success(
          `Catálogo inicial configurado (${res.insertedCount || 13} serviços ativos)!`
        );
        await checkStatus();
        if (onBootstrapChange) onBootstrapChange();
      }
    } catch {
      toast.error("Falha ao inicializar catálogo de serviços.");
    } finally {
      setBusyStep(null);
    }
  }

  async function handleBootstrapSchedules() {
    setBusyStep("schedules");
    try {
      const res = await bootstrapInitialSchedulesAction();
      if (res?.error) {
        toast.error(res.error);
      } else {
        toast.success("Escala semanal padrão (Seg–Sáb 09:00–19:00) gravada para a equipe!");
        await checkStatus();
        if (onBootstrapChange) onBootstrapChange();
      }
    } catch {
      toast.error("Falha ao gravar escalas de expediente.");
    } finally {
      setBusyStep(null);
    }
  }

  async function handleBootstrapAll() {
    setBusyStep("all");
    try {
      await bootstrapInitialTeamAction();
      await bootstrapInitialServicesCatalogAction();
      await bootstrapInitialSchedulesAction();
      await refreshTeam();
      await checkStatus();
      if (onBootstrapChange) onBootstrapChange();
      toast.success("Banco inicializado com Equipe, Catálogo de Serviços e Escalas!");
    } catch {
      toast.error("Ocorreu um erro durante a inicialização completa.");
    } finally {
      setBusyStep(null);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-amber-500/40 bg-gradient-to-b from-amber-950/30 via-surface to-surface p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-white font-bold text-sm leading-tight">
              Configuração de Primeiro Acesso (Banco Limpo)
            </h2>
            <p className="text-zinc-400 text-[11px] mt-0.5">
              Cadastre manualmente cada secção ou inicialize a estrutura base com 1 toque.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={Boolean(busyStep)}
          onClick={handleBootstrapAll}
          className="shrink-0 flex items-center gap-1.5 rounded-xl bg-accent hover:bg-accent-light px-3 py-2 text-[11px] font-bold text-white shadow-sm active:scale-95 transition-all disabled:opacity-50"
        >
          {busyStep === "all" ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Configurando…
            </>
          ) : (
            <>
              <ShieldCheck size={13} /> Inicializar Tudo
            </>
          )}
        </button>
      </div>

      <div className="mt-3.5 space-y-2">
        {/* Passo 1: Equipe (Matheus & William) */}
        <div className="flex items-center justify-between gap-2 rounded-xl bg-black/50 border border-zinc-800/90 px-3 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {status.teamReady ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <Circle size={16} className="text-amber-400 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                <Users2 size={13} className="text-zinc-400" />
                1. Equipe Base (Matheus & William)
              </p>
              <p className="text-[10.5px] text-zinc-500 truncate">
                {status.teamReady
                  ? "Matheus (Chefe) e William (Gerente) ativos"
                  : `${status.barbersCount} profissional(is) cadastrado(s)`}
              </p>
            </div>
          </div>

          {!status.teamReady && (
            <div className="flex items-center gap-1.5 shrink-0">
              {isChefe && (
                <Link
                  href="/admin/equipe"
                  className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium"
                >
                  Manual
                </Link>
              )}
              <button
                type="button"
                disabled={Boolean(busyStep)}
                onClick={handleBootstrapTeam}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50"
              >
                {busyStep === "team" ? <Loader2 size={11} className="animate-spin" /> : "Auto"}
              </button>
            </div>
          )}
        </div>

        {/* Passo 2: Catálogo de Serviços */}
        <div className="flex items-center justify-between gap-2 rounded-xl bg-black/50 border border-zinc-800/90 px-3 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {status.servicesReady ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <Circle size={16} className="text-amber-400 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                <Scissors size={13} className="text-zinc-400" />
                2. Catálogo de Serviços e Preços
              </p>
              <p className="text-[10.5px] text-zinc-500 truncate">
                {status.servicesReady
                  ? `${status.servicesCount} serviço(s) cadastrado(s)`
                  : "Catálogo vazio (0 serviços)"}
              </p>
            </div>
          </div>

          {!status.servicesReady && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Link
                href="/admin/servicos"
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium"
              >
                Manual
              </Link>
              <button
                type="button"
                disabled={Boolean(busyStep)}
                onClick={handleBootstrapServices}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50"
              >
                {busyStep === "services" ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  "Criar 13 Serviços"
                )}
              </button>
            </div>
          )}
        </div>

        {/* Passo 3: Escalas de Trabalho */}
        <div className="flex items-center justify-between gap-2 rounded-xl bg-black/50 border border-zinc-800/90 px-3 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            {status.schedulesReady ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : (
              <Circle size={16} className="text-amber-400 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                <Clock size={13} className="text-zinc-400" />
                3. Escala Semanal de Expediente
              </p>
              <p className="text-[10.5px] text-zinc-500 truncate">
                {status.schedulesReady
                  ? "Horários de funcionamento gravados no banco"
                  : "Horários ainda não gravados na base"}
              </p>
            </div>
          </div>

          {!status.schedulesReady && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Link
                href="/admin/expediente"
                className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center gap-1"
              >
                Configurar <ArrowRight size={11} />
              </Link>
              <button
                type="button"
                disabled={Boolean(busyStep)}
                onClick={handleBootstrapSchedules}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50"
              >
                {busyStep === "schedules" ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  "Padrão 09h–19h"
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
