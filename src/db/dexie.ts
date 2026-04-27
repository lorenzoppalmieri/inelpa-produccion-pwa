import Dexie, { type Table } from 'dexie'
import type {
  Evento,
  CausaDemora,
  Sector,
  Operario,
  PuestoTrabajo,
  OrdenFabricacion,
  ProductoTerminado,
  Semielaborado,
  BomItem,
  ItemOrden,
} from '../types'

/**
 * Base de datos local en IndexedDB.
 *
 * Diseño clave:
 *  - `eventos`: cola offline-first; se escribe localmente y luego sincroniza a Supabase.
 *  - `catálogos` (sectores, puestos, operarios, causas, productos, semielaborados, bom):
 *    cache de sólo lectura, refrescado al arrancar si hay red.
 *  - `ordenes` y `items`: datos operativos, también cacheados para trabajar offline.
 *  - `kv`: key-value genérico para metadatos.
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
  productosTerminados!: Table<ProductoTerminado, string>
  semielaborados!: Table<Semielaborado, string>
  bom!: Table<BomItem, string>
  items!: Table<ItemOrden, string>
  kv!: Table<KV, string>

  constructor() {
    super('inelpa-produccion')

    // v1 — scaffold
    this.version(1).stores({
      eventos: 'id, syncStatus, timestamp, contratoId, sectorId',
      causasDemora: 'codigo, categoria, activa',
      kv: 'key',
    })

    // v2 — modelo "etapas_orden"
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
        const eventos = await tx.table('eventos').toArray()
        for (const e of eventos) {
          if ('syncStatus' in e) {
            e.sync_status = e.syncStatus
            delete e.syncStatus
          }
          await tx.table('eventos').put(e)
        }
      })

    // v3 — modelo "items_orden" (BOM expandida) — 2026-04-26
    // Reemplaza `etapas_orden` por `items_orden` y agrega catálogo de productos.
    // Eventos ahora apuntan a item_orden_id en lugar de etapa_orden_id.
    this.version(3)
      .stores({
        eventos: 'id, sync_status, timestamp, item_orden_id, operario_id, tipo',
        causasDemora: 'codigo, categoria, *sectores_aplicables, activa',
        sectores: 'codigo, orden_secuencia',
        puestos: 'id, sector_codigo',
        operarios: 'id, pin, sector_codigo',
        ordenes: 'id, codigo, estado, producto_terminado_codigo',
        productosTerminados: 'codigo, familia, tipo, activo',
        semielaborados: 'codigo, familia, sector_codigo, activo',
        bom: 'id, producto_terminado_codigo, semielaborado_codigo',
        items: 'id, orden_id, sector_codigo, estado, puesto_trabajo_id, operario_id, prioridad',
        // Tabla `etapas` se elimina; Dexie la borra al cambiar el schema.
        etapas: null,
        kv: 'key',
      })
      .upgrade(async (tx) => {
        // Migrar eventos: etapa_orden_id → item_orden_id (mismo valor, otro nombre).
        // En la práctica, los eventos de v2 son de prueba; los renombramos para no romper.
        const eventos = await tx.table('eventos').toArray()
        for (const e of eventos) {
          if ('etapa_orden_id' in e && !('item_orden_id' in e)) {
            e.item_orden_id = e.etapa_orden_id
            delete e.etapa_orden_id
          }
          await tx.table('eventos').put(e)
        }
      })
  }
}

export const db = new InelpaDB()
