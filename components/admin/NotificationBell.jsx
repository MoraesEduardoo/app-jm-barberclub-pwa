'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  BellRing,
  BellOff,
  CheckCircle2,
  AlertCircle,
  CalendarPlus,
  Zap,
  RefreshCcw,
  Send,
  Loader2,
  Check,
} from 'lucide-react';
import { useNotifications } from '@/lib/notifications';
import { useBarber } from '@/lib/barber-context';
import BottomSheet from './BottomSheet';

const ICONS = {
  new_appointment: CalendarPlus,
  walk_in: Zap,
  status_change: RefreshCcw,
};

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `${minutes} min atrás`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h atrás`;
}

function urlBase64ToUint8Array(base64String) {
  if (!base64String) {
    throw new Error('Chave VAPID pública ausente.');
  }
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * NotificationBell:
 * Sininho de notificações inteligente com indicador visual de status das notificações push.
 *
 * REQUISITOS IMPLEMENTADOS:
 * 1. O clique não oculta o cabeçalho nem o conteúdo da página (renderizado via createPortal).
 * 2. Quando ativo / subscrito, o ícone fica em DESTAQUE NA COR VERMELHA com ponto indicador.
 * 3. Permite verificar permissão, ativar/desativar e testar o envio de notificação push.
 * 4. Mostra o histórico recente de agendamentos e notificações internas.
 */
export default function NotificationBell() {
  const { barber } = useBarber();
  const { notifications, unreadCount, markAllRead } = useNotifications();

  const [open, setOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState('checking'); // checking | subscribed | unsubscribed | denied | unsupported | error
  const [busy, setBusy] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testSentFeedback, setTestSentFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');

  // Sincroniza o estado de inscrição Push
  const checkPushSubscription = useCallback(async () => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setPushStatus('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setPushStatus('denied');
      return;
    }

    try {
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
      }

      const subscription = await reg?.pushManager?.getSubscription();
      if (subscription) {
        setPushStatus('subscribed');
      } else {
        setPushStatus('unsubscribed');
      }
    } catch {
      setPushStatus('unsubscribed');
    }
  }, []);

  useEffect(() => {
    checkPushSubscription();
  }, [checkPushSubscription]);

  // Ativação de push notifications
  async function handleSubscribe() {
    setBusy(true);
    setFeedbackError('');
    try {
      const vapidKey = urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      );

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'unsubscribed');
        setBusy(false);
        return;
      }

      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
      }

      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKey,
        });
      }

      if (barber?.id) {
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            barberId: barber.id,
          }),
        });
      }

      setPushStatus('subscribed');
    } catch (err) {
      console.error('Erro ao assinar push:', err);
      const isIOS =
        typeof window !== 'undefined' &&
        /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isStandalone =
        typeof window !== 'undefined' &&
        Boolean(
          window.navigator.standalone ||
            window.matchMedia('(display-mode: standalone)').matches
        );

      if (isIOS && !isStandalone) {
        setFeedbackError(
          'No iPhone, adicione o app à Tela de Início pelo Safari para receber notificações.'
        );
      } else {
        setFeedbackError(err.message || 'Não foi possível ativar as notificações.');
      }
      setPushStatus('error');
    } finally {
      setBusy(false);
    }
  }

  // Desativação de push notifications
  async function handleUnsubscribe() {
    setBusy(true);
    setFeedbackError('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const subscription = await reg?.pushManager?.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        if (barber?.id) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ endpoint, barberId: barber.id }),
          }).catch(() => {});
        }
      }
      setPushStatus('unsubscribed');
    } catch (err) {
      console.error('Erro ao desativar push:', err);
      setFeedbackError('Erro ao desativar notificações.');
    } finally {
      setBusy(false);
    }
  }

  // Disparo de notificação de teste
  async function handleSendTest() {
    setTestSending(true);
    setTestSentFeedback(false);
    setFeedbackError('');

    try {
      const response = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'JM Barberclub — Teste Push',
          body: `Olá, ${barber?.name || 'barbeiro'}! Suas notificações push estão ativas e funcionando perfeitamente.`,
          barberId: barber?.id,
        }),
      });

      const res = await response.json();
      if (res.success) {
        setTestSentFeedback(true);
        setTimeout(() => setTestSentFeedback(false), 4000);
      } else {
        setFeedbackError(res.message || 'Inscrição ainda não vinculada ao servidor.');
      }
    } catch {
      setFeedbackError('Falha ao disparar teste de notificação.');
    } finally {
      setTestSending(false);
    }
  }

  const isSubscribed = pushStatus === 'subscribed';

  return (
    <>
      {/* Botão do Sininho no Cabeçalho */}
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          markAllRead();
          checkPushSubscription();
        }}
        aria-label="Notificações e Alertas Push"
        className={`relative h-8 w-8 rounded-full flex items-center justify-center transition-all touch-manipulation active:scale-95 ${
          isSubscribed
            ? 'text-red-500 bg-red-500/10 border border-red-500/30'
            : 'text-zinc-400 active:text-accent-light active:bg-zinc-900 border border-transparent'
        }`}
      >
        {isSubscribed ? <BellRing size={17} /> : <Bell size={17} />}

        {/* Ponto indicador de push ativo na cor vermelha */}
        {isSubscribed && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
        )}

        {/* Badge numérico de mensagens não lidas */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Modal / BottomSheet de Gerenciamento e Histórico */}
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Notificações & Alertas"
      >
        <div className="space-y-4 pb-2">
          {/* Card de Status do Push no Celular */}
          <div className="bg-surface border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div
                  className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isSubscribed
                      ? 'bg-red-500/15 text-red-500'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {isSubscribed ? (
                    <BellRing size={18} />
                  ) : (
                    <BellOff size={18} />
                  )}
                </div>
                <div>
                  <h4 className="text-white text-xs font-semibold">
                    Notificações no Celular
                  </h4>
                  <p className="text-zinc-400 text-[11px] mt-0.5">
                    {isSubscribed
                      ? 'Ativas neste dispositivo'
                      : pushStatus === 'denied'
                      ? 'Bloqueadas pelo navegador'
                      : 'Desativadas no momento'}
                  </p>
                </div>
              </div>

              {/* Tag indicadora */}
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  isSubscribed
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {isSubscribed ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            {feedbackError && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-3 py-2 text-xs">
                <AlertCircle size={14} className="shrink-0" />
                <span>{feedbackError}</span>
              </div>
            )}

            {testSentFeedback && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl px-3 py-2 text-xs">
                <CheckCircle2 size={14} className="shrink-0" />
                <span>Notificação de teste enviada com sucesso!</span>
              </div>
            )}

            {/* Ações de Controle */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {isSubscribed ? (
                <>
                  <button
                    type="button"
                    onClick={handleUnsubscribe}
                    disabled={busy}
                    className="flex items-center justify-center gap-1.5 h-11 rounded-xl bg-elevated border border-zinc-700/80 text-zinc-300 text-xs font-semibold active:bg-zinc-900 transition-all touch-manipulation disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <BellOff size={14} />
                    )}
                    <span>Desativar</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSendTest}
                    disabled={testSending}
                    className="flex items-center justify-center gap-1.5 h-11 rounded-xl bg-red-600 text-white text-xs font-semibold active:bg-red-700 transition-all touch-manipulation shadow-sm disabled:opacity-50"
                  >
                    {testSending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    <span>Testar push</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleSubscribe}
                  disabled={busy}
                  className="col-span-2 flex items-center justify-center gap-2 h-11 rounded-xl bg-red-600 text-white text-xs font-bold active:bg-red-700 transition-all touch-manipulation shadow-sm disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <BellRing size={14} />
                  )}
                  <span>Ativar notificações no celular</span>
                </button>
              )}
            </div>
          </div>

          {/* Histórico Recente de Notificações Internas */}
          <div>
            <h4 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Alertas Recentes ({notifications.length})</span>
            </h4>

            {notifications.length === 0 ? (
              <div className="bg-surface/50 border border-zinc-800/80 rounded-xl py-8 text-center text-zinc-500 text-xs">
                Nenhuma notificação por enquanto.
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                {notifications.map((n) => {
                  const Icon = ICONS[n.type] || Bell;
                  return (
                    <div
                      key={n.id}
                      className="flex items-start gap-3 bg-surface border border-zinc-800/90 rounded-xl px-3.5 py-3 text-xs"
                    >
                      <div className="h-8 w-8 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                        <Icon size={15} className="text-red-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium">{n.message}</p>
                        <p className="text-zinc-500 text-[11px] mt-0.5">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
