"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Phone, Lock, Eye, EyeOff, KeyRound, Hash } from "lucide-react";
import { resetPasswordWithRecoveryCode } from "@/lib/actions/forgot-password";
import { phoneDigits } from "@/lib/auth-identity";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password-policy";

const TIMEOUT_MS = 20000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// "abcdefghjk" -> "ABCDE-FGHJK" enquanto digita.
function formatCodeInput(raw) {
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v;
}

const INPUT =
  "w-full h-12 rounded-lg bg-elevated border border-zinc-700 pl-9 pr-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:opacity-60 touch-manipulation";

export default function ForgotPasswordForm({ initialError = "" }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | success
  const [error, setError] = useState(initialError);
  const lockRef = useRef(false); // bloqueia toque duplo antes do re-render

  async function handleSubmit(e) {
    e.preventDefault();
    if (lockRef.current) return;
    setError("");

    if (phoneDigits(phone).length < 10) return setError("Digite um telefone válido, com DDD.");
    if (code.replace(/-/g, "").length !== 10) return setError("O código tem 10 caracteres (ex.: ABCDE-FGHJK).");
    const passwordError = validateNewPassword(password, confirm);
    if (passwordError) return setError(passwordError);

    lockRef.current = true;
    setStatus("loading");
    try {
      const res = await withTimeout(resetPasswordWithRecoveryCode({ phone, code, password, confirm }), TIMEOUT_MS);

      if (res?.ok) {
        setStatus("success");
        // navegação completa: o servidor já recebe os cookies da sessão nova
        window.location.assign(res.signedIn ? "/admin/agenda" : "/login");
        return; // mantém o lock: a página está saindo
      }
      setError(res?.error || "Não foi possível redefinir a senha. Tente novamente.");
    } catch (err) {
      setError(
        err?.message === "TIMEOUT"
          ? "A conexão demorou demais. Tente entrar com a nova senha; se não der, repita o processo."
          : "Não foi possível conectar. Verifique sua internet e tente de novo.",
      );
    }
    setStatus("idle"); // só chega aqui em falha: nunca fica em loading infinito
    lockRef.current = false;
  }

  const busy = status !== "idle";
  const icon = "absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500";

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-8 py-10">
      <div className="h-14 w-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
        <KeyRound className="text-accent-light" size={26} />
      </div>

      <div className="text-center max-w-xs">
        <h1 className="text-white font-semibold text-lg">Esqueci a minha senha</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Use um dos seus códigos de recuperação para criar uma nova senha.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs" noValidate>
        <div className="relative mb-3">
          <Phone size={16} className={icon} />
          <input
            type="tel"
            inputMode="tel"
            autoComplete="username"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(83) 9 9999-9999"
            disabled={busy}
            className={INPUT}
          />
        </div>

        <div className="relative mb-3">
          <Hash size={16} className={icon} />
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(formatCodeInput(e.target.value))}
            placeholder="Código: ABCDE-FGHJK"
            disabled={busy}
            className={`${INPUT} font-mono tracking-wider`}
          />
        </div>

        <div className="relative mb-3">
          <Lock size={16} className={icon} />
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`Nova senha (mín. ${MIN_PASSWORD_LENGTH})`}
            disabled={busy}
            className={`${INPUT} pr-10`}
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
          <Lock size={16} className={icon} />
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
            {error}
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
              {status === "success" ? "Entrando no painel…" : "Redefinindo…"}
            </>
          ) : (
            "Redefinir e entrar"
          )}
        </button>
      </form>

      <div className="max-w-xs text-center space-y-2">
        <p className="text-zinc-600 text-xs">
          Os códigos são gerados no seu perfil, em <span className="text-zinc-400">Códigos de recuperação</span>.
          Ainda não gerou? Peça um link ao chefe.
        </p>
        <Link href="/login" className="text-sm text-zinc-500 hover:text-white transition-colors">
          Voltar para o login
        </Link>
      </div>
    </div>
  );
}
