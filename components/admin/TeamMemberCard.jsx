"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  Lock,
  Check,
} from "lucide-react";
import {
  updateTeamMemberRole,
  toggleTeamMemberActive,
  removeTeamMember,
  updateTeamMemberAdvancedCommissions,
} from "@/lib/actions/team";
import { createRecoveryLink } from "@/lib/actions/recovery";
import { useBarber } from "@/lib/barber-context";
import { toast } from "@/lib/toast";
import TeamMemberCashSheet from "./TeamMemberCashSheet";
import TeamMemberScheduleSheet from "./TeamMemberScheduleSheet";
import TeamMemberSpecialtiesSheet from "./TeamMemberSpecialtiesSheet";
import TeamMemberExceptionsSheet from "./TeamMemberExceptionsSheet";

function whatsappNumber(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length <= 11 ? `55${digits}` : digits;
}

/**
 * TeamMemberCard:
 * Card profissional de gerenciamento do colaborador.
 * Suporta:
 * 1. Cargos simplificados (Chefe vs Gerente vs Barbeiro)
 * 2. Comissões em número inteiro (ex: 50 para 50%, 10 para 10%) com proteção RBAC (exclusivo Chefe / Admin)
 * 3. Regras avançadas de comissão (serviços vs produtos)
 * 4. Gestão de expediente individual por colaborador (dias, horas, almoço)
 * 5. Especialidades e catálogo de serviços habilitados
 * 6. Histórico de caixa e faturamento acumulado
 * 7. Bloqueios de agenda e folgas pontuais
 */
export default function TeamMemberCard({ member, onChanged, onUpdated }) {
  const { barber: loggedBarber, isChefe, refreshTeam } = useBarber();
  const canEditCommissions = Boolean(isChefe && loggedBarber?.role === "admin");

  const [isPending, startTransition] = useTransition();
  const recoveryLock = useRef(false);
  const commissionSaveLock = useRef(false);
  const [recovery, setRecovery] = useState({ loading: false, error: "", link: null, copied: false });
  const [memberState, setMemberState] = useState(member);

  const isChief = memberState.role === "admin";

  // Estados para comissões em números inteiros (ex: 50 para 50%, 10 para 10%)
  const [serviceCommissionDraft, setServiceCommissionDraft] = useState(
    String(member.commission_percent ?? 50)
  );
  const [productCommissionDraft, setProductCommissionDraft] = useState(
    String(
      member.product_commission_percent ??
        member.permissions?.product_commission_percent ??
        10
    )
  );
  const [commissionSaving, setCommissionSaving] = useState(false);

  // Sincroniza o estado local se a prop member atualizar após re-fetch
  useEffect(() => {
    setMemberState(member);
    setServiceCommissionDraft(String(member.commission_percent ?? 50));
    setProductCommissionDraft(
      String(
        member.product_commission_percent ??
          member.permissions?.product_commission_percent ??
          10
      )
    );
  }, [
    member.id,
    member.role,
    member.active,
    member.commission_percent,
    member.product_commission_percent,
    member.permissions?.product_commission_percent,
  ]);

  // Modais de gestão avançada do colaborador
  const [cashSheetOpen, setCashSheetOpen] = useState(false);
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [specialtiesSheetOpen, setSpecialtiesSheetOpen] = useState(false);
  const [exceptionsSheetOpen, setExceptionsSheetOpen] = useState(false);

  // Controle de salvamento do cargo
  const [roleSaving, setRoleSaving] = useState(false);

  const curServiceComm = Number(memberState.commission_percent ?? 50);
  const curProductComm = Number(
    memberState.product_commission_percent ??
      memberState.permissions?.product_commission_percent ??
      10
  );

  const draftServicePreview =
    serviceCommissionDraft.trim() === ""
      ? curServiceComm
      : Math.min(100, Math.max(0, Math.round(Number(serviceCommissionDraft) || 0)));
  const draftProductPreview =
    productCommissionDraft.trim() === ""
      ? curProductComm
      : Math.min(100, Math.max(0, Math.round(Number(productCommissionDraft) || 0)));
  const isCommissionDirty =
    draftServicePreview !== curServiceComm || draftProductPreview !== curProductComm;

  function handleRoleChange(newRole) {
    if (!canEditCommissions) {
      toast.error("Apenas o Chefe / Admin pode alterar cargos da equipe.");
      return;
    }
    if (memberState.role === newRole) return;
    const prevRole = memberState.role;
    setMemberState((prev) => ({ ...prev, role: newRole }));
    setRoleSaving(true);

    startTransition(async () => {
      try {
        await updateTeamMemberRole(member.id, newRole);
        const roleName =
          newRole === "admin" ? "Chefe" : newRole === "manager" ? "Gerente" : "Barbeiro";
        toast.success(`Cargo de ${member.name} alterado para ${roleName}.`);
        if (refreshTeam) refreshTeam();
        if (onUpdated) onUpdated();
      } catch (err) {
        toast.error(err.message || "Erro ao alterar cargo.");
        setMemberState((prev) => ({ ...prev, role: prevRole }));
      } finally {
        setRoleSaving(false);
      }
    });
  }

  async function handleSaveCommissions({ force = false } = {}) {
    if (!canEditCommissions) {
      setServiceCommissionDraft(String(curServiceComm));
      setProductCommissionDraft(String(curProductComm));
      toast.error("Apenas o Chefe / Admin tem permissão para alterar as comissões.");
      return;
    }

    if (commissionSaveLock.current) return;

    const rawS = serviceCommissionDraft.trim();
    const rawP = productCommissionDraft.trim();
    const parsedS = rawS === "" ? curServiceComm : Number(rawS);
    const parsedP = rawP === "" ? curProductComm : Number(rawP);

    const sValue = Math.min(
      100,
      Math.max(0, Math.round(Number.isFinite(parsedS) ? parsedS : curServiceComm))
    );
    const pValue = Math.min(
      100,
      Math.max(0, Math.round(Number.isFinite(parsedP) ? parsedP : curProductComm))
    );

    setServiceCommissionDraft(String(sValue));
    setProductCommissionDraft(String(pValue));

    if (!force && sValue === curServiceComm && pValue === curProductComm) return;

    commissionSaveLock.current = true;
    setCommissionSaving(true);
    try {
      const res = await updateTeamMemberAdvancedCommissions(member.id, {
        servicesPercent: sValue,
        productsPercent: pValue,
      });

      if (res?.error) {
        throw new Error(res.error);
      }

      const savedS = res?.commission_percent ?? sValue;
      const savedP = res?.product_commission_percent ?? pValue;

      setMemberState((prev) => ({
        ...prev,
        commission_percent: savedS,
        product_commission_percent: savedP,
        permissions: {
          ...(prev.permissions || {}),
          service_commission_percent: savedS,
          product_commission_percent: savedP,
        },
      }));
      setServiceCommissionDraft(String(savedS));
      setProductCommissionDraft(String(savedP));

      toast.success(
        `Comissões de ${member.name} salvas (${savedS}% serviços / ${savedP}% produtos).`
      );
      if (refreshTeam) refreshTeam();
      if (onUpdated) onUpdated();
    } catch (err) {
      console.error("Erro ao salvar comissões:", err);
      toast.error(err?.message || "Não foi possível salvar as comissões.");
      setServiceCommissionDraft(String(curServiceComm));
      setProductCommissionDraft(String(curProductComm));
    } finally {
      commissionSaveLock.current = false;
      setCommissionSaving(false);
    }
  }

  function handleCommissionsBlur() {
    if (!canEditCommissions) return;
    handleSaveCommissions({ force: false });
  }

  function handleCommissionKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!canEditCommissions) return;
      handleSaveCommissions({ force: true });
    }
  }

  function handleToggleActive() {
    if (!canEditCommissions) {
      toast.error("Apenas o Chefe / Admin pode ativar ou desativar membros da equipe.");
      return;
    }
    const nextActive = !memberState.active;
    const previousActive = memberState.active;

    setMemberState((prev) => ({ ...prev, active: nextActive }));

    startTransition(async () => {
      try {
        await toggleTeamMemberActive(member.id, nextActive);
        if (refreshTeam) refreshTeam();
      } catch (error) {
        console.error(error);
        toast.error(error?.message || "Erro ao alterar status do profissional.");
        setMemberState((prev) => ({ ...prev, active: previousActive }));
      }
    });
  }

  async function handleRecoveryLink() {
    if (!canEditCommissions) return;
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
    if (!canEditCommissions) return;
    if (!confirm(`Remover ${member.name} da equipe?`)) return;
    try {
      await removeTeamMember(member.id);
      toast.success(`${member.name} foi removido da equipe.`);
      if (refreshTeam) refreshTeam();
      if (onChanged) onChanged(member.id);
    } catch (error) {
      console.error(error);
      toast.error(error?.message || "Erro ao remover colaborador.");
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

        {memberState.role === "admin" ? (
          <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-300 shrink-0">
            <ShieldCheck size={12} /> Chefe
          </span>
        ) : memberState.role === "manager" ? (
          <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400 shrink-0">
            <ShieldCheck size={12} /> Gerente
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
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-400 text-xs font-semibold flex items-center gap-1.5">
                <Percent size={13} className="text-accent-light" />
                Regras de Comissão
              </span>
              {commissionSaving ? (
                <span className="flex items-center gap-1 text-[10px] text-accent-light font-medium">
                  <Loader2 size={10} className="animate-spin" /> Salvando…
                </span>
              ) : canEditCommissions ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSaveCommissions({ force: true })}
                  disabled={commissionSaving}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold transition-all touch-manipulation select-none ${
                    isCommissionDirty
                      ? "bg-accent text-white shadow-sm active:scale-95"
                      : "bg-zinc-800/90 text-zinc-300 border border-zinc-700/80 hover:text-white active:scale-95"
                  }`}
                >
                  <Check size={11} />
                  <span>{isCommissionDirty ? "Salvar alterações" : "Salvar"}</span>
                </button>
              ) : (
                <span className="flex items-center gap-1 rounded-full border border-zinc-700/80 bg-zinc-900/90 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                  <Lock size={10} className="text-zinc-500" /> Somente Chefe
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {/* Comissão sobre Serviços */}
              <div className="bg-surface border border-zinc-800 rounded-lg p-2.5">
                <label className="block text-[11px] text-zinc-400 font-medium mb-1 flex items-center justify-between">
                  <span>Em Serviços</span>
                  {!canEditCommissions && <Lock size={10} className="text-zinc-600" />}
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    readOnly={!canEditCommissions}
                    disabled={!canEditCommissions || commissionSaving}
                    value={serviceCommissionDraft}
                    onChange={(e) => {
                      if (canEditCommissions) setServiceCommissionDraft(e.target.value);
                    }}
                    onBlur={handleCommissionsBlur}
                    onKeyDown={handleCommissionKeyDown}
                    placeholder="50"
                    className={`w-full h-9 rounded bg-elevated border border-zinc-700 px-2 text-base font-bold text-white text-right focus:outline-none focus:ring-1 focus:ring-accent touch-manipulation ${
                      !canEditCommissions ? "opacity-65 cursor-not-allowed select-none" : ""
                    }`}
                  />
                  <span className="text-zinc-400 text-xs font-bold">%</span>
                </div>
              </div>

              {/* Comissão sobre Produtos / Vendas */}
              <div className="bg-surface border border-zinc-800 rounded-lg p-2.5">
                <label className="block text-[11px] text-zinc-400 font-medium mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <ShoppingBag size={11} className="text-zinc-500" />
                    Em Produtos
                  </span>
                  {!canEditCommissions && <Lock size={10} className="text-zinc-600" />}
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    readOnly={!canEditCommissions}
                    disabled={!canEditCommissions || commissionSaving}
                    value={productCommissionDraft}
                    onChange={(e) => {
                      if (canEditCommissions) setProductCommissionDraft(e.target.value);
                    }}
                    onBlur={handleCommissionsBlur}
                    onKeyDown={handleCommissionKeyDown}
                    placeholder="10"
                    className={`w-full h-9 rounded bg-elevated border border-zinc-700 px-2 text-base font-bold text-white text-right focus:outline-none focus:ring-1 focus:ring-accent touch-manipulation ${
                      !canEditCommissions ? "opacity-65 cursor-not-allowed select-none" : ""
                    }`}
                  />
                  <span className="text-zinc-400 text-xs font-bold">%</span>
                </div>
              </div>
            </div>
            <p className="text-[10.5px] text-zinc-500">
              {canEditCommissions
                ? "Valores inteiros (ex: 50 = 50%, 10 = 10%). Salvo ao sair do campo ou clicar em Salvar."
                : "Campos protegidos: apenas o Chefe / Admin pode alterar as percentagens de comissão."}
            </p>
          </div>

          {/* Seletor Simplificado de Cargos: Chefe vs Gerente vs Barbeiro */}
          <div className="border-t border-zinc-800/80 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-accent" />
                Cargo e Nível de Acesso
              </span>
              {roleSaving ? (
                <span className="text-[10px] text-accent flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" /> Salvando…
                </span>
              ) : !canEditCommissions ? (
                <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <Lock size={10} /> Somente Chefe
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                disabled={!canEditCommissions || isPending || roleSaving}
                onClick={() => handleRoleChange('barber')}
                className={`p-2.5 rounded-xl border text-left transition-all touch-manipulation ${
                  memberState.role === 'barber'
                    ? 'bg-zinc-800/90 border-zinc-500 text-white shadow-sm ring-1 ring-zinc-500/40'
                    : 'bg-surface/50 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                } ${!canEditCommissions ? 'opacity-65 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs text-zinc-200">
                  <span>✂️ Barbeiro</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1 leading-tight">
                  Agenda própria, comissões e caixa individual.
                </p>
              </button>

              <button
                type="button"
                disabled={!canEditCommissions || isPending || roleSaving}
                onClick={() => handleRoleChange('manager')}
                className={`p-2.5 rounded-xl border text-left transition-all touch-manipulation ${
                  memberState.role === 'manager'
                    ? 'bg-emerald-500/15 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500/40'
                    : 'bg-surface/50 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                } ${!canEditCommissions ? 'opacity-65 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-400">
                  <span>👔 Gerente</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1 leading-tight">
                  Visão da agenda de toda a equipe e caixa individual.
                </p>
              </button>

              <button
                type="button"
                disabled={!canEditCommissions || isPending || roleSaving}
                onClick={() => handleRoleChange('admin')}
                className={`p-2.5 rounded-xl border text-left transition-all touch-manipulation ${
                  memberState.role === 'admin'
                    ? 'bg-amber-500/15 border-amber-500 text-white shadow-sm ring-1 ring-amber-500/40'
                    : 'bg-surface/50 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                } ${!canEditCommissions ? 'opacity-65 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
                  <span>👑 Chefe / Admin</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1 leading-tight">
                  Acesso total: faturamento global, edição de preços e equipe.
                </p>
              </button>
            </div>
          </div>

          {canEditCommissions && (
            <>
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
