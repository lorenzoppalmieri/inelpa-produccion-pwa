import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import type { PuestoTrabajo, SectorCodigo, TipoPuesto } from '../types'

/**
 * Modal para elegir en qué puesto (máquina, box o equipo) va a trabajar
 * el operario al iniciar una etapa.
 *
 * Diseño:
 *  - Pre-selecciona el puesto habitual del operario si lo tiene.
 *  - Agrupa visualmente por tipo (máquinas, boxes, equipos).
 *  - Si hay un solo puesto en el sector (típico de montajes con un equipo
 *    único), igual se muestra el modal — un tap para confirmar — para que
 *    el flujo sea siempre el mismo y no haya sorpresas.
 */

interface Props {
  sectorCodigo: SectorCodigo
  puestoHabitualId: string | null
  onCancel: () => void
  onConfirm: (puesto: PuestoTrabajo) => void
}

const LABEL_TIPO: Record<TipoPuesto, string> = {
  maquina: 'Máquinas',
  box: 'Boxes',
  equipo: 'Equipos',
}

const ORDEN_TIPOS: TipoPuesto[] = ['maquina', 'box', 'equipo']

export default function PuestoSelectorModal({
  sectorCodigo,
  puestoHabitualId,
  onCancel,
  onConfirm,
}: Props) {
  const puestos = useLiveQuery<PuestoTrabajo[]>(
    async () => {
      const rows = await db.puestos
        .where('sector_codigo')
        .equals(sectorCodigo)
        .toArray()
      return rows.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre))
    },
    [sectorCodigo],
    [],
  )

  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(puestoHabitualId)

  // Si el puesto habitual no está en la lista (fue desactivado, o el operario
  // no tiene uno asignado), pre-seleccionar el primero.
  useEffect(() => {
    if (!puestos.length) return
    const existe = puestos.some((p) => p.id === seleccionadoId)
    if (!existe) setSeleccionadoId(puestos[0].id)
  }, [puestos, seleccionadoId])

  const porTipo = useMemo(() => {
    const map = new Map<TipoPuesto, PuestoTrabajo[]>()
    for (const p of puestos) {
      const arr = map.get(p.tipo) ?? []
      arr.push(p)
      map.set(p.tipo, arr)
    }
    return ORDEN_TIPOS.map((t) => [t, map.get(t) ?? []] as const).filter(
      ([, arr]) => arr.length > 0,
    )
  }, [puestos])

  const confirmar = () => {
    const elegido = puestos.find((p) => p.id === seleccionadoId)
    if (elegido) onConfirm(elegido)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <header className="p-5 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-touch-lg font-bold">¿En qué puesto vas a trabajar?</h2>
            <p className="text-xs text-slate-400 mt-1">
              Podés cambiar de máquina/box si hoy no es el habitual.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {puestos.length === 0 && (
            <p className="text-slate-400 text-center py-8">
              No hay puestos configurados para tu sector. Avisale al admin.
            </p>
          )}

          {porTipo.map(([tipo, lista]) => (
            <div key={tipo}>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                {LABEL_TIPO[tipo]}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {lista.map((p) => {
                  const activa = seleccionadoId === p.id
                  const esHabitual = p.id === puestoHabitualId
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSeleccionadoId(p.id)}
                      className={`relative p-4 rounded-lg border text-left transition ${
                        activa
                          ? 'bg-inelpa-accent text-slate-900 border-inelpa-accent'
                          : 'bg-slate-800 border-slate-700 hover:border-slate-500 text-slate-200'
                      }`}
                    >
                      <div className="font-bold text-touch-base">{p.nombre}</div>
                      {esHabitual && (
                        <span
                          className={`absolute top-2 right-2 text-[10px] uppercase font-bold tracking-wider ${
                            activa ? 'text-slate-800' : 'text-inelpa-accent'
                          }`}
                        >
                          habitual
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-5 border-t border-slate-700 flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary !min-h-0 !py-3">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!seleccionadoId}
            className="btn-primary !min-h-0 !py-3"
          >
            Iniciar acá
          </button>
        </div>
      </div>
    </div>
  )
}
