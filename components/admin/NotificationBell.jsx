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
  Loader2,
  RotateCcw,
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

/**
 * Converte e valida rigorosamente a chave pública VAPID (base64url)
 * para o Uint8Array de 65 bytes (ponto não-comprimido P-256) exigido
 * pelo PushManager.subscribe (applicationServerKey).
 */
function urlBase64ToUint8Array(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    throw new Error('A chave pública VAPID não foi informada.');
  }

  // Remove aspas simples/duplas e espaços das extremidades
  const cleanKey = base64String.trim().replace(/^["']|["']$/g, '');
  if (!cleanKey) {
    throw new Error('A chave pública VAPID está vazia.');
  }

  const padding = '='.repeat((4 - (cleanKey.length % 4)) % 4);
  const base64 = (cleanKey + padding).replace(/-/g, '+').replace(/_/g, '/');

  let rawData;
  try {
    rawData = window.atob(base64);
  } catch {
    throw new Error('A chave pública VAPID possui codificação base64 inválida.');
  }

  let outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  // Se a chave foi fornecida com 64 bytes (coordenadas X e Y sem o prefixo 0x04),
  // ajustamos automaticamente adicionando 0x04 no início (RFC 8292 / ANSI X9.62)
  if (outputArray.length === 64) {
    const prefixed = new Uint8Array(65);
    prefixed[0] = 0x04;
    prefixed.set(outputArray, 1);
    outputArray = prefixed;
  }

  // Validação estrita da especificação Web Push
  if (outputArray.length !== 65 || outputArray[0] !== 0x04) {
    throw new Error(
      `Chave pública VAPID inválida: esperado ponto P-256 de 65 bytes iniciando em 0x04 (recebido ${outputArray.length} bytes).`
    );
  }

  return outputArray;
}

/**
 * Obtém a chave pública VAPID das variáveis de ambiente do cliente
 * ou via fallback da API /api/push/vapid-public-key.
 */
async function getVapidPublicKeyString() {
  const envKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (envKey && typeof envKey === 'string' && envKey.trim().length > 0) {
    return envKey.trim().replace(/^["']|["']$/g, '');
  }

  try {
    const res = await fetch('/api/push/vapid-public-key');
    if (res.ok) {
      const data = await res.json();
      if (data?.publicKey) {
        return data.publicKey.trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (err) {
    console.warn('[Push] Não foi possível obter chave via /api/push/vapid-public-key:', err);
  }

  throw new Error(
    'Chave VAPID pública não encontrada. Configure NEXT_PUBLIC_VAPID_PUBLIC_KEY nas variáveis de ambiente.'
  );
}

/**
 * Garante que o Service Worker está registrado e ATIVO/READY
 * antes de qualquer tentativa de inscrição no PushManager.
 * Evita a famosa falha DOMException "Registration failed - push service error".
 */
async function getReadyServiceWorkerRegistration() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker não é suportado neste navegador.');
  }

  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  }

  if (reg.active) {
    return reg;
  }

  try {
    const readyReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Tempo esgotado aguardando ativação do Service Worker.')),
          8000
        )
      ),
    ]);
    if (readyReg) return readyReg;
  } catch {
    // Continua para verificar o estado do registro
  }

  if (reg.installing || reg.waiting) {
    const worker = reg.installing || reg.waiting;
    await new Promise((resolve) => {
      const stateListener = () => {
        if (worker.state === 'activated' || reg.active) {
          worker.removeEventListener('statechange', stateListener);
          resolve();
        }
      };
      worker.addEventListener('statechange', stateListener);
      setTimeout(resolve, 4000);
    });
  }

  return reg;
}

function checkSameVapidKey(subscription, expectedBytes) {
  const actualKey = subscription?.options?.applicationServerKey;
  if (!actualKey) return true;
  const actual = new Uint8Array(actualKey);
  if (actual.length !== expectedBytes.length) return false;
  return actual.every((val, i) => val === expectedBytes[i]);
}

function cleanPushErrorMessage(err) {
  const msg = String(err?.message || err || '');
  const isIOS =
    typeof window !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    typeof window !== 'undefined' &&
    Boolean(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);

  if (isIOS && !isStandalone) {
    return 'No iPhone, adicione o app à Tela de Início pelo Safari ("Compartilhar" → "Adicionar à Tela de Início") para receber notificações.';
  }

  if (/push service error|registration failed/i.test(msg)) {
    return 'Falha de comunicação com o serviço Push (Google FCM). Verifique a conexão com a internet, desative bloqueadores ou saia do modo anônimo e tente novamente.';
  }

  if (/permission denied|denied/i.test(msg)) {
    return 'Notificações bloqueadas nas configurações do navegador. Libere o acesso para ativar.';
  }

  return msg || 'Não foi possível ativar as notificações push.';
}

/**
 * Componente dedicado para gestão e estado das Notificações Push no Dispositivo.
 */
function PushDeviceStatusSection({
  isSubscribed,
  pushStatus,
  busy,
  feedbackError,
  onSubscribe,
  onUnsubscribe,
}) {
  return (
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
            {isSubscribed ? <BellRing size={18} /> : <BellOff size={18} />}
          </div>
          <div>
            <h4 className="text-white text-xs font-semibold">
              Notificações Push no Telemóvel
            </h4>
            <p className="text-zinc-400 text-[11px] mt-0.5">
              {isSubscribed
                ? 'Ativas neste dispositivo'
                : pushStatus === 'denied'
                ? 'Bloqueadas pelo navegador'
                : pushStatus === 'unsupported'
                ? 'Não suportadas neste navegador'
                : 'Desativadas no momento'}
            </p>
          </div>
        </div>

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
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-3 py-2.5 text-xs">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <span className="block leading-relaxed">{feedbackError}</span>
            <button
              type="button"
              onClick={onSubscribe}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-red-300 hover:text-white underline underline-offset-2"
            >
              <RotateCcw size={11} />
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      <div className="pt-1">
        {isSubscribed ? (
          <button
            type="button"
            onClick={onUnsubscribe}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-elevated hover:bg-zinc-800 border border-zinc-700/80 text-zinc-300 hover:text-white text-xs font-semibold active:bg-zinc-900 transition-all touch-manipulation disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <BellOff size={14} />
            )}
            <span>Desativar notificações</span>
          </button>
        ) : pushStatus === 'denied' ? (
          <div className="w-full flex items-center justify-center p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-zinc-400 text-xs text-center">
            Permissão bloqueada no navegador. Abra as configurações do site e altere Notificações para &quot;Permitir&quot;.
          </div>
        ) : pushStatus === 'unsupported' ? (
          <div className="w-full flex items-center justify-center p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-zinc-400 text-xs text-center">
            Este navegador não possui suporte a Web Push Notifications.
          </div>
        ) : (
          <button
            type="button"
            onClick={onSubscribe}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold active:bg-red-700 transition-all touch-manipulation shadow-sm disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <BellRing size={14} />
            )}
            <span>Ativar notificações no telemóvel</span>
          </button>
        )}
      </div>
    </div>
  );
}

const NOTIFICATION_CATEGORIES = [
  { key: 'all', label: 'Todas' },
  { key: 'new_appointment', label: 'Agendamentos' },
  { key: 'walk_in', label: 'Encaixes' },
  { key: 'status_change', label: 'Status' },
];

/**
 * Componente dedicado para o Feed de Notificações do Sistema separado por categorias.
 */
function SystemNotificationsFeedSection({ notifications = [] }) {
  const [category, setCategory] = useState('all');

  const filtered =
    category === 'all'
      ? notifications
      : notifications.filter((n) => n.type === category);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">
          Notificações do Sistema ({filtered.length})
        </h4>
      </div>

      {/* Filtros de Secção de Notificações */}
      <div className="grid grid-cols-4 gap-1 bg-[#08080a] border border-zinc-800/90 rounded-xl p-1">
        {NOTIFICATION_CATEGORIES.map((cat) => {
          const active = category === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => setCategory(cat.key)}
              className={`h-7 rounded-lg text-[10.5px] font-semibold transition-all touch-manipulation ${
                active
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface/50 border border-zinc-800/80 rounded-xl py-8 text-center text-zinc-500 text-xs">
          Nenhuma notificação nesta categoria por enquanto.
        </div>
      ) : (
        <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
          {filtered.map((n) => {
            const Icon = ICONS[n.type] || Bell;
            const badgeColor =
              n.type === 'walk_in'
                ? 'bg-amber-500/15 text-amber-400'
                : n.type === 'status_change'
                ? 'bg-blue-500/15 text-blue-400'
                : 'bg-red-500/10 text-red-400';

            return (
              <div
                key={n.id}
                className="flex items-start gap-3 bg-surface border border-zinc-800/90 rounded-xl px-3.5 py-3 text-xs"
              >
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${badgeColor}`}
                >
                  <Icon size={15} />
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
  );
}

/**
 * NotificationBell:
 * Sininho de notificações inteligente com componentes separados para o Controlo Push
 * e o Feed Categorizado de Notificações do Sistema.
 */
export default function NotificationBell() {
  const { barber } = useBarber();
  const { notifications, unreadCount, markAllRead } = useNotifications();

  const [open, setOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState('checking'); // checking | subscribed | unsubscribed | denied | unsupported | error
  const [busy, setBusy] = useState(false);
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
      const reg = await getReadyServiceWorkerRegistration();
      const subscription = await reg?.pushManager?.getSubscription();

      if (subscription) {
        setPushStatus('subscribed');

        if (barber?.id) {
          fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              subscription: subscription.toJSON(),
              barberId: barber.id,
            }),
          }).catch(() => {});
        }
      } else {
        setPushStatus('unsubscribed');
      }
    } catch {
      setPushStatus('unsubscribed');
    }
  }, [barber?.id]);

  useEffect(() => {
    checkPushSubscription();
  }, [checkPushSubscription]);

  // Ativação de push notifications com auto-recuperação
  async function handleSubscribe() {
    if (!barber?.id) {
      setFeedbackError('Aguardando identificação do barbeiro. Aguarde um instante e tente novamente.');
      return;
    }

    setBusy(true);
    setFeedbackError('');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'unsubscribed');
        setBusy(false);
        if (permission === 'denied') {
          setFeedbackError('Permissão negada. Desbloqueie as notificações nas configurações do navegador.');
        }
        return;
      }

      const keyStr = await getVapidPublicKeyString();
      const vapidKeyBytes = urlBase64ToUint8Array(keyStr);
      const reg = await getReadyServiceWorkerRegistration();

      let subscription = await reg.pushManager.getSubscription();

      if (subscription && !checkSameVapidKey(subscription, vapidKeyBytes)) {
        try {
          await subscription.unsubscribe();
        } catch {}
        subscription = null;
      }

      if (!subscription) {
        try {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyBytes,
          });
        } catch (subErr) {
          const isServiceErr =
            subErr.name === 'AbortError' ||
            /push service error|registration failed/i.test(subErr.message || '');

          if (isServiceErr) {
            const stale = await reg.pushManager.getSubscription();
            if (stale) await stale.unsubscribe();
            await new Promise((r) => setTimeout(r, 600));

            subscription = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: vapidKeyBytes,
            });
          } else {
            throw subErr;
          }
        }
      }

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          barberId: barber.id,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Erro (${response.status}) ao gravar inscrição no servidor.`);
      }

      setPushStatus('subscribed');
    } catch (err) {
      setFeedbackError(cleanPushErrorMessage(err));
      setPushStatus('error');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setBusy(true);
    setFeedbackError('');
    try {
      const reg = await getReadyServiceWorkerRegistration();
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
    } catch {
      setFeedbackError('Erro ao desativar notificações.');
    } finally {
      setBusy(false);
    }
  }

  const isSubscribed = pushStatus === 'subscribed';

  return (
    <>
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

        {isSubscribed && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
        )}

        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Notificações & Alertas"
      >
        <div className="space-y-4 pb-2">
          <PushDeviceStatusSection
            isSubscribed={isSubscribed}
            pushStatus={pushStatus}
            busy={busy}
            feedbackError={feedbackError}
            onSubscribe={handleSubscribe}
            onUnsubscribe={handleUnsubscribe}
          />

          <SystemNotificationsFeedSection notifications={notifications} />
        </div>
      </BottomSheet>
    </>
  );
}
