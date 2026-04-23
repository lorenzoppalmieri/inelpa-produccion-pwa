import { db } from './dexie'
import { supabase } from '../lib/supabase'
import type { Evento } from '../types'

/**
 * Motor de sincronización de eventos pendientes.
 *
 * Estrategia:
 *  1. Consulta eventos con sync_status = 'pending'.
 *  2. Sube en batch a la tabla `eventos` en Supabase.
 *  3. Marca como 'synced' los que subieron OK; registra 'error' + mensaje
 *     para los que fallaron (se reintentan en el próximo ciclo).
 *
 * Se dispara:
 *  - Al arrancar la app
 *  - Cuando vuelve la conexión (evento 'online')
 *  - Periódicamente cada 30s si hay pendientes
 *
 * Nota: los campos locales (sync_status, sync_error, sync_attempted_at) no
 * se envían a Supabase — solo viven en IndexedDB.
 */

const BATCH_SIZE = 25

type EventoRemoto = Omit<Evento, 'sync_status' | 'sync_error' | 'sync_attempted_at'>

function toRemoto(e: Evento): EventoRemoto {
  const { sync_status, sync_error, sync_attempted_at, ...remoto } = e
  // Satisfy TS that unused destructured vars are intentional:
  void sync_status; void sync_error; void sync_attempted_at
  return remoto
}

export async function syncPendingEventos(): Promise<{
  synced: number
  failed: number
}> {
  if (!navigator.onLine) {
    return { synced: 0, failed: 0 }
  }

  const pendientes = await db.eventos
    .where('sync_status')
    .equals('pending')
    .limit(BATCH_SIZE)
    .toArray()

  if (pendientes.length === 0) {
    return { synced: 0, failed: 0 }
  }

  const { error } = await supabase.from('eventos').insert(pendientes.map(toRemoto))

  if (error) {
    await db.eventos
      .where('id')
      .anyOf(pendientes.map((e) => e.id))
      .modify({
        sync_status: 'error',
        sync_error: error.message,
        sync_attempted_at: new Date().toISOString(),
      })
    return { synced: 0, failed: pendientes.length }
  }

  await db.eventos
    .where('id')
    .anyOf(pendientes.map((e) => e.id))
    .modify({
      sync_status: 'synced',
      sync_error: undefined,
      sync_attempted_at: new Date().toISOString(),
    })

  return { synced: pendientes.length, failed: 0 }
}

export function startSyncLoop(intervalMs = 30_000) {
  void syncPendingEventos()
  window.addEventListener('online', () => {
    void syncPendingEventos()
  })
  const handle = setInterval(() => {
    void syncPendingEventos()
  }, intervalMs)
  return () => clearInterval(handle)
}
