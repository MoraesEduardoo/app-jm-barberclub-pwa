"use client";

import { useRef, useState, useTransition } from "react";
import { ShieldCheck, Trash2, UserX, UserCheck, Percent, KeyRound, MessageCircle, Copy, Loader2 } from "lucide-react";
import { PERMISSION_KEYS } from "@/lib/auth";
import {
  updateTeamMemberPermission,
  toggleTeamMemberActive,
  removeTeamMember,
  updateTeamMemberCommission,
} from "@/lib/actions/team";
import { createRecoveryLink } from "@/lib/actions/recovery";

const PERMISSION_LABELS = {
  [PERMISSION_KEYS.MANAGE_SERVICES]: "Editar serviços e preços",
  [PERMISSION_KEYS.MANAGE_SCHEDULE_OTHERS]:
    "Editar expediente de outros barbeiros",
  [PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS]: "Ver agenda de toda a equipe",
  [PERMISSION_KEYS.MANAGE_FINANCE]: "Ver caixa e faturamento completo",
};


// Telefone -> dígitos com DDI 55 (wa.me exige formato internacional).
function whatsappNumber(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length <= 11 ? `55${digits}` : digits;
}

export default function TeamMemberCard({ member, onChanged }) {
  const isChief = member.role === "admin";
  const [isPending, startTransition] = useTransition();
  const recoveryLock = useRef(false);
  const [recovery, setRecovery] = useState({ loading: false, error: "", link: null, copied: false });
  const [memberState, setMemberState] = useState(member);
  const [commissionDraft, setCommissionDraft] = useState(
    String(member.commission_percent ?? 0),
  );

  function handleToggle(key, value) {
    const previousPermissions = { ...memberState.permissions };
    
    // Atualização otimista imediata na UI local
    setMemberState((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: value },
    }));

    startTransition(async () => {
      try {
        await updateTeamMemberPermission(member.id, key, value);
      } catch (error) {
        console.error(error);
        // Reverte em caso de erro
        setMemberState((prev) => ({
          ...prev,
          permissions: previousPermissions,
        }));
      }
    });
  }

  function handleCommissionChange(raw) {
    setCommissionDraft(raw);
  }

  function handleCommissionBlur() {
    const value = Math.min(100, Math.max(0, Number(commissionDraft) || 0));
    setCommissionDraft(String(value));
    
    if (value === Number(memberState.commission_percent ?? 0)) return;

    const previousCommission = memberState.commission_percent;

    // Atualização otimista imediata
    setMemberState((prev) => ({ ...prev, commission_percent: value }));

    startTransition(async () => {
      try {
        const saved = await updateTeamMemberCommission(member.id, value);
        if (saved !== undefined) {
          setMemberState((prev) => ({ ...prev, commission_percent: saved }));
        }
      } catch (error) {
        console.error(error);
        setMemberState((prev) => ({ ...prev, commission_percent: previousCommission }));
        setCommissionDraft(String(previousCommission));
      }
    });
  }

  function handleToggleActive() {
    const nextActive = !memberState.active;
    const previousActive = memberState.active;

    // Atualização otimista imediata
    setMemberState((prev) => ({ ...prev, active: nextActive }));

    startTransition(async () => {
      try {
        await toggleTeamMemberActive(member.id, nextActive);
      } catch (error) {
        console.error(error);
        setMemberState((prev) => ({ ...prev, active: previousActive }));
      }
    });
  }

  async function handleRecoveryLink() {
    if (recoveryLock.current) return; // bloqueia toque duplo
    recoveryLock.current = true;
    setRecovery({ loading: true, error: "", link: null, copied: false });
    try {
      const res = await createRecoveryLink(member.id);
      if (res?.error === "AUTH_EXPIRED") {
        window.location.assign("/login");
        return;
      }
      if (res?.error || !res?.url) {
        setRecovery({ loading: false, error: res?.error || "Não foi possível gerar o link.", link: null, copied: false });
        return;
      }
      setRecovery({ loading: false, error: "", link: res, copied: false });
    } catch {
      setRecovery({ loading: false, error: "Falha de conexão. Toque para tentar novamente.", link: null, copied: false });
    } finally {
      recoveryLock.current = false;
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(recovery.link.url);
      setRecovery((prev) => ({ ...prev, copied: true }));
    } catch {
      setRecovery((prev) => ({ ...prev, error: "Não foi possível copiar. Use o botão do WhatsApp." }));
    }
  }

  async function handleRemove() {
    if (!confirm(`Remover ${member.name} da equipe?`)) return;
    try {
      await removeTeamMember(member.id);
      if (onChanged) onChanged(member.id);
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="bg-surface border border-zinc-800 rounded-xl p-4 transition-opacity">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-elevated border border-zinc-700 flex items-center justify-center text-sm font-semibold text-white">
            {member.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-white text-sm font-medium">{member.name}</p>
            <p className="text-zinc-500 text-xs">{member.phone}</p>
          </div>
        </div>

        {isChief ? (
          <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent-light">
            <ShieldCheck size={11} /> Chefe
          </span>
        ) : (
          <button
            onClick={handleToggleActive}
            disabled={isPending}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
              memberState.active
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {memberState.active ? (
              <UserCheck size={11} />
            ) : (
              <UserX size={11} />
            )}
            {memberState.active ? "Ativo" : "Inativo"}
          </button>
        )}
      </div>

      {!isChief && (
        <>
          <div className="mt-3 space-y-2.5 border-t border-zinc-800 pt-3">
            {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-zinc-300 text-xs">{label}</span>
                <button
                  role="switch"
                  aria-checked={!!memberState.permissions?.[key]}
                  onClick={() =>
                    handleToggle(key, !memberState.permissions?.[key])
                  }
                  disabled={isPending}
                  className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
                    memberState.permissions?.[key]
                      ? "bg-accent"
                      : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      memberState.permissions?.[key]
                        ? "translate-x-4"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-3 mt-3">
            <span className="flex items-center gap-1.5 text-zinc-300 text-xs">
              <Percent size={13} className="text-zinc-500" />
              Comissão sobre o faturado
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={commissionDraft}
                onChange={(e) => handleCommissionChange(e.target.value)}
                onBlur={handleCommissionBlur}
                className="w-20 h-10 rounded-lg bg-elevated border border-zinc-700 px-2.5 text-base text-white text-right focus:outline-none focus:ring-1 focus:ring-accent touch-manipulation"
              />
              <span className="text-zinc-500 text-xs">%</span>
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-3 mt-3">
            <button
              onClick={handleRecoveryLink}
              disabled={recovery.loading}
              className="flex items-center gap-1.5 text-zinc-300 text-xs font-medium hover:text-white transition-colors disabled:opacity-50"
            >
              {recovery.loading ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} className="text-zinc-500" />}
              {recovery.loading ? "Gerando link…" : "Gerar link de recuperação de senha"}
            </button>

            {recovery.error && (
              <p role="alert" className="text-accent-light text-[11px] mt-2">{recovery.error}</p>
            )}

            {recovery.link && (
              <div className="mt-2.5 flex items-center gap-2">
                <a
                  href={`https://wa.me/${whatsappNumber(recovery.link.phone)}?text=${encodeURIComponent(
                    `Olá, ${recovery.link.name}! Use este link para definir sua nova senha do painel (vale uma única vez): ${recovery.link.url}`,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white active:bg-accent-dark"
                >
                  <MessageCircle size={13} /> Enviar no WhatsApp
                </a>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1.5 text-[11px] font-medium text-zinc-300 hover:text-white"
                >
                  <Copy size={13} /> {recovery.copied ? "Copiado" : "Copiar link"}
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleRemove}
            className="flex items-center gap-1.5 text-accent-light text-xs font-medium mt-3.5 hover:opacity-80 transition-opacity"
          >
            <Trash2 size={13} /> Remover da equipe
          </button>
        </>
      )}
    </div>
  );
}
