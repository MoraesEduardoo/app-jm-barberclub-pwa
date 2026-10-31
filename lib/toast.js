/**
 * Helper global para disparo de toasts amigáveis em toda a aplicação.
 * Permite feedback visual instantâneo sem depender de alert() ou logs no console.
 */
function dispatchToast(message, type = 'success', duration = 4000) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('app:toast', {
        detail: { message, type, duration },
      })
    );
  }
}

export const toast = Object.assign(
  (message, type = 'success', duration = 4000) => {
    dispatchToast(message, type, duration);
  },
  {
    success: (message, duration = 4000) => {
      dispatchToast(message, 'success', duration);
    },
    error: (message, duration = 5000) => {
      dispatchToast(message, 'error', duration);
    },
    info: (message, duration = 4000) => {
      dispatchToast(message, 'info', duration);
    },
    warning: (message, duration = 4500) => {
      dispatchToast(message, 'warning', duration);
    },
  }
);

export default toast;
