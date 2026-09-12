'use client';

const STORAGE_KEY = 'jm_barber_phone';

export function getStoredPhone() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredPhone(phone) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, phone.replace(/\D/g, ''));
}

export function clearStoredPhone() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
