'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, Loader2, AlertCircle } from 'lucide-react';
import { useBarber } from '@/lib/barber-context';

/**
 * Converte a chave pública VAPID (base64url) para o Uint8Array exigido
 * por PushManager.subscribe (applicationServerKey).
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// idle -> ainda não sabemos o estado | checking -> verificando inscrição
// existente | subscribed -> ativo | unsubscribed -> suportado mas inativo
// | denied -> usuário negou permissão | unsupported -> navegador sem suporte
// | error -> alguma etapa falhou
export default function PushNotificationButton() {
  const { barber } = useBarber();
  const [status, setStatus] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let active = true;

    async function checkSupportAndSubscription() {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (active) setStatus('unsupported');
        return;
      }

      if (Notification.permission === 'denied') {
        if (active) setStatus('denied');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const existingSubscription = await registration.pushManager.getSubscription();
        if (!active) return;
        setStatus(existingSubscription ? 'subscribed' : 'unsubscribed');
      } catch {
        if (active) setStatus('unsubscribed');
      }
    }

    checkSupportAndSubscription();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubscribe() {
    setBusy(true);
    setErrorMessage('');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'unsubscribed');
        setBusy(false);
        return;
      }

      // Garante que o Service Worker (gerado pelo next-pwa em produção)
      // está registrado antes de pedir a inscrição push.
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await navigator.serviceWorker.register('/sw.js');
      }
      registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        ),
      });

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          barberId: barber.id,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Não foi possível salvar a inscrição no servidor.');
      }

      setStatus('subscribed');
    } catch (err) {
      console.error('[PushNotificationButton] erro ao ativar notificações:', err);
      setErrorMessage(err.message || 'Não foi possível ativar as notificações.');
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setBusy(true);
    setErrorMessage('');

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }

      setStatus('unsubscribed');
    } catch (err) {
      console.error('[PushNotificationButton] erro ao desativar notificações:', err);
      setErrorMessage(err.message || 'Não foi possível desativar as notificações.');
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'unsupported') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-elevated px-3.5 py-3 text-xs text-zinc-500">
        <BellOff size={16} className="shrink-0" />
        Este navegador não suporta notificações push.
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-elevated px-3.5 py-3 text-xs text-zinc-500">
        <AlertCircle size={16} className="shrink-0 text-amber-500" />
        Notificações bloqueadas. Libere o acesso nas configurações do navegador para
        ativar.
      </div>
    );
  }

  const isSubscribed = status === 'subscribed';

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={isSubscribed ? handleUnsubscribe : handleSubscribe}
        disabled={busy || status === 'checking'}
        className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition disabled:opacity-60 ${
          isSubscribed
            ? 'border border-zinc-700 bg-elevated text-zinc-300 active:bg-zinc-900'
            : 'bg-accent text-black active:bg-accent-light'
        }`}
      >
        {busy || status === 'checking' ? (
          <Loader2 size={16} className="animate-spin" />
        ) : isSubscribed ? (
          <BellRing size={16} />
        ) : (
          <Bell size={16} />
        )}
        {status === 'checking'
          ? 'Verificando…'
          : isSubscribed
            ? 'Notificações ativadas'
            : 'Ativar notificações push'}
      </button>

      {status === 'error' && errorMessage && (
        <p className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle size={12} className="shrink-0" />
          {errorMessage}
        </p>
      )}
    </div>
  );
}
