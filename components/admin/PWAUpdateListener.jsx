// components/PWAUpdateListener.jsx
"use client";

import { useEffect } from "react";

export default function PWAUpdateListener() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.update();
      });

      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          navigator.serviceWorker.ready.then((registration) => {
            registration.update();
          });
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      };
    }
  }, []);

  return null;
}
