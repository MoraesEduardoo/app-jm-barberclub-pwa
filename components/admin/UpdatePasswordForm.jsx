"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Lock, Eye, EyeOff, KeyRound } from "lucide-react";
import { updatePasswordAction } from "@/lib/actions/password";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password-policy";

const TIMEOUT_MS = 20000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const INPUT =
  "w-full h-12 rounded-lg bg-elevated border border-zinc-700 pl-9 pr-10 text-base text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent touch-manipulation";

export default function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | success
  const [error, setError] = useState("");
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const lockRef = useRef(false); // bloqueia toque duplo antes do re-render

  async function handleSubmit(e) {
    e.preventDefault();
    if (lockRef.current) return;

    setError("");
    const validationError = validateNewPassword(password, confirm);
    if (validationError) {
      setError(validationError);
      return;
    }

    lockRef.current = true;
    setStatus("loading");
    try {
      const res = await withTimeout(updatePasswordAction(password, confirm), TIMEOUT_MS);

      if (res?.ok) {
        setStatus("success");
        // navegação completa: o servidor recebe os cookies já renovados
        window.location.assign("/admin/agenda");
        return; // mantém o lock: a página está saindo
      }

      if (res?.code === "SESSION_INVALID") setSessionInvalid(true);
      setError(res?.error || "Não foi possível alterar a senha. Tente novamente.");
    } catch (err) {
      setError(
        err?.message === "TIMEOUT"
          ? "A conexão demorou demais. Tente de novo — se já tiver funcionado, entre com a nova senha."
          : "Não foi possível conectar. Verifique sua internet e tente de novo.",
      );
    }
    // só chega aqui em falha: destrava o formulário (sem loading infinito)
    setStatus("idle");
    lockRef.current = false;
  }

  const busy = status !== "idle";

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-8">
      <div className="h-14 w-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
        <KeyRound className="text-accent-light" size={26} />
      </div>

      <div className="text-center">
        <h1 className="text-white font-semibold text-lg">Definir nova senha</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Escolha uma senha com no mínimo {MIN_PASSWORD_LENGTH} caracteres.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs" noValidate>
        <div className="relative mb-3">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nova senha"
            disabled={busy}
            className={INPUT}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Ocultar senhas" : "Mostrar senhas"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <div className="relative mb-3">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirmar nova senha"
            disabled={busy}
            className={INPUT}
          />
        </div>

        {error && (
          <p role="alert" className="text-accent-light text-xs mb-3 text-center">
            {error}{" "}
            {sessionInvalid && (
              <Link href="/recuperar-senha" className="underline">
                Ver como recuperar
              </Link>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full h-12 rounded-lg bg-accent text-white font-semibold text-sm shadow-accent-glow active:bg-accent-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {status === "success" ? "Entrando no painel…" : "Salvando…"}
            </>
          ) : (
            "Salvar nova senha"
          )}
        </button>
      </form>
    </div>
  );
}
