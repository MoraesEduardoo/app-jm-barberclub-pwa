"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Phone, Lock, Eye, EyeOff, KeyRound, ArrowRight, ShieldCheck } from "lucide-react";
import { setupOrResetBarberPasswordAction } from "@/lib/actions/barber-auth";
import { phoneDigits } from "@/lib/auth-identity";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export default function ForgotPasswordForm({ initialError = "" }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (phoneDigits(phone).length < 10) {
      setError("Digite um telefone válido com DDD (mínimo 10 dígitos).");
      return;
    }
    if (password.length < 6) {
      setError(`A nova senha precisa ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const res = await setupOrResetBarberPasswordAction({
        phone,
        password,
        confirm,
      });

      if (!res.ok) {
        setError(res.error || "Não foi possível redefinir a senha. Verifique o número informado.");
        setLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        window.location.assign("/admin/agenda");
      }, 700);
    } catch {
      setError("Erro de comunicação com o servidor. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-6 py-10 selection:bg-accent selection:text-white">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-accent/20 to-surface border border-accent/40 flex items-center justify-center shadow-lg shadow-accent/10">
        <KeyRound className="text-accent-light" size={30} />
      </div>

      <div className="text-center max-w-xs">
        <h1 className="text-white font-bold text-xl tracking-tight">Definir Nova Senha</h1>
        <p className="text-zinc-400 text-xs mt-1.5 leading-relaxed">
          Informe seu telefone cadastrado na barbearia e escolha a sua nova senha de acesso.
        </p>
      </div>

      <div className="w-full max-w-sm bg-surface/90 border border-zinc-800/90 rounded-2xl p-6 shadow-2xl backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">
              Telefone cadastrado
            </label>
            <div className="relative">
              <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(83) 9 9999-9999"
                disabled={loading || success}
                className="w-full h-12 rounded-xl bg-elevated border border-zinc-700/80 pl-10 pr-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all touch-manipulation"
              />
            </div>
          </div>

          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">
              Nova senha
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
                disabled={loading || success}
                className="w-full h-12 rounded-xl bg-elevated border border-zinc-700/80 pl-10 pr-11 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all touch-manipulation"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Ocultar senhas" : "Mostrar senhas"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1"
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
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repita a nova senha"
                disabled={loading || success}
                className="w-full h-12 rounded-xl bg-elevated border border-zinc-700/80 pl-10 pr-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all touch-manipulation"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 text-xs leading-relaxed">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-900/50 text-emerald-300 text-xs leading-relaxed">
              Senha atualizada com sucesso! Entrando no painel…
            </div>
          )}

          <button
            type="submit"
            disabled={loading || success}
            className="w-full h-12 rounded-xl bg-accent hover:bg-accent-light text-white font-semibold text-sm shadow-lg shadow-accent/20 active:scale-[0.98] disabled:opacity-50 transition-all flex items-center justify-center gap-2 touch-manipulation"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Atualizando…
              </>
            ) : (
              <>
                Definir senha e entrar <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="mt-5 text-center">
          <Link
            href="/login"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1"
          >
            Voltar para o login
          </Link>
        </div>
      </div>
    </div>
  );
}
