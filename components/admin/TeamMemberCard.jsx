"use client";

import { ShieldCheck, Trash2, UserX, UserCheck } from "lucide-react";
import { PERMISSION_KEYS } from "@/lib/auth";
import {
  updateTeamMemberPermission,
  toggleTeamMemberActive,
  removeTeamMember,
} from "@/lib/actions/team";

const PERMISSION_LABELS = {
  [PERMISSION_KEYS.MANAGE_SERVICES]: "Editar serviços e preços",
  [PERMISSION_KEYS.MANAGE_SCHEDULE_OTHERS]:
    "Editar expediente de outros barbeiros",
  [PERMISSION_KEYS.VIEW_ALL_APPOINTMENTS]: "Ver agenda de toda a equipe",
  [PERMISSION_KEYS.MANAGE_FINANCE]: "Ver caixa e faturamento completo",
};

export default function TeamMemberCard({ member, onChanged }) {
  const isChief = member.role === "admin";

  async function handleToggle(key, value) {
    await updateTeamMemberPermission(member.id, key, value);
    onChanged();
  }

  async function handleToggleActive() {
    await toggleTeamMemberActive(member.id, !member.active);
    onChanged();
  }

  async function handleRemove() {
    if (!confirm(`Remover ${member.name} da equipe?`)) return;
    await removeTeamMember(member.id);
    onChanged();
  }

  return (
    <div className="bg-surface border border-zinc-800 rounded-xl p-4">
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
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              member.active
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {member.active ? <UserCheck size={11} /> : <UserX size={11} />}
            {member.active ? "Ativo" : "Inativo"}
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
                  aria-checked={member.permissions[key]}
                  onClick={() => handleToggle(key, !member.permissions[key])}
                  className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
                    member.permissions[key] ? "bg-accent" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      member.permissions[key]
                        ? "translate-x-4"
                        : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={handleRemove}
            className="flex items-center gap-1.5 text-accent-light text-xs font-medium mt-3.5"
          >
            <Trash2 size={13} /> Remover da equipe
          </button>
        </>
      )}
    </div>
  );
}
