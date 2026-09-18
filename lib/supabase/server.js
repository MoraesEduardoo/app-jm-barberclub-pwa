import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export function getSupabaseServerClient() {
  const cookieStore = cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('As variáveis de ambiente do Supabase não estão configuradas no servidor.')
  }

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value
        },
        set(name, value, options) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {
            // Ignorado em Server Components
          }
        },
        remove(name, options) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {
            // Ignorado em Server Components
          }
        },
      },
    }
  )
}