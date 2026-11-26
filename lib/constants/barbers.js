/**
 * Identificadores UUID canônicos e metadados padrão dos barbeiros da equipe
 * (Matheus e William - JM Barberclub).
 * Centralizado para evitar duplicação de strings mágicas no frontend e backend.
 */

export const DEFAULT_MATHEUS_ID = 'b949db29-efb1-4131-8234-873195068328';
export const DEFAULT_WILLIAM_ID = '9ebcd15c-b747-4d0b-b12f-5de9465363f9';

export const BARBERS_CONFIG = Object.freeze({
  MATHEUS: {
    id: DEFAULT_MATHEUS_ID,
    name: 'Matheus',
    slug: 'matheus',
    role: 'admin',
  },
  WILLIAM: {
    id: DEFAULT_WILLIAM_ID,
    name: 'William',
    slug: 'william',
    role: 'manager',
  },
});
