import { db } from './dexie'
import { supabase } from '../lib/supabase'
import type {
  Sector,
  PuestoTrabajo,
  Operario,
  CausaDemora,
  OrdenFabricacion,
  EtapaOrden,
} from '../types'

/**
 * Descarga los catálogos desde Supabase y los vuelca en Dexie.
 *
 * Criterio de diseño:
 *  - Todo se hace en una sola pasada al arrancar la app si hay red.
 *  - Si no hay red, se usa lo que haya cacheado de la última sesión.
 *  - Los catálogos son chicos (≤ 100 filas cada uno en el horizonte previsto),
 *    así que bajamos la tabla entera y hacemos `bulkPut` — evita lógica de diff.
 *  - Órdenes/etapas: sólo traemos las que están activas (estado 'pendiente' o
 *    'en_proceso'). Las completadas no hacen falta en la PWA.
 *
 * Devuelve el timestamp del último sync exitoso; si hay error, devuelve null
 * (la UI sigue funcionando con lo cacheado).
 */
export async function syncCatalogos(): Promise<string | null> {
  if (!navigator.onLine) {
    return null
  }

  try {
    // Bajamos todo en paralelo — son queries independientes.
    const [sectoresRes, puestosRes, operariosRes, causasRes, ordenesRes, etapasRes] =
      await Promise.all([
        supabase.from('sectores').select('*').eq('activo', true),
        supabase.from('puestos_trabajo').select('*').eq('activo', true),
        supabase.from('operarios').select('*').eq('activo', true),
        supabase.from('causas_demora').select('*').eq('activa', true),
        supabase.from('ordenes_fabricacion').select('*').in('estado', ['pendiente', 'en_proceso']),
        supabase.from('etapas_orden').select('*').in('estado', ['pendiente', 'en_proceso', 'demorada']),
      ])

    const errors = [
      sectoresRes.error,
      puestosRes.error,
      operariosRes.error,
      causasRes.error,
      ordenesRes.error,
      etapasRes.error,
    ].filter(Boolean)

    if (errors.length > 0) {
      console.error('[syncCatalogos] errores', errors)
      return null
    }

    await db.transaction(
      'rw',
      [db.sectores, db.puestos, db.operarios, db.causasDemora, db.ordenes, db.etapas],
      async () => {
        await db.sectores.clear()
        await db.sectores.bulkPut((sectoresRes.data ?? []) as Sector[])

        await db.puestos.clear()
        await db.puestos.bulkPut((puestosRes.data ?? []) as PuestoTrabajo[])

        await db.operarios.clear()
        await db.operarios.bulkPut((operariosRes.data ?? []) as Operario[])

        await db.causasDemora.clear()
        await db.causasDemora.bulkPut((causasRes.data ?? []) as CausaDemora[])

        // Para órdenes/etapas NO hacemos clear total: la etapa/orden puede
        // haber sido modificada localmente y aún no haber sincronizado.
        // Por ahora (MVP sin escritura de etapas desde la PWA) hacemos bulkPut
        // que actualiza por PK sin tocar filas ajenas.
        await db.ordenes.bulkPut((ordenesRes.data ?? []) as OrdenFabricacion[])
        await db.etapas.bulkPut((etapasRes.data ?? []) as EtapaOrden[])
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

/** Lee el timestamp del último sync exitoso de catálogos. */
export async function getLastCatalogosSync(): Promise<string | null> {
  const row = await db.kv.get('catalogos_last_sync')
  return (row?.value as string | undefined) ?? null
}
