import { db } from './dexie'
import type { Evento, TipoEvento } from '../types'
import { syncPendingEventos } from './sync'

/**
 * Crea un evento localmente en Dexie con sync_status='pending' y dispara
 * el sync (best-effort). Si no hay red, queda en cola.
 *
 * El ID se genera en el cliente (UUID v4) para permitir referencias
 * cruzadas offline — un DEMORA_FIN puede apuntar al ID del DEMORA_INICIO
 * aunque ninguno haya llegado todavía a Supabase.
 */

type CrearEventoInput = {
  item_orden_id: string
  operario_id: string
  puesto_trabajo_id?: string | null
  tipo: TipoEvento
  causa_demora_codigo?: string
  evento_demora_inicio_id?: string
  observacion?: string
}

function uuidv4(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export async function crearEvento(input: CrearEventoInput): Promise<Evento> {
  const ahora = new Date().toISOString()
  const evento: Evento = {
    id: uuidv4(),
    item_orden_id: input.item_orden_id,
    operario_id: input.operario_id,
    puesto_trabajo_id: input.puesto_trabajo_id ?? null,
    tipo: input.tipo,
    timestamp: ahora,
    causa_demora_codigo: input.causa_demora_codigo,
    evento_demora_inicio_id: input.evento_demora_inicio_id,
    observacion: input.observacion,
    cliente_timestamp: ahora,
    cliente_online: navigator.onLine,
    sync_status: 'pending',
  }

  await db.eventos.put(evento)
  void syncPendingEventos()
  return evento
}

/**
 * Busca la demora abierta más reciente para un item/operario:
 * un DEMORA_INICIO sin DEMORA_FIN que lo referencie.
 */
export async function buscarDemoraAbierta(
  itemOrdenId: string,
  operarioId: string,
): Promise<Evento | null> {
  const eventos = await db.eventos
    .where('item_orden_id')
    .equals(itemOrdenId)
    .and((e) => e.operario_id === operarioId)
    .toArray()

  const inicios = eventos
    .filter((e) => e.tipo === 'DEMORA_INICIO')
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))

  for (const inicio of inicios) {
    const fin = eventos.find(
      (e) => e.tipo === 'DEMORA_FIN' && e.evento_demora_inicio_id === inicio.id,
    )
    if (!fin) return inicio
  }
  return null
}

/** Lee todos los eventos de un item ordenados por timestamp. */
export async function eventosDeItem(itemOrdenId: string): Promise<Evento[]> {
  const rows = await db.eventos
    .where('item_orden_id')
    .equals(itemOrdenId)
    .toArray()
  return rows.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
}
