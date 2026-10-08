"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Phone, Lock, ShieldAlert } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { phoneDigits, phoneToAuthEmail } from "@/lib/auth-identity";

export default function LoginScreen({ onSuccess }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (phoneDigits(phone).length < 10) {
      setError("Digite um telefone válido, com DDD.");
      return;
    }
    if (password.length < 6) {
      setError("A senha tem no mínimo 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: phoneToAuthEmail(phone),
        password,
      });

      if (signInError) {
        // mensagem genérica de propósito: não revela se o número existe
        setError("Telefone ou senha incorretos.");
        return;
      }

      // Cookie de sessão já gravado. Navegação completa para o middleware/servidor
      // enxergarem a sessão logo no primeiro pedido.
      onSuccess?.();
    } catch {
      setError(
        "Não foi possível conectar. Verifique sua internet e tente de novo.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-8">
      <div className="h-14 w-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
        <ShieldAlert className="text-accent-light" size={26} />
      </div>

      <div className="text-center">
        <h1 className="text-white font-semibold text-lg">Painel do Barbeiro</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Entre com o seu telefone e a sua senha.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs">
        <div className="relative mb-3">
          <Phone
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="tel"
            inputMode="tel"
            autoComplete="username"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(83) 9 9999-9999"
            className="w-full h-12 rounded-lg bg-elevated border border-zinc-700 pl-9 pr-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent touch-manipulation"
          />
        </div>

        <div className="relative mb-3">
          <Lock
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
            className="w-full h-12 rounded-lg bg-elevated border border-zinc-700 pl-9 pr-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent touch-manipulation"
          />
        </div>

        {error && (
          <p className="text-accent-light text-xs mb-3 text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-12 rounded-lg bg-accent text-white font-semibold text-sm shadow-accent-glow active:bg-accent-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Entrando…
            </>
          ) : (
            "Entrar no painel"
          )}
        </button>

        <div className="mt-6 text-center">
          <Link
            href="/recuperar-senha"
            className="text-sm text-zinc-500 hover:text-white transition-colors"
          >
            Esqueci a minha senha
          </Link>
        </div>
      </form>
    </div>
  );
}
