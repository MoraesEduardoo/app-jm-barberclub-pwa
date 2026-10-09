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
 * NotificationBell:
 * Sininho de notificações inteligente com indicador visual de status das notificações push.
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
      const reg = await getReadyServiceWorkerRegistration();
      const subscription = await reg?.pushManager?.getSubscription();

      if (subscription) {
        setPushStatus('subscribed');

        // Se o barbeiro está autenticado, sincroniza silenciosamente com o Supabase
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
      // 1. Permissão do usuário
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'unsubscribed');
        setBusy(false);
        if (permission === 'denied') {
          setFeedbackError('Permissão negada. Desbloqueie as notificações nas configurações do navegador.');
        }
        return;
      }

      // 2. Chave pública VAPID e validação
      const keyStr = await getVapidPublicKeyString();
      const vapidKeyBytes = urlBase64ToUint8Array(keyStr);

      // 3. Service Worker ativo e pronto
      const reg = await getReadyServiceWorkerRegistration();

      // 4. Verificação de inscrição existente
      let subscription = await reg.pushManager.getSubscription();

      // Se existe inscrição mas foi feita com outra chave VAPID, cancela para renovar limpo
      if (subscription && !checkSameVapidKey(subscription, vapidKeyBytes)) {
        console.log('[Push] Inscrição com chave antiga detectada. Renovando...');
        try {
          await subscription.unsubscribe();
        } catch (unsubErr) {
          console.warn('[Push] Erro ao desinscrever chave antiga:', unsubErr);
        }
        subscription = null;
      }

      // 5. Inscrição no PushManager com recuperação inteligente de erro
      if (!subscription) {
        try {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyBytes,
          });
        } catch (subErr) {
          // Se disparar "push service error" (comum no Chrome/Android quando o FCM está dessincronizado)
          const isServiceErr =
            subErr.name === 'AbortError' ||
            /push service error|registration failed/i.test(subErr.message || '');

          if (isServiceErr) {
            console.warn('[Push] Falha inicial do Push Service. Executando tentativa de recuperação automática...');
            try {
              const stale = await reg.pushManager.getSubscription();
              if (stale) await stale.unsubscribe();
              // Pausa de 600ms para estabilização do daemon do navegador
              await new Promise((r) => setTimeout(r, 600));

              subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: vapidKeyBytes,
              });
            } catch (retryErr) {
              console.error('[Push] Falha na segunda tentativa:', retryErr);
              throw retryErr;
            }
          } else {
            throw subErr;
          }
        }
      }

      // 6. Persistência na tabela push_subscriptions do Supabase
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
      console.error('Erro ao assinar push:', err);
      setFeedbackError(cleanPushErrorMessage(err));
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
                      : pushStatus === 'unsupported'
                      ? 'Não suportadas neste navegador'
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
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-3 py-2.5 text-xs">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5">
                  <span className="block leading-relaxed">{feedbackError}</span>
                  <button
                    type="button"
                    onClick={handleSubscribe}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-red-300 hover:text-white underline underline-offset-2"
                  >
                    <RotateCcw size={11} />
                    Tentar novamente
                  </button>
                </div>
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
              ) : pushStatus === 'denied' ? (
                <div className="col-span-2 flex items-center justify-center p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-zinc-400 text-xs text-center">
                  Permissão bloqueada no navegador. Abra as configurações do site e altere Notificações para &quot;Permitir&quot;.
                </div>
              ) : pushStatus === 'unsupported' ? (
                <div className="col-span-2 flex items-center justify-center p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-zinc-400 text-xs text-center">
                  Este navegador não possui suporte a Web Push Notifications.
                </div>
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
