"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2, AlertCircle } from "lucide-react";
import { useBarber } from "@/lib/barber-context";

/**
 * Converte a chave pública VAPID (base64url) para o Uint8Array exigido
 * por PushManager.subscribe (applicationServerKey).
 */
function urlBase64ToUint8Array(base64String) {
  if (!base64String) {
    throw new Error(
      "A chave pública VAPID não está configurada no painel. Defina NEXT_PUBLIC_VAPID_PUBLIC_KEY e publique novamente.",
    );
  }

  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function subscriptionsUseSameVapidKey(subscription, expectedKey) {
  const actualKey = subscription?.options?.applicationServerKey;

  // Alguns navegadores não expõem a chave usada pela inscrição. Neles,
  // preservar a inscrição existente é mais seguro do que cancelá-la sem
  // necessidade; o envio ainda sinalizará qualquer chave VAPID inválida.
  if (!actualKey) return true;

  const actual = new Uint8Array(actualKey);
  if (actual.length !== expectedKey.length) return false;
  return actual.every((value, index) => value === expectedKey[index]);
}

async function getPushServiceWorkerRegistration() {
  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    registration = await navigator.serviceWorker.register("/sw.js");
  }

  if (registration.active) return registration;

  // Sem essa proteção, navigator.serviceWorker.ready pode nunca resolver em
  // desenvolvimento (o next-pwa desabilita /sw.js) e o botão fica preso em
  // "Verificando" para sempre. Em produção, uma instalação lenta ainda tem
  // até 10 segundos para ativar normalmente.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => {
      window.setTimeout(
        () =>
          reject(
            new Error(
              "O Service Worker não ficou pronto. Atualize a página e tente novamente.",
            ),
          ),
        10_000,
      );
    }),
  ]);
}

// idle -> ainda não sabemos o estado | checking -> verificando inscrição
// existente | subscribed -> ativo | unsubscribed -> suportado mas inativo
// | denied -> usuário negou permissão | unsupported -> navegador sem suporte
// | error -> alguma etapa falhou
export default function PushNotificationButton() {
  const { barber } = useBarber();
  const [status, setStatus] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const persistSubscription = useCallback(
    async (subscription) => {
      if (!barber?.id) {
        throw new Error(
          "Não foi possível identificar o barbeiro para salvar a inscrição.",
        );
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
        throw new Error(
          data.error || "Não foi possível salvar a inscrição no servidor.",
        );
      }
    },
    [barber?.id],
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
        const existingSubscription =
          await registration.pushManager.getSubscription();
        if (!active) return;

        // Um navegador pode continuar inscrito mesmo que uma chamada antiga
        // ao backend tenha falhado. Regravamos a inscrição a cada abertura
        // do perfil para manter o banco sincronizado sem pedir permissão de
        // novo e sem depender de o barbeiro tocar novamente no botão.
        if (existingSubscription) {
          const vapidKey = urlBase64ToUint8Array(
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
          );
          if (!subscriptionsUseSameVapidKey(existingSubscription, vapidKey)) {
            if (active) {
              setErrorMessage(
                "A chave de notificações mudou. Toque em ativar para renovar a inscrição.",
              );
              setStatus("error");
            }
            return;
          }

          try {
            await persistSubscription(existingSubscription);
            if (active) setStatus("subscribed");
          } catch (error) {
            console.error(
              "[PushNotificationButton] inscrição local não sincronizada:",
              error,
            );
            if (active) {
              setErrorMessage(
                error.message || "Não foi possível sincronizar a inscrição.",
              );
              setStatus("error");
            }
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
      const vapidKey = urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      );
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "unsubscribed");
        setBusy(false);
        return;
      }

      // Garante que o Service Worker (gerado pelo next-pwa em produção)
      // está registrado antes de pedir a inscrição push.
      const registration = await getPushServiceWorkerRegistration();

      let subscription = await registration.pushManager.getSubscription();

      // Se a chave VAPID foi trocada desde a instalação anterior, o browser
      // não aceita reutilizar a inscrição antiga. Como esta ação veio de um
      // clique explícito do barbeiro, é seguro recriá-la com a chave atual.
      if (
        subscription &&
        !subscriptionsUseSameVapidKey(subscription, vapidKey)
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey,
        });
      }

      await persistSubscription(subscription);

      setStatus("subscribed");
    } catch (err) {
      console.error(
        "[PushNotificationButton] erro ao ativar notificações:",
        err,
      );

      // Alerta direto no ecrã do telemóvel para identificar o erro sem USB
      const errorMsg = err.message || JSON.stringify(err);
      window.alert("ERRO DETALHADO: " + errorMsg);

      setErrorMessage(errorMsg);
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
      console.error(
        "[PushNotificationButton] erro ao desativar notificações:",
        err,
      );
      setErrorMessage(
        err.message || "Não foi possível desativar as notificações.",
      );
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
        Notificações bloqueadas. Libere o acesso nas configurações do navegador
        para ativar.
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
        <p className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle size={12} className="shrink-0" />
          {errorMessage}
        </p>
      )}
    </div>
  );
}
