"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { useBarber } from "@/lib/barber-context";

/**
 * Converte e valida a chave pública VAPID (base64url)
 * para Uint8Array de 65 bytes (P-256).
 */
function urlBase64ToUint8Array(base64String) {
  if (!base64String || typeof base64String !== "string") {
    throw new Error("A chave pública VAPID não foi informada.");
  }

  const cleanKey = base64String.trim().replace(/^["']|["']$/g, "");
  if (!cleanKey) {
    throw new Error("A chave pública VAPID está vazia.");
  }

  const padding = "=".repeat((4 - (cleanKey.length % 4)) % 4);
  const base64 = (cleanKey + padding).replace(/-/g, "+").replace(/_/g, "/");

  let rawData;
  try {
    rawData = window.atob(base64);
  } catch {
    throw new Error("A chave pública VAPID possui codificação base64 inválida.");
  }

  let outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  if (outputArray.length === 64) {
    const prefixed = new Uint8Array(65);
    prefixed[0] = 0x04;
    prefixed.set(outputArray, 1);
    outputArray = prefixed;
  }

  if (outputArray.length !== 65 || outputArray[0] !== 0x04) {
    throw new Error(
      `Chave pública VAPID inválida: esperado ponto P-256 de 65 bytes iniciando em 0x04 (recebido ${outputArray.length} bytes).`
    );
  }

  return outputArray;
}

async function getVapidPublicKeyString() {
  const envKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (envKey && typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim().replace(/^["']|["']$/g, "");
  }

  try {
    const res = await fetch("/api/push/vapid-public-key");
    if (res.ok) {
      const data = await res.json();
      if (data?.publicKey) {
        return data.publicKey.trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch (err) {
    console.warn("[Push] Não foi possível consultar /api/push/vapid-public-key:", err);
  }

  throw new Error("Chave VAPID pública não encontrada. Configure NEXT_PUBLIC_VAPID_PUBLIC_KEY.");
}

function subscriptionsUseSameVapidKey(subscription, expectedKey) {
  const actualKey = subscription?.options?.applicationServerKey;
  if (!actualKey) return true;

  const actual = new Uint8Array(actualKey);
  if (actual.length !== expectedKey.length) return false;
  return actual.every((value, index) => value === expectedKey[index]);
}

async function getPushServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker não suportado.");
  }

  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }

  if (registration.active) return registration;

  try {
    const readyReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => {
        window.setTimeout(
          () => reject(new Error("O Service Worker não ficou pronto a tempo.")),
          8000
        );
      }),
    ]);
    if (readyReg) return readyReg;
  } catch {}

  if (registration.installing || registration.waiting) {
    const worker = registration.installing || registration.waiting;
    await new Promise((resolve) => {
      const stateListener = () => {
        if (worker.state === "activated" || registration.active) {
          worker.removeEventListener("statechange", stateListener);
          resolve();
        }
      };
      worker.addEventListener("statechange", stateListener);
      setTimeout(resolve, 4000);
    });
  }

  return registration;
}

function cleanPushErrorMessage(err) {
  const msg = String(err?.message || err || "");
  const isIOS = typeof window !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    typeof window !== "undefined" &&
    Boolean(window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches);

  if (isIOS && !isStandalone) {
    return "No iPhone, toque em Compartilhar no Safari e 'Adicionar à Tela de Início' para receber notificações.";
  }

  if (/push service error|registration failed/i.test(msg)) {
    return "Falha de comunicação com o serviço Push (Google FCM). Verifique a conexão com a internet, desative bloqueadores ou saia do modo anônimo.";
  }

  if (/permission denied|denied/i.test(msg)) {
    return "Notificações bloqueadas nas configurações do navegador. Libere o acesso para ativar.";
  }

  return msg || "Erro ao ativar notificações.";
}

export default function PushNotificationButton() {
  const { barber } = useBarber();
  const [status, setStatus] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const persistSubscription = useCallback(
    async (subscription) => {
      if (!barber?.id) {
        throw new Error("Não foi possível identificar o barbeiro para salvar a inscrição.");
      }

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          barberId: barber.id,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Não foi possível salvar a inscrição no servidor.");
      }
    },
    [barber?.id]
  );

  useEffect(() => {
    let active = true;

    async function checkSupportAndSubscription() {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (active) setStatus("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (active) setStatus("denied");
        return;
      }

      try {
        const registration = await getPushServiceWorkerRegistration();
        const existingSubscription = await registration?.pushManager?.getSubscription();
        if (!active) return;

        if (existingSubscription) {
          try {
            await persistSubscription(existingSubscription);
            if (active) setStatus("subscribed");
          } catch {
            if (active) setStatus("subscribed");
          }
          return;
        }

        setStatus("unsubscribed");
      } catch {
        if (active) setStatus("unsubscribed");
      }
    }

    checkSupportAndSubscription();
    return () => {
      active = false;
    };
  }, [barber?.id, persistSubscription]);

  async function handleSubscribe() {
    setBusy(true);
    setErrorMessage("");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "unsubscribed");
        setBusy(false);
        return;
      }

      const keyStr = await getVapidPublicKeyString();
      const vapidKey = urlBase64ToUint8Array(keyStr);

      const registration = await getPushServiceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();

      if (subscription && !subscriptionsUseSameVapidKey(subscription, vapidKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }

      if (!subscription) {
        try {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKey,
          });
        } catch (subErr) {
          const isServiceErr =
            subErr.name === "AbortError" ||
            /push service error|registration failed/i.test(subErr.message || "");

          if (isServiceErr) {
            console.warn("[Push] Recuperando de falha no serviço Push...");
            const stale = await registration.pushManager.getSubscription();
            if (stale) await stale.unsubscribe();
            await new Promise((r) => setTimeout(r, 600));

            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: vapidKey,
            });
          } else {
            throw subErr;
          }
        }
      }

      await persistSubscription(subscription);
      setStatus("subscribed");
    } catch (err) {
      console.error("[PushNotificationButton] erro ao ativar notificações:", err);
      setErrorMessage(cleanPushErrorMessage(err));
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setBusy(true);
    setErrorMessage("");

    try {
      const registration = await getPushServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ endpoint, barberId: barber?.id }),
        }).catch(() => {});
      }

      setStatus("unsubscribed");
    } catch (err) {
      console.error("[PushNotificationButton] erro ao desativar notificações:", err);
      setErrorMessage(err.message || "Não foi possível desativar as notificações.");
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  if (status === "unsupported") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-elevated px-3.5 py-3 text-xs text-zinc-500">
        <BellOff size={16} className="shrink-0" />
        Este navegador não suporta notificações push.
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-elevated px-3.5 py-3 text-xs text-zinc-500">
        <AlertCircle size={16} className="shrink-0 text-amber-500" />
        Notificações bloqueadas. Libere o acesso nas configurações do navegador para ativar.
      </div>
    );
  }

  const isSubscribed = status === "subscribed";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={isSubscribed ? handleUnsubscribe : handleSubscribe}
        disabled={busy || status === "checking"}
        className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition disabled:opacity-60 ${
          isSubscribed
            ? "border border-zinc-700 bg-elevated text-zinc-300 active:bg-zinc-900"
            : "bg-accent text-black active:bg-accent-light"
        }`}
      >
        {busy || status === "checking" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : isSubscribed ? (
          <BellRing size={16} />
        ) : (
          <Bell size={16} />
        )}
        {status === "checking"
          ? "Verificando…"
          : isSubscribed
            ? "Notificações ativadas"
            : "Ativar notificações push"}
      </button>

      {status === "error" && errorMessage && (
        <div className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={handleSubscribe}
              className="flex items-center gap-1 text-[11px] font-bold text-red-300 hover:text-white underline"
            >
              <RotateCcw size={11} /> Tentar novamente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
