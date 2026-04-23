import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'

/**
 * Cuenta en vivo de eventos pendientes de sincronizar.
 * Se actualiza automáticamente al cambiar la tabla `eventos`.
 */
export function usePendingSyncCount(): number {
  const count = useLiveQuery(
    () => db.eventos.where('sync_status').equals('pending').count(),
    [],
    0,
  )
  return count ?? 0
}
