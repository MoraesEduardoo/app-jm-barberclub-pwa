/**
 * Helper global para disparo de toasts amigáveis em toda a aplicação.
 * Permite feedback visual instantâneo sem depender de alert() ou logs no console.
 */
export const toast = {
  success: (message, duration = 4000) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('app:toast', {
          detail: { message, type: 'success', duration },
        })
      );
    }
  },
  error: (message, duration = 5000) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('app:toast', {
          detail: { message, type: 'error', duration },
        })
      );
    }
  },
  info: (message, duration = 4000) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('app:toast', {
          detail: { message, type: 'info', duration },
        })
      );
    }
  },
  warning: (message, duration = 4500) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('app:toast', {
          detail: { message, type: 'warning', duration },
        })
      );
    }
  },
};
