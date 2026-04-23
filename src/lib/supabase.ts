import { createClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase.
 * Las credenciales se cargan desde variables de entorno con prefijo VITE_
 * (ver .env.example).
 *
 * IMPORTANTE: La anon key puede vivir en el bundle. Las políticas de seguridad
 * se resuelven con Row Level Security en Postgres, no ocultando la key.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Log explícito para que el error sea obvio al arrancar sin .env configurado
  console.error(
    '[Supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. ' +
      'Copiá .env.example a .env.local y completá los valores.',
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})
