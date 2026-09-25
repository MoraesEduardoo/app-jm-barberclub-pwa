// Utilitários de sessão do cliente (localStorage)

export function getStoredPhone() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('barber_client_phone') || null;
}

export function setStoredPhone(phone) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('barber_client_phone', phone);
}

export function clearStoredPhone() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('barber_client_phone');
}