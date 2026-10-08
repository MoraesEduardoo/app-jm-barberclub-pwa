// components/PWAUpdateListener.jsx
"use client";

import { useEffect } from "react";

/**
 * Listener de ciclo de vida do PWA otimizado para iOS / WebKit:
 * Trata o congelamento e retomada de abas (Page Visibility API e bfcache pageshow),
 * prevenindo travamentos ou rejections não tratadas quando o iOS suspende o app.
 */
export default function PWAUpdateListener() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let mounted = true;

    const checkServiceWorkerUpdate = () => {
      try {
        navigator.serviceWorker.ready
          .then((registration) => {
            if (mounted && registration) {
              registration.update().catch((err) => {
                // Silencia falhas transitórias de conexão durante o despertar do iOS
                console.debug("[PWA] Verificação de atualização suspensa ou offline:", err?.message);
              });
            }
          })
          .catch(() => {});
      } catch {
        // Ignora erros de inicialização WebKit em background
      }
    };

    // Verificação inicial
    checkServiceWorkerUpdate();

    // Disparado quando o barbeiro reabre o app no iPhone (Page Visibility API)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkServiceWorkerUpdate();
      }
    };

    // Disparado no WebKit bfcache (Back-Forward Cache do iOS ao alternar entre apps)
    const handlePageShow = (event) => {
      if (event.persisted) {
        checkServiceWorkerUpdate();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return null;
}
