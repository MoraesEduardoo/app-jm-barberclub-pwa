"use client";

import { useState } from "react";
import { Lock, Eye, EyeOff, Loader2, Check } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { updatePasswordAction } from "@/lib/actions/password";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { toast } from "@/lib/toast";

export default function ChangePasswordSheet({ open, onClose }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError(`A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const res = await updatePasswordAction(password, confirm);
      if (res?.ok) {
        toast.success("Senha alterada com sucesso!");
        setPassword("");
        setConfirm("");
        onClose();
      } else {
        setError(res?.error || "Não foi possível alterar a senha. Tente novamente.");
      }
    } catch {
      setError("Erro ao se comunicar com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Alterar minha senha">
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        <p className="text-zinc-400 text-xs leading-relaxed">
          Defina sua nova senha de acesso ao painel do barbeiro. Ela entrará em vigor imediatamente.
        </p>

        <div>
          <label className="block text-zinc-400 text-xs font-medium mb-1.5">
            Nova senha
          </label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
              disabled={loading}
              className="w-full h-11 rounded-xl bg-elevated border border-zinc-700/80 pl-9 pr-10 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent touch-manipulation"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-zinc-400 text-xs font-medium mb-1.5">
            Confirmar nova senha
          </label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repita a nova senha"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-elevated border border-zinc-700/80 pl-9 pr-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent touch-manipulation"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 text-xs">
            {error}
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-accent hover:bg-accent-light text-white font-semibold text-sm shadow-lg shadow-accent/20 active:scale-[0.98] disabled:opacity-50 transition-all flex items-center justify-center gap-2 touch-manipulation"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Salvando…
              </>
            ) : (
              <>
                <Check size={16} /> Salvar nova senha
              </>
            )}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
