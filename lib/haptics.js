/**
 * Helper de feedback tátil / háptico para PWAs e dispositivos móveis.
 * Proporciona a sensação de um aplicativo nativo instalado (iOS/Android).
 */
export function triggerHaptic(type = 'light') {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

  if (!navigator.vibrate) return;

  try {
    switch (type) {
      case 'light':
        navigator.vibrate(8);
        break;
      case 'medium':
        navigator.vibrate(18);
        break;
      case 'heavy':
        navigator.vibrate([24, 40, 24]);
        break;
      case 'success':
        navigator.vibrate([10, 30, 20]);
        break;
      case 'error':
        navigator.vibrate([40, 60, 40]);
        break;
      default:
        navigator.vibrate(10);
    }
  } catch {
    // Ignora silenciosamente se o dispositivo recusar a vibração
  }
}
