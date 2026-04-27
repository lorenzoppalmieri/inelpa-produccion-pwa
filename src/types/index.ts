/**
 * Tipos del dominio de Inelpa · Registro de Producción.
 * Mantener sincronizado con el esquema SQL en supabase/migrations/.
 */

// -----------------------------------------------------------------
// Enums — siempre mantenerlos idénticos al SQL
// -----------------------------------------------------------------

export type SectorCodigo =
  | 'bobinado-at'
  | 'bobinado-bt'
  | 'herreria'
  | 'montajes-pa'
  | 'montajes-ph'

export type CategoriaCausa =
  | 'ESPERA_MATERIAL'
  | 'ESPERA_HERRAMIENTA'
  | 'RETRABAJO'
  | 'EQUIPO'
  | 'CALIDAD'
  | 'PERSONAL'
  | 'EXTERNO'
  | 'OPERATIVA'
  | 'OTRO'

export type EstadoEtapa =
  | 'pendiente'
  | 'en_proceso'
  | 'demorada'
  | 'completada'

export type EstadoOrden =
  | 'pendiente'
  | 'en_proceso'
  | 'completada'
  | 'cancelada'

export type TipoEvento =
  | 'INICIO'
  | 'FIN'
  | 'DEMORA_INICIO'
  | 'DEMORA_FIN'
  | 'CONTROL_CALIDAD'

export type TipoPuesto = 'maquina' | 'box' | 'equipo'

export type SyncStatus = 'pending' | 'synced' | 'error'

// Catálogo de productos
export type FamiliaPT =
  | 'TMR07V' | 'TMR19V'
  | 'TBR13V' | 'TBR33V'
  | 'TTR13V' | 'TTR33V'
  | 'TTD13V' | 'TTD33V'

export type FamiliaSE =
  | 'BOBALT' | 'BOBBAJ'
  | 'CUBRUR' | 'CUBDIS'
  | 'TANDIS'
  | 'TAPRUR' | 'TAPDIS'
  | 'PARRUR' | 'PARDIS'

export type TipoTransformador = 'monofasico' | 'bifasico' | 'trifasico'
export type TipoItem = 'semielaborado' | 'ensamble_final'
export type FaseBobina = 'F1' | 'F2' | 'F3'
export type Conductor = 'CU' | 'AL'

// -----------------------------------------------------------------
// Catálogos
// -----------------------------------------------------------------

export interface Sector {
  codigo: SectorCodigo
  nombre: string
  orden_secuencia: number
  activo: boolean
}

export interface PuestoTrabajo {
  id: string
  sector_codigo: SectorCodigo
  nombre: string
  tipo: TipoPuesto
  activo: boolean
}

export interface Operario {
  id: string
  pin: number
  nombre: string
  apellido: string
  sector_codigo: SectorCodigo
  puesto_trabajo_id: string | null
  activo: boolean
}

export interface CausaDemora {
  codigo: string // 'DEM-001'
  descripcion: string
  categoria: CategoriaCausa
  sectores_aplicables: SectorCodigo[]
  activa: boolean
  notas?: string
}

export interface ProductoTerminado {
  codigo: string // 'TTD13V0000001'
  descripcion: string
  familia: FamiliaPT
  tipo: TipoTransformador
  potencia_kva: number
  tension_kv: number
  conductor: Conductor
  diseno_cuba: string | null
  lleva_tanque_expansion: boolean
  activo: boolean
}

export interface Semielaborado {
  codigo: string // 'BOBALT0000096'
  descripcion: string
  familia: FamiliaSE
  sector_codigo: SectorCodigo
  potencia_kva: number | null
  tension_kv: number | null
  conductor: Conductor | null
  aplicacion: 'rural' | 'distribucion' | null
  tipo: TipoTransformador | null
  diseno_cuba: string | null
  variante: string | null
  forma: string | null
  fase: FaseBobina | null
  activo: boolean
}

export interface BomItem {
  id: string
  producto_terminado_codigo: string
  semielaborado_codigo: string
  cantidad: number
  fase: FaseBobina | null
}

// -----------------------------------------------------------------
// Operación
// -----------------------------------------------------------------

export interface OrdenFabricacion {
  id: string
  codigo: string
  descripcion: string | null
  cliente: string | null
  estado: EstadoOrden
  fecha_entrega_estimada: string | null
  producto_terminado_codigo: string | null
  cantidad_unidades: number
  prioridad: number
}

/**
 * Un ítem es UNA pieza física a fabricar para una orden:
 *   - una bobina F1, F2 o F3 (BOBALT/BOBBAJ)
 *   - una cuba, tapa, tanque o parte activa
 *   - un ensamble final (montajes-ph)
 *
 * El planificador asigna puesto + operario + fechas antes de que
 * el operario lo vea en su cola.
 */
export interface ItemOrden {
  id: string
  orden_id: string
  tipo: TipoItem
  semielaborado_codigo: string | null
  producto_terminado_codigo: string | null
  unidad_index: number
  fase: FaseBobina | null
  codigo_interno_fabricacion: string | null
  sector_codigo: SectorCodigo
  puesto_trabajo_id: string | null
  operario_id: string | null
  inicio_planificado: string | null
  fin_planificado: string | null
  estado: EstadoEtapa
  inicio_real_at: string | null
  fin_real_at: string | null
  prioridad: number
}

/**
 * Evento de producción. id se genera en cliente (UUID v4) para offline-first.
 */
export interface Evento {
  id: string
  item_orden_id: string
  operario_id: string
  puesto_trabajo_id: string | null
  tipo: TipoEvento
  timestamp: string
  causa_demora_codigo?: string
  evento_demora_inicio_id?: string
  observacion?: string
  cliente_timestamp: string
  cliente_online: boolean

  // Locales (no van a Supabase)
  sync_status: SyncStatus
  sync_error?: string
  sync_attempted_at?: string
}

// -----------------------------------------------------------------
// Tipos compuestos / convenientes para UI
// -----------------------------------------------------------------

/** Item con datos de orden + descripción de la pieza, para listas */
export interface ItemConDetalle extends ItemOrden {
  orden: Pick<OrdenFabricacion, 'codigo' | 'descripcion' | 'cliente' | 'cantidad_unidades'>
  pieza_codigo: string
  pieza_descripcion: string
  puesto_nombre: string | null
  operario_nombre: string | null
}

export interface DemoraPareada {
  demora_inicio_id: string
  demora_fin_id: string | null
  item_orden_id: string
  operario_id: string
  causa_demora_codigo: string
  causa_descripcion: string
  categoria: CategoriaCausa
  inicio_at: string
  fin_at: string | null
  duracion_minutos: number | null
  observacion: string | null
}
