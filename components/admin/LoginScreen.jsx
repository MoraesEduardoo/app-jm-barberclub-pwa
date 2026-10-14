"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Phone, Lock, Eye, EyeOff, ShieldCheck, Sparkles, ArrowRight, KeyRound } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { phoneDigits, phoneToAuthEmail } from "@/lib/auth-identity";
import { setupOrResetBarberPasswordAction, loginWithPhoneAction } from "@/lib/actions/barber-auth";

export default function LoginScreen({ onSuccess }) {
  // Mode: "login" (padrão com telefone + senha) | "first_access" (definir senha direto)
  const [mode, setMode] = useState("login");
  
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  function switchMode(newMode) {
    setMode(newMode);
    setError("");
    setSuccessMsg("");
    setPassword("");
    setConfirmPassword("");
  }

  // Login normal: Telefone + Senha puro (sem e-mail)
  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const clean = phoneDigits(phone);
    if (clean.length < 10) {
      setError("Digite o telefone com DDD (mínimo 10 dígitos).");
      return;
    }
    if (password.length < 6) {
      setError("A senha possui no mínimo 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const res = await loginWithPhoneAction({ phone, password });

      if (!res.ok) {
        setError(res.error || "Telefone ou senha incorretos.");
        setLoading(false);
        return;
      }

      onSuccess ? onSuccess() : window.location.assign("/admin/agenda");
    } catch {
      setError("Falha de conexão. Verifique sua internet e tente novamente.");
      setLoading(false);
    }
  }

  // Primeiro Acesso / Definir Senha Direto (sem códigos)
  async function handleFirstAccess(e) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    const clean = phoneDigits(phone);
    if (clean.length < 10) {
      setError("Digite o seu telefone cadastrado com DDD.");
      return;
    }
    if (password.length < 6) {
      setError("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas digitadas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const res = await setupOrResetBarberPasswordAction({
        phone,
        password,
        confirm: confirmPassword,
      });

      if (!res.ok) {
        setError(res.error || "Não foi possível definir sua senha. Tente novamente.");
        setLoading(false);
        return;
      }

      setSuccessMsg(res.message || "Acesso liberado com sucesso!");

      if (res.signedIn) {
        setTimeout(() => {
          onSuccess ? onSuccess() : window.location.assign("/admin/agenda");
        }, 600);
      } else {
        // Redireciona para o login com a nova senha
        setTimeout(() => {
          switchMode("login");
          setSuccessMsg("Senha configurada! Agora entre com sua senha.");
        }, 1200);
      }
    } catch {
      setError("Falha ao salvar a senha. Verifique sua conexão e tente de novo.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-6 py-10 selection:bg-accent selection:text-white">
      {/* Logo e Ícone */}
      <div className="flex flex-col items-center gap-2">
        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-accent/20 to-surface border border-accent/40 flex items-center justify-center shadow-lg shadow-accent/10">
          <ShieldCheck className="text-accent-light" size={32} />
        </div>
        <h1 className="text-white font-bold text-xl tracking-tight mt-1">JM BARBERCLUB</h1>
        <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">
          Painel Administrativo da Equipe
        </p>
      </div>

      {/* Caixa de Autenticação */}
      <div className="w-full max-w-sm bg-surface/90 border border-zinc-800/90 rounded-2xl p-6 shadow-2xl backdrop-blur-sm">
        {/* Alternador de Modos */}
        <div className="flex p-1 bg-black/50 border border-zinc-800/80 rounded-xl mb-6">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all touch-manipulation ${
              mode === "login"
                ? "bg-accent text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Entrar com Senha
          </button>
          <button
            type="button"
            onClick={() => switchMode("first_access")}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all touch-manipulation flex items-center justify-center gap-1.5 ${
              mode === "first_access"
                ? "bg-accent text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Sparkles size={13} className="text-accent-light" />
            Primeiro Acesso
          </button>
        </div>

        {/* MODO 1: LOGIN NORMAL */}
        {mode === "login" && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">
                Telefone cadastrado
              </label>
              <div className="relative">
                <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="username"
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(83) 9 9999-9999"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-elevated border border-zinc-700/80 pl-10 pr-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all touch-manipulation"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-zinc-400 text-xs font-medium">
                  Senha
                </label>
                <button
                  type="button"
                  onClick={() => switchMode("first_access")}
                  className="text-xs text-accent-light hover:underline font-medium"
                >
                  Esqueci minha senha
                </button>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha de acesso"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-elevated border border-zinc-700/80 pl-10 pr-11 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all touch-manipulation"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 text-xs leading-relaxed">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-900/50 text-emerald-300 text-xs leading-relaxed">
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl bg-accent hover:bg-accent-light text-white font-semibold text-sm shadow-lg shadow-accent/20 active:scale-[0.98] disabled:opacity-50 transition-all flex items-center justify-center gap-2 touch-manipulation"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Entrando no painel…
                </>
              ) : (
                <>
                  Entrar no painel <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        )}

        {/* MODO 2: PRIMEIRO ACESSO / DEFINIR SENHA DIRETO (SEM CÓDIGO) */}
        {mode === "first_access" && (
          <form onSubmit={handleFirstAccess} className="space-y-4">
            <div className="p-3 rounded-xl bg-accent/10 border border-accent/25 text-zinc-300 text-xs leading-relaxed">
              <span className="font-semibold text-accent-light flex items-center gap-1.5 mb-1">
                <Sparkles size={13} /> Ativação Rápida de Acesso
              </span>
              Digite o seu telefone cadastrado na barbearia e escolha uma senha. Você entrará de imediato no painel.
            </div>

            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">
                Seu número de telefone
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
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-elevated border border-zinc-700/80 pl-10 pr-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all touch-manipulation"
                />
              </div>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">
                Defina sua nova senha
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-elevated border border-zinc-700/80 pl-10 pr-11 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all touch-manipulation"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">
                Confirme a sua senha
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a senha"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-elevated border border-zinc-700/80 pl-10 pr-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-all touch-manipulation"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 text-xs leading-relaxed">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-900/50 text-emerald-300 text-xs leading-relaxed">
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl bg-accent hover:bg-accent-light text-white font-semibold text-sm shadow-lg shadow-accent/20 active:scale-[0.98] disabled:opacity-50 transition-all flex items-center justify-center gap-2 touch-manipulation"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Salvando senha…
                </>
              ) : (
                <>
                  Salvar senha e entrar <ArrowRight size={16} />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => switchMode("login")}
              className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors pt-1"
            >
              Já possui senha? Voltar para o login
            </button>
          </form>
        )}
      </div>

      {/* Rodapé institucional */}
      <div className="text-center text-zinc-600 text-xs">
        <p>JM Barberclub · Gestão simplificada para profissionais</p>
      </div>
    </div>
  );
}
