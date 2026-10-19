'use client';

import { useState, useEffect } from 'react';
import {
  Download,
  Share,
  PlusSquare,
  X,
  Smartphone,
  CheckCircle2,
} from 'lucide-react';

const STORAGE_KEY = 'jm_pwa_banner_dismissed';
const DISMISS_DAYS = 7; // Não incomoda o utilizador por 7 dias após dispensar

export default function InstallPwaBanner() {
  const [mounted, setMounted] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true);
  const [showIOSModal, setShowIOSModal] = useState(false);

  useEffect(() => {
    setMounted(true);

    // 1. Verifica se já está rodando em modo PWA standalone (app instalado)
    const standaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://');

    setIsStandalone(standaloneMode);
    if (standaloneMode) return;

    // 2. Verifica se o usuário dispensou o banner recentemente
    try {
      const dismissedTimestamp = localStorage.getItem(STORAGE_KEY);
      if (dismissedTimestamp) {
        const diffDays =
          (Date.now() - parseInt(dismissedTimestamp, 10)) / (1000 * 60 * 60 * 24);
        if (diffDays < DISMISS_DAYS) {
          setIsDismissed(true);
        } else {
          setIsDismissed(false);
        }
      } else {
        setIsDismissed(false);
      }
    } catch {
      setIsDismissed(false);
    }

    // 3. Detecção de dispositivo Apple iOS (iPhone / iPad / iPod)
    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleDevice =
      /iphone|ipad|ipod/.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

    setIsIOS(isAppleDevice);

    // 4. Captura do evento nativo beforeinstallprompt (Android / Chrome / Edge)
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Se recebeu o prompt nativo e não foi dispensado recentemente, exibe
      setIsDismissed(false);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
      setIsDismissed(true);
      try {
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
      } catch {}
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (!mounted || isStandalone || isDismissed) {
    return null;
  }

  // Não exibe se não for iOS e não tiver capturado o prompt (ex: navegadores sem suporte PWA no desktop)
  if (!isIOS && !deferredPrompt) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {}
  };

  const handleInstallClick = async () => {
    if (isIOS) {
      // No iOS, abre o modal instrutivo
      setShowIOSModal(true);
      return;
    }

    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsStandalone(true);
      }
      setDeferredPrompt(null);
    } catch (err) {
      console.error('Erro ao acionar instalação PWA:', err);
    }
  };

  return (
    <>
      {/* Banner Flutuante Elegante (Posicionado logo acima da BottomNav) */}
      <aside
        role="region"
        aria-label="Instalação do Aplicativo"
        className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+68px)] inset-x-3 max-w-lg mx-auto z-30 animate-in fade-in slide-in-from-bottom-3 duration-300"
      >
        <div className="bg-zinc-950/95 backdrop-blur-md border border-accent/30 rounded-2xl p-3.5 shadow-2xl shadow-black/80 flex items-center justify-between gap-3">
          {/* Ícone e Textos */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent shrink-0">
              <Smartphone size={20} />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white tracking-tight truncate">
                  Instalar Painel JM
                </span>
                <span className="text-[9px] bg-accent/20 text-accent-light px-1.5 py-0.2 rounded font-bold uppercase shrink-0">
                  {isIOS ? 'iPhone' : 'App'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                Acesse a agenda em 1 toque na tela inicial
              </p>
            </div>
          </div>

          {/* Ações */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleInstallClick}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-black font-bold text-xs py-2 px-3 rounded-xl active:scale-95 transition-all shadow-sm shadow-accent/20 touch-manipulation"
            >
              {isIOS ? <Share size={13} /> : <Download size={13} />}
              <span>Instalar</span>
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dispensar aviso de instalação"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 active:scale-90 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Modal Instrutivo Dedicado para iPhone / iOS Safari */}
      {showIOSModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-sm p-5 text-left shadow-2xl relative space-y-4">
            {/* Topo do Modal */}
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
                  <Smartphone size={16} />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">Instalar no iPhone</h3>
                  <p className="text-zinc-500 text-[10px]">Passo a passo rápido pelo Safari</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="h-7 w-7 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Passos Ilustrados */}
            <div className="space-y-3 py-1">
              {/* Passo 1 */}
              <div className="flex items-start gap-3 bg-zinc-900/60 border border-zinc-800/80 p-3 rounded-2xl">
                <div className="h-7 w-7 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">
                  1
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs font-semibold flex items-center gap-1.5">
                    Toque no botão Compartilhar
                    <Share size={13} className="text-blue-400" />
                  </p>
                  <p className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
                    Localizado na barra inferior do Safari (o ícone de quadrado com seta para cima).
                  </p>
                </div>
              </div>

              {/* Passo 2 */}
              <div className="flex items-start gap-3 bg-zinc-900/60 border border-zinc-800/80 p-3 rounded-2xl">
                <div className="h-7 w-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">
                  2
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs font-semibold flex items-center gap-1.5">
                    Role e toque em
                    <PlusSquare size={13} className="text-emerald-400" />
                  </p>
                  <p className="text-white text-xs font-bold mt-0.5">
                    &quot;Adicionar à Tela de Início&quot;
                  </p>
                  <p className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
                    Você pode descer um pouco a lista de opções para encontrar esse botão.
                  </p>
                </div>
              </div>

              {/* Passo 3 */}
              <div className="flex items-start gap-3 bg-zinc-900/60 border border-zinc-800/80 p-3 rounded-2xl">
                <div className="h-7 w-7 rounded-lg bg-accent/15 border border-accent/30 text-accent flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">
                  3
                </div>
                <div className="min-w-0">
                  <p className="text-white text-xs font-semibold flex items-center gap-1.5">
                    Confirme em &quot;Adicionar&quot;
                    <CheckCircle2 size={13} className="text-accent" />
                  </p>
                  <p className="text-zinc-400 text-[11px] mt-0.5 leading-relaxed">
                    No canto superior direito. O ícone da JM Barberclub aparecerá na tela do seu iPhone!
                  </p>
                </div>
              </div>
            </div>

            {/* Rodapé com Botão Entendido */}
            <div className="pt-2 border-t border-zinc-800/80 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowIOSModal(false);
                  handleDismiss();
                }}
                className="w-full bg-accent hover:bg-accent-hover text-black font-bold py-2.5 rounded-xl text-xs transition-colors active:scale-[0.99] touch-manipulation"
              >
                Entendi, vou adicionar agora
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
