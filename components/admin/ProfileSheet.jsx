"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  TrendingUp,
  AlertCircle,
  ChevronRight,
  ShieldCheck,
  Users,
  Check,
  KeyRound,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import { todayInShop } from "@/lib/dates";
import EditProfileSheet from "./EditProfileSheet";
import PushNotificationButton from "./PushNotificationButton";
import RecoveryCodesSheet from "./RecoveryCodesSheet";
import { getFinanceSummary } from "@/lib/actions/finance";
import { listTeam } from "@/lib/actions/team";

function formatBRL(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

function todayISO() {
  return todayInShop();
}

/**
 * Aberto ao clicar no avatar no cabeçalho. Mostra os dados do barbeiro
 * logado, resumo financeiro e, se for Chefe, permite alternar a visualização
 * para qualquer membro da equipa (ex: William).
 */
export default function ProfileSheet({
  open,
  onClose,
  barber,
  isChefe,
  onProfileUpdated,
  selectedBarberId,
  onSelectBarber,
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [team, setTeam] = useState([]);

  // Identifica qual ID está sendo visualizado atualmente (o próprio ou o membro selecionado)
  const currentTargetId = selectedBarberId || barber.id;
  const viewingOther = Boolean(selectedBarberId) && selectedBarberId !== barber.id;
  const targetName = team.find((m) => m.id === currentTargetId)?.name;

  useEffect(() => {
    if (open) {
      const today = todayISO();
      setSummary(null);
      getFinanceSummary({
        from: today,
        to: today,
        scopeBarberId: currentTargetId,
      })
        .then(setSummary)
        .catch(() => {});

      if (isChefe) {
        listTeam()
          .then(setTeam)
          .catch(() => {});
      }
    }
  }, [open, currentTargetId, isChefe]);

  return (
    <>
      <BottomSheet
        open={open && !editOpen && !codesOpen}
        onClose={onClose}
        title="Meu perfil"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="h-14 w-14 rounded-full bg-elevated border border-zinc-700 overflow-hidden flex items-center justify-center text-lg font-semibold text-white shrink-0">
            {barber.avatar_url ? (
              <img
                src={barber.avatar_url}
                alt={barber.name}
                className="h-full w-full object-cover"
              />
            ) : (
              barber.name?.charAt(0)?.toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white font-semibold text-base truncate">
              {barber.name}
            </p>
            <p className="text-zinc-500 text-xs">{barber.phone}</p>
            {isChefe && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent-light mt-1">
                <ShieldCheck size={10} /> Chefe
              </span>
            )}
          </div>
          <button
            onClick={() => setEditOpen(true)}
            aria-label="Editar perfil"
            className="h-9 w-9 rounded-full border border-zinc-700 flex items-center justify-center text-zinc-300 active:bg-zinc-900 shrink-0"
          >
            <Pencil size={15} />
          </button>
        </div>

        {/* Seção exclusiva para o Chefe alternar para ver os dados da equipa (ex: William) */}
        {isChefe && team.length > 0 && (
          <div className="mb-5">
            <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Users size={12} /> Ver painel de outro profissional
            </h3>
            <div className="space-y-1.5 bg-surface border border-zinc-800 rounded-xl p-2">
              {team.map((member) => {
                const isSelected = currentTargetId === member.id;
                return (
                  <button
                    key={member.id}
                    onClick={() => {
                      onSelectBarber?.(member.id);
                      onClose();
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      isSelected
                        ? "bg-accent/15 text-accent-light border border-accent/30"
                        : "text-zinc-300 hover:bg-elevated"
                    }`}
                  >
                    <span>
                      {member.name} {member.id === barber.id && "(Você)"}
                    </span>
                    {isSelected && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2">
          Controle financeiro — hoje{viewingOther && targetName ? ` · ${targetName}` : ""}
        </h3>

        {!summary ? (
          <div className="h-20 rounded-xl bg-surface animate-pulse mb-4" />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 mb-2">
            <div className="bg-surface border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium mb-1">
                <TrendingUp size={12} /> Faturado
              </div>
              <p className="text-white font-bold text-base">
                {formatBRL(summary.totalFaturado)}
              </p>
            </div>
            <div className="bg-surface border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-accent-light text-xs font-medium mb-1">
                <AlertCircle size={12} /> A receber
              </div>
              <p className="text-white font-bold text-base">
                {formatBRL(summary.totalPendente)}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={() => {
            onClose();
            router.push(
              isChefe ? "/admin/financeiro/completo" : "/admin/financeiro",
            );
          }}
          className="w-full flex items-center justify-between bg-elevated border border-zinc-800 rounded-xl px-4 py-3 mt-2"
        >
          <span className="text-white text-sm font-medium">
            Ver financeiro completo
          </span>
          <ChevronRight size={16} className="text-zinc-500" />
        </button>

        <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2 mt-6">
          Segurança
        </h3>
        <button
          onClick={() => setCodesOpen(true)}
          className="w-full flex items-center justify-between bg-elevated border border-zinc-800 rounded-xl px-4 py-3"
        >
          <span className="flex items-center gap-2 text-white text-sm font-medium">
            <KeyRound size={15} className="text-zinc-400" /> Códigos de recuperação
          </span>
          <ChevronRight size={16} className="text-zinc-500" />
        </button>

        <h3 className="text-zinc-500 text-xs font-medium uppercase tracking-wide mb-2 mt-6">
          Notificações no celular
        </h3>
        <p className="text-zinc-500 text-xs mb-2.5">
          Ative para receber um aviso no aparelho assim que um novo agendamento
          entrar — mesmo com o app fechado.
        </p>
        <PushNotificationButton />
      </BottomSheet>

      <RecoveryCodesSheet open={open && codesOpen} onClose={() => setCodesOpen(false)} />

      <EditProfileSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        barber={barber}
        onSaved={(updated) => {
          setEditOpen(false);
          onProfileUpdated(updated);
        }}
      />
    </>
  );
}
