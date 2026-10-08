"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, KeyRound, Copy, Check, Lock } from "lucide-react";
import BottomSheet from "./BottomSheet";
import { generateRecoveryCodes, getRecoveryCodesStatus } from "@/lib/actions/recovery-codes";

const TIMEOUT_MS = 20000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Gera/mostra os códigos de recuperação do barbeiro logado (exibidos uma única vez). */
export default function RecoveryCodesSheet({ open, onClose }) {
  const [remaining, setRemaining] = useState(null);
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lockRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setCodes(null);
    setSaved(false);
    setCopied(false);
    setError("");
    setRemaining(null);
    let active = true;
    getRecoveryCodesStatus()
      .then((res) => {
        if (!active) return;
        if (res?.error === "AUTH_EXPIRED") return window.location.assign("/login");
        setRemaining(res?.remaining ?? 0);
      })
      .catch(() => active && setRemaining(0));
    return () => {
      active = false;
    };
  }, [open]);

  async function handleGenerate(e) {
    e.preventDefault();
    if (lockRef.current) return;
    setError("");
    if (!password) return setError("Digite a sua senha atual.");

    lockRef.current = true;
    setLoading(true);
    try {
      const res = await withTimeout(generateRecoveryCodes(password), TIMEOUT_MS);
      if (res?.error === "AUTH_EXPIRED") return window.location.assign("/login");
      if (res?.error) return setError(res.error);
      setCodes(res.codes);
      setRemaining(res.codes.length);
      setPassword("");
    } catch (err) {
      setError(
        err?.message === "TIMEOUT"
          ? "A conexão demorou demais. Tente novamente."
          : "Não foi possível conectar. Tente novamente.",
      );
    } finally {
      lockRef.current = false;
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setError("Não foi possível copiar. Anote os códigos manualmente.");
    }
  }

  function handleClose() {
    setCodes(null); // os códigos somem da memória ao fechar
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={codes && !saved ? () => {} : handleClose} title="Códigos de recuperação">
      {codes ? (
        <div>
          <p className="text-zinc-400 text-xs mb-3">
            Guarde estes códigos em um lugar seguro (anotados ou em um gerenciador de senhas). Eles aparecem{" "}
            <strong className="text-white">só agora</strong>. Cada um funciona uma única vez.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {codes.map((c) => (
              <code
                key={c}
                className="rounded-lg bg-elevated border border-zinc-800 px-2 py-2 text-center text-sm font-mono tracking-wider text-white"
              >
                {c}
              </code>
            ))}
          </div>
          {error && <p role="alert" className="text-accent-light text-xs mb-2 text-center">{error}</p>}
          <button
            onClick={handleCopy}
            className="w-full h-11 rounded-lg border border-zinc-700 text-zinc-200 text-sm font-medium flex items-center justify-center gap-2 mb-2"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copiados" : "Copiar todos"}
          </button>
          <label className="flex items-center gap-2 text-xs text-zinc-300 mb-3">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="accent-red-600" />
            Já guardei os códigos
          </label>
          <button
            onClick={handleClose}
            disabled={!saved}
            className="w-full h-12 rounded-lg bg-accent text-white font-semibold text-sm shadow-accent-glow disabled:opacity-40 active:bg-accent-dark"
          >
            Concluir
          </button>
        </div>
      ) : (
        <form onSubmit={handleGenerate}>
          <div className="flex items-start gap-2 mb-3">
            <KeyRound size={16} className="mt-0.5 shrink-0 text-accent-light" />
            <p className="text-zinc-400 text-xs">
              Com esses códigos você redefine a sua senha sozinho, direto na tela de login, sem precisar do chefe.
              {remaining !== null && (
                <>
                  {" "}
                  Você tem <strong className="text-white">{remaining}</strong> código{remaining === 1 ? "" : "s"} válido
                  {remaining === 1 ? "" : "s"}.
                </>
              )}
            </p>
          </div>
          <p className="text-zinc-500 text-xs mb-3">Gerar novos códigos invalida os anteriores.</p>

          <div className="relative mb-3">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Confirme a sua senha atual"
              disabled={loading}
              className="w-full h-12 rounded-lg bg-elevated border border-zinc-700 pl-9 pr-3 text-base text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent touch-manipulation"
            />
          </div>

          {error && <p role="alert" className="text-accent-light text-xs mb-3 text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-lg bg-accent text-white font-semibold text-sm shadow-accent-glow disabled:opacity-50 active:bg-accent-dark flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Gerando…
              </>
            ) : (
              "Gerar novos códigos"
            )}
          </button>
        </form>
      )}
    </BottomSheet>
  );
}
