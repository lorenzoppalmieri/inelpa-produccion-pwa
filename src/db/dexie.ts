import Dexie, { type Table } from 'dexie'
import type {
  Evento,
  CausaDemora,
  Sector,
  Operario,
  PuestoTrabajo,
  OrdenFabricacion,
  EtapaOrden,
} from '../types'

/**
 * Base de datos local en IndexedDB.
 *
 * Diseño clave:
 *  - `eventos`: cola de eventos. Todo evento se persiste acá PRIMERO;
 *    la sincronización a Supabase es asíncrona y puede reintentarse.
 *  - `catálogos` (sectores, puestos, operarios, causas): cache de sólo lectura
 *    que se refresca al arrancar la PWA si hay red. Permite que el login
 *    por PIN y la selección de etapas funcionen offline.
 *  - `ordenes` y `etapas`: también cacheados para permitir trabajo offline
 *    completo (ver la cola de etapas sin red).
 *  - `kv`: key-value genérico para metadatos (última sincronización, sesión activa, etc.).
 */

export interface KV {
  key: string
  value: unknown
}

export class InelpaDB extends Dexie {
  eventos!: Table<Evento, string>
  causasDemora!: Table<CausaDemora, string>
  sectores!: Table<Sector, string>
  puestos!: Table<PuestoTrabajo, string>
  operarios!: Table<Operario, string>
  ordenes!: Table<OrdenFabricacion, string>
  etapas!: Table<EtapaOrden, string>
  kv!: Table<KV, string>

  constructor() {
    super('inelpa-produccion')

    // v1 — versión inicial con stubs (scaffold)
    this.version(1).stores({
      eventos: 'id, syncStatus, timestamp, contratoId, sectorId',
      causasDemora: 'codigo, categoria, activa',
      kv: 'key',
    })

    // v2 — modelo real (2026-04-22)
    // - Se renombran índices a la convención snake_case del SQL.
    // - Se agregan tablas de catálogo y órdenes/etapas.
    // - `sync_status` reemplaza a `syncStatus`.
    this.version(2)
      .stores({
        eventos: 'id, sync_status, timestamp, etapa_orden_id, operario_id, tipo',
        causasDemora: 'codigo, categoria, *sectores_aplicables, activa',
        sectores: 'codigo, orden_secuencia',
        puestos: 'id, sector_codigo',
        operarios: 'id, pin, sector_codigo',
        ordenes: 'id, codigo, estado',
        etapas: 'id, orden_id, sector_codigo, estado, secuencia',
        kv: 'key',
      })
      .upgrade(async (tx) => {
        // Migración de eventos v1 → v2:
        // Los eventos antiguos (del scaffold) no cumplen el nuevo esquema;
        // los marcamos para revisión manual en lugar de borrarlos.
        const eventos = await tx.table('eventos').toArray()
        for (const e of eventos) {
          if ('syncStatus' in e) {
            e.sync_status = e.syncStatus
            delete e.syncStatus
          }
          await tx.table('eventos').put(e)
        }
      })
  }
}

export const db = new InelpaDB()
