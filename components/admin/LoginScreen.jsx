'use client';

import { useState } from 'react';
import { Loader2, Phone, ShieldAlert } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getBarberByPhone } from '@/lib/auth';
import { setStoredPhone } from '@/lib/session';

export default function LoginScreen({ onSuccess }) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setError('Digite um telefone válido, com DDD.');
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const found = await getBarberByPhone(supabase, cleanPhone);

      if (!found) {
        setError('Esse número não está cadastrado como barbeiro ativo.');
        return;
      }

      setStoredPhone(cleanPhone);
      onSuccess(found);
    } catch {
      setError('Não foi possível conectar. Verifique sua internet e tente de novo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-8">
      <div className="h-14 w-14 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center">
        <ShieldAlert className="text-accent-light" size={26} />
      </div>

      <div className="text-center">
        <h1 className="text-white font-semibold text-lg">Painel do Barbeiro</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Entre com o número de telefone cadastrado como barbeiro na equipe.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs">
        <div className="relative mb-3">
          <Phone
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="tel"
            inputMode="tel"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(83) 9 9999-9999"
            className="w-full h-12 rounded-lg bg-elevated border border-zinc-700 pl-9 pr-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent"
          />
        </div>

        {error && <p className="text-accent-light text-xs mb-3 text-center">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full h-12 rounded-lg bg-accent text-white font-semibold text-sm shadow-accent-glow active:bg-accent-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Entrando…
            </>
          ) : (
            'Entrar no painel'
          )}
        </button>
      </form>
    </div>
  );
}
