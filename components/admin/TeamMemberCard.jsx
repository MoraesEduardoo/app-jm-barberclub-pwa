"use client";

import { useRef, useState, useTransition } from "react";
import {
  ShieldCheck,
  Trash2,
  UserX,
  UserCheck,
  Percent,
  KeyRound,
  MessageCircle,
  Copy,
  Loader2,
  Clock,
  Scissors,
  CalendarOff,
  Wallet,
  ShoppingBag,
  ChevronRight,
  Sliders,
} from "lucide-react";
import { PERMISSION_KEYS } from "@/lib/auth";
import {
  updateTeamMemberPermission,
  toggleTeamMemberActive,
  removeTeamMember,
  updateTeamMemberCommission,
  updateTeamMemberAdvancedCommissions,
} from "@/lib/actions/team";
import { createRecoveryLink } from "@/lib/actions/recovery";
import TeamMemberCashSheet from "./TeamMemberCashSheet";
import TeamMemberScheduleSheet from "./TeamMemberScheduleSheet";
import TeamMemberSpecialtiesSheet from "./TeamMemberSpecialtiesSheet";
import TeamMemberExceptionsSheet from "./TeamMemberExceptionsSheet";

const PERMISSION_LABELS = {
  [PERMISSION_KEYS.MANAGE_SERVICES]: "Editar serviços e preços",
  [PERMISSION_KEYS.MANAGE_SCHEDULE_OTHERS]: "Editar expediente de outros",
  [PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS]: "Ver agenda de toda a equipe",
  [PERMISSION_KEYS.MANAGE_FINANCE]: "Ver caixa e faturamento completo",
};

function whatsappNumber(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length <= 11 ? `55${digits}` : digits;
}

/**
 * TeamMemberCard:
 * Card profissional de gerenciamento do colaborador.
 * Suporta:
 * 1. Comissões em número inteiro (ex: 50 para 50%, 30 para 30%)
 * 2. Regras avançadas de comissão (serviços vs produtos)
 * 3. Gestão de expediente individual por colaborador (dias, horas, almoço)
 * 4. Especialidades e catálogo de serviços habilitados
 * 5. Histórico de caixa e faturamento acumulado
 * 6. Bloqueios de agenda e folgas pontuais
 */
export default function TeamMemberCard({ member, onChanged }) {
  const isChief = member.role === "admin";
  const [isPending, startTransition] = useTransition();
  const recoveryLock = useRef(false);
  const [recovery, setRecovery] = useState({ loading: false, error: "", link: null, copied: false });
  const [memberState, setMemberState] = useState(member);

  // Estados para comissões em números inteiros (ex: 50 para 50%)
  const [serviceCommissionDraft, setServiceCommissionDraft] = useState(
    String(member.commission_percent ?? 50)
  );
  const [productCommissionDraft, setProductCommissionDraft] = useState(
    String(member.product_commission_percent ?? 10)
  );
  const [commissionSaving, setCommissionSaving] = useState(false);

  // Modais de gestão avançada do colaborador
  const [cashSheetOpen, setCashSheetOpen] = useState(false);
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [specialtiesSheetOpen, setSpecialtiesSheetOpen] = useState(false);
  const [exceptionsSheetOpen, setExceptionsSheetOpen] = useState(false);

  // Acordeão / aba de permissões e detalhes
  const [showPermissions, setShowPermissions] = useState(false);

  function handleToggle(key, value) {
    const previousPermissions = { ...memberState.permissions };

    setMemberState((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: value },
    }));

    startTransition(async () => {
      try {
        await updateTeamMemberPermission(member.id, key, value);
      } catch (error) {
        console.error(error);
        setMemberState((prev) => ({
          ...prev,
          permissions: previousPermissions,
        }));
      }
    });
  }

  async function handleCommissionsBlur() {
    const sValue = Math.min(100, Math.max(0, Math.round(Number(serviceCommissionDraft) || 0)));
    const pValue = Math.min(100, Math.max(0, Math.round(Number(productCommissionDraft) || 0)));

    setServiceCommissionDraft(String(sValue));
    setProductCommissionDraft(String(pValue));

    const curS = Number(memberState.commission_percent ?? 50);
    const curP = Number(memberState.product_commission_percent ?? 10);

    if (sValue === curS && pValue === curP) return;

    setCommissionSaving(true);
    try {
      const res = await updateTeamMemberAdvancedCommissions(member.id, {
        servicesPercent: sValue,
        productsPercent: pValue,
      });

      setMemberState((prev) => ({
        ...prev,
        commission_percent: res.commission_percent,
        product_commission_percent: res.product_commission_percent,
      }));
    } catch (err) {
      console.error("Erro ao salvar comissões:", err);
      setServiceCommissionDraft(String(curS));
      setProductCommissionDraft(String(curP));
    } finally {
      setCommissionSaving(false);
    }
  }

  function handleToggleActive() {
    const nextActive = !memberState.active;
    const previousActive = memberState.active;

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
    if (recoveryLock.current) return;
    recoveryLock.current = true;
    setRecovery({ loading: true, error: "", link: null, copied: false });
    try {
      const res = await createRecoveryLink(member.id);
      if (res?.error === "AUTH_EXPIRED") {
        window.location.assign("/login");
        return;
      }
      if (res?.error || !res?.url) {
        setRecovery({
          loading: false,
          error: res?.error || "Não foi possível gerar o link.",
          link: null,
          copied: false,
        });
        return;
      }
      setRecovery({ loading: false, error: "", link: res, copied: false });
    } catch {
      setRecovery({
        loading: false,
        error: "Falha de conexão. Toque para tentar novamente.",
        link: null,
        copied: false,
      });
    } finally {
      recoveryLock.current = false;
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(recovery.link.url);
      setRecovery((prev) => ({ ...prev, copied: true }));
    } catch {
      setRecovery((prev) => ({
        ...prev,
        error: "Não foi possível copiar. Use o botão do WhatsApp.",
      }));
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
    <div className="bg-surface border border-zinc-800 rounded-2xl p-4 transition-all space-y-3.5 shadow-sm">
      {/* Cabeçalho do Card */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-10 w-10 rounded-full bg-elevated border border-zinc-700 flex items-center justify-center text-sm font-semibold text-white shrink-0">
            {member.avatar_url ? (
              <img
                src={member.avatar_url}
                alt=""
                className="h-full w-full object-cover rounded-full"
              />
            ) : (
              member.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate leading-tight">
              {member.name}
            </p>
            <p className="text-zinc-500 text-xs truncate mt-0.5">{member.phone}</p>
          </div>
        </div>

        {isChief ? (
          <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold text-accent-light shrink-0">
            <ShieldCheck size={12} /> Chefe
          </span>
        ) : (
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={isPending}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors shrink-0 touch-manipulation ${
              memberState.active
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-500 border border-zinc-700/60"
            }`}
          >
            {memberState.active ? <UserCheck size={12} /> : <UserX size={12} />}
            {memberState.active ? "Ativo" : "Inativo"}
          </button>
        )}
      </div>

      {/* Botão de Destaque: Ver Caixa do Profissional */}
      <button
        type="button"
        onClick={() => setCashSheetOpen(true)}
        className="w-full flex items-center justify-between bg-gradient-to-r from-accent/20 to-accent/5 hover:from-accent/25 hover:to-accent/10 border border-accent/30 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-white active:scale-[0.99] transition-all touch-manipulation"
      >
        <span className="flex items-center gap-2">
          <Wallet size={15} className="text-accent-light" />
          <span>Ver Caixa do Profissional</span>
        </span>
        <div className="flex items-center gap-1.5 text-accent-light text-[11px]">
          <span>Cortes & Faturamento</span>
          <ChevronRight size={14} />
        </div>
      </button>

      {/* Grade de Ferramentas Rápidas do Colaborador */}
      <div className="grid grid-cols-3 gap-2">
        {/* Expediente & Escala Individual */}
        <button
          type="button"
          onClick={() => setScheduleSheetOpen(true)}
          className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-elevated/70 border border-zinc-800 hover:border-zinc-700 active:scale-95 transition-all touch-manipulation"
        >
          <Clock size={16} className="text-zinc-400 mb-1" />
          <span className="text-[11px] font-medium text-white text-center leading-tight">
            Expediente
          </span>
          <span className="text-[9.5px] text-zinc-500 mt-0.5">Escala</span>
        </button>

        {/* Especialidades & Serviços */}
        <button
          type="button"
          onClick={() => setSpecialtiesSheetOpen(true)}
          className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-elevated/70 border border-zinc-800 hover:border-zinc-700 active:scale-95 transition-all touch-manipulation"
        >
          <Scissors size={16} className="text-zinc-400 mb-1" />
          <span className="text-[11px] font-medium text-white text-center leading-tight">
            Serviços
          </span>
          <span className="text-[9.5px] text-zinc-500 mt-0.5">Catálogo</span>
        </button>

        {/* Bloqueios & Folgas */}
        <button
          type="button"
          onClick={() => setExceptionsSheetOpen(true)}
          className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-elevated/70 border border-zinc-800 hover:border-zinc-700 active:scale-95 transition-all touch-manipulation"
        >
          <CalendarOff size={16} className="text-zinc-400 mb-1" />
          <span className="text-[11px] font-medium text-white text-center leading-tight">
            Folgas
          </span>
          <span className="text-[9.5px] text-zinc-500 mt-0.5">Bloqueios</span>
        </button>
      </div>

      {!isChief && (
        <>
          {/* Seção de Comissões Avançadas (Número Inteiro) */}
          <div className="bg-elevated/50 border border-zinc-800/80 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-xs font-semibold flex items-center gap-1.5">
                <Percent size={13} className="text-accent-light" />
                Regras de Comissão
              </span>
              {commissionSaving && (
                <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <Loader2 size={10} className="animate-spin" /> Salvando…
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {/* Comissão sobre Serviços */}
              <div className="bg-surface border border-zinc-800 rounded-lg p-2.5">
                <label className="block text-[11px] text-zinc-400 font-medium mb-1">
                  Em Serviços
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={serviceCommissionDraft}
                    onChange={(e) => setServiceCommissionDraft(e.target.value)}
                    onBlur={handleCommissionsBlur}
                    placeholder="50"
                    className="w-full h-9 rounded bg-elevated border border-zinc-700 px-2 text-base font-bold text-white text-right focus:outline-none focus:ring-1 focus:ring-accent touch-manipulation"
                  />
                  <span className="text-zinc-400 text-xs font-bold">%</span>
                </div>
              </div>

              {/* Comissão sobre Produtos / Vendas */}
              <div className="bg-surface border border-zinc-800 rounded-lg p-2.5">
                <label className="block text-[11px] text-zinc-400 font-medium mb-1 flex items-center gap-1">
                  <ShoppingBag size={11} className="text-zinc-500" />
                  Em Produtos
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={productCommissionDraft}
                    onChange={(e) => setProductCommissionDraft(e.target.value)}
                    onBlur={handleCommissionsBlur}
                    placeholder="10"
                    className="w-full h-9 rounded bg-elevated border border-zinc-700 px-2 text-base font-bold text-white text-right focus:outline-none focus:ring-1 focus:ring-accent touch-manipulation"
                  />
                  <span className="text-zinc-400 text-xs font-bold">%</span>
                </div>
              </div>
            </div>
            <p className="text-[10.5px] text-zinc-500">
              Valores inteiros (ex: 50 = 50%, 30 = 30%). Salvo automaticamente ao sair do campo.
            </p>
          </div>

          {/* Acordeão de Permissões de Acesso */}
          <div className="border-t border-zinc-800/80 pt-2.5">
            <button
              type="button"
              onClick={() => setShowPermissions(!showPermissions)}
              className="w-full flex items-center justify-between py-1 text-xs text-zinc-400 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Sliders size={13} className="text-zinc-500" />
                Permissões no Sistema
              </span>
              <span className="text-[11px] text-zinc-500">
                {showPermissions ? "Ocultar" : "Ajustar"}
              </span>
            </button>

            {showPermissions && (
              <div className="mt-2.5 space-y-2 bg-surface/40 border border-zinc-800/60 rounded-xl p-3">
                {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <span className="text-zinc-300 text-xs">{label}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!memberState.permissions?.[key]}
                      onClick={() =>
                        handleToggle(key, !memberState.permissions?.[key])
                      }
                      disabled={isPending}
                      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors touch-manipulation ${
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
            )}
          </div>

          {/* Link de Recuperação de Senha */}
          <div className="border-t border-zinc-800/80 pt-2.5">
            <button
              type="button"
              onClick={handleRecoveryLink}
              disabled={recovery.loading}
              className="flex items-center gap-1.5 text-zinc-400 text-xs font-medium hover:text-white transition-colors disabled:opacity-50"
            >
              {recovery.loading ? (
                <Loader2 size={13} className="animate-spin text-accent" />
              ) : (
                <KeyRound size={13} className="text-zinc-500" />
              )}
              {recovery.loading
                ? "Gerando link de acesso…"
                : "Gerar link de recuperação de senha"}
            </button>

            {recovery.error && (
              <p role="alert" className="text-accent-light text-[11px] mt-2">
                {recovery.error}
              </p>
            )}

            {recovery.link && (
              <div className="mt-2.5 flex items-center gap-2">
                <a
                  href={`https://wa.me/${whatsappNumber(recovery.link.phone)}?text=${encodeURIComponent(
                    `Olá, ${recovery.link.name}! Use este link para definir sua nova senha do painel da barbearia: ${recovery.link.url}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white active:bg-accent-dark"
                >
                  <MessageCircle size={13} /> Enviar no WhatsApp
                </a>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-700 px-3 py-1.5 text-[11px] font-medium text-zinc-300 hover:text-white"
                >
                  <Copy size={13} /> {recovery.copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            )}
          </div>

          {/* Remover da equipe */}
          <div className="border-t border-zinc-800/80 pt-2 flex justify-end">
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center gap-1.5 text-red-400 text-xs font-medium hover:opacity-80 transition-opacity"
            >
              <Trash2 size={13} /> Remover da equipe
            </button>
          </div>
        </>
      )}

      {/* Modais Integrados */}
      <TeamMemberCashSheet
        open={cashSheetOpen}
        onClose={() => setCashSheetOpen(false)}
        member={memberState}
      />

      <TeamMemberScheduleSheet
        open={scheduleSheetOpen}
        onClose={() => setScheduleSheetOpen(false)}
        member={memberState}
      />

      <TeamMemberSpecialtiesSheet
        open={specialtiesSheetOpen}
        onClose={() => setSpecialtiesSheetOpen(false)}
        member={memberState}
      />

      <TeamMemberExceptionsSheet
        open={exceptionsSheetOpen}
        onClose={() => setExceptionsSheetOpen(false)}
        member={memberState}
      />
    </div>
  );
}
