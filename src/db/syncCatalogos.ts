import { db } from './dexie'
import { supabase } from '../lib/supabase'
import type {
  Sector,
  PuestoTrabajo,
  Operario,
  CausaDemora,
  OrdenFabricacion,
  ProductoTerminado,
  Semielaborado,
  BomItem,
  ItemOrden,
} from '../types'

/**
 * Descarga catálogos y datos operativos desde Supabase a Dexie.
 *
 * - Catálogos (sectores, puestos, operarios, causas, productos, semielaborados, bom):
 *   se reemplazan completos.
 * - Órdenes activas e items de esas órdenes: se hace `bulkPut` para no pisar
 *   cambios locales pendientes de sincronizar.
 *
 * Devuelve timestamp ISO del último sync exitoso, o null si falló o no había red.
 */
export async function syncCatalogos(): Promise<string | null> {
  if (!navigator.onLine) {
    return null
  }

  try {
    const [
      sectoresRes,
      puestosRes,
      operariosRes,
      causasRes,
      productosRes,
      semielaboradosRes,
      bomRes,
      ordenesRes,
      itemsRes,
    ] = await Promise.all([
      supabase.from('sectores').select('*').eq('activo', true),
      supabase.from('puestos_trabajo').select('*').eq('activo', true),
      supabase.from('operarios').select('*').eq('activo', true),
      supabase.from('causas_demora').select('*').eq('activa', true),
      supabase.from('productos_terminados').select('*').eq('activo', true),
      supabase.from('semielaborados').select('*').eq('activo', true),
      supabase.from('bom_productos').select('*'),
      supabase
        .from('ordenes_fabricacion')
        .select('*')
        .in('estado', ['pendiente', 'en_proceso']),
      supabase
        .from('items_orden')
        .select('*')
        .in('estado', ['pendiente', 'en_proceso', 'demorada']),
    ])

    const errors = [
      sectoresRes.error,
      puestosRes.error,
      operariosRes.error,
      causasRes.error,
      productosRes.error,
      semielaboradosRes.error,
      bomRes.error,
      ordenesRes.error,
      itemsRes.error,
    ].filter(Boolean)

    if (errors.length > 0) {
      console.error('[syncCatalogos] errores', errors)
      return null
    }

    await db.transaction(
      'rw',
      [
        db.sectores,
        db.puestos,
        db.operarios,
        db.causasDemora,
        db.productosTerminados,
        db.semielaborados,
        db.bom,
        db.ordenes,
        db.items,
      ],
      async () => {
        await db.sectores.clear()
        await db.sectores.bulkPut((sectoresRes.data ?? []) as Sector[])

        await db.puestos.clear()
        await db.puestos.bulkPut((puestosRes.data ?? []) as PuestoTrabajo[])

        await db.operarios.clear()
        await db.operarios.bulkPut((operariosRes.data ?? []) as Operario[])

        await db.causasDemora.clear()
        await db.causasDemora.bulkPut((causasRes.data ?? []) as CausaDemora[])

        await db.productosTerminados.clear()
        await db.productosTerminados.bulkPut(
          (productosRes.data ?? []) as ProductoTerminado[],
        )

        await db.semielaborados.clear()
        await db.semielaborados.bulkPut(
          (semielaboradosRes.data ?? []) as Semielaborado[],
        )

        await db.bom.clear()
        await db.bom.bulkPut((bomRes.data ?? []) as BomItem[])

        // Órdenes/items: bulkPut conserva cambios locales por PK.
        await db.ordenes.bulkPut((ordenesRes.data ?? []) as OrdenFabricacion[])
        await db.items.bulkPut((itemsRes.data ?? []) as ItemOrden[])
      },
    )

    const ts = new Date().toISOString()
    await db.kv.put({ key: 'catalogos_last_sync', value: ts })
    return ts
  } catch (err) {
    console.error('[syncCatalogos] excepción', err)
    return null
  }
}

/** Lee el timestamp del último sync exitoso. */
export async function getLastCatalogosSync(): Promise<string | null> {
  const row = await db.kv.get('catalogos_last_sync')
  return (row?.value as string | undefined) ?? null
}
