import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/dexie'
import type { CausaDemora, CategoriaCausa, SectorCodigo } from '../types'

/**
 * Modal para elegir la causa de demora antes de iniciar una.
 *
 * UX:
 *  - Filtra automáticamente las causas aplicables al sector del operario.
 *  - Buscador por descripción o código (útil cuando hay 50+ causas).
 *  - Agrupa visualmente por categoría.
 *  - Campo opcional de observación para aclarar.
 */

const CATEGORIA_LABEL: Record<CategoriaCausa, string> = {
  ESPERA_MATERIAL: 'Espera de material',
  ESPERA_HERRAMIENTA: 'Espera de herramienta',
  RETRABAJO: 'Retrabajo',
  EQUIPO: 'Equipo / máquina',
  CALIDAD: 'Calidad',
  PERSONAL: 'Personal',
  EXTERNO: 'Externo',
  OPERATIVA: 'Operativa',
  OTRO: 'Otro',
}

interface Props {
  sectorCodigo: SectorCodigo
  onCancel: () => void
  onConfirm: (causa: CausaDemora, observacion: string | undefined) => void
}

export default function CausaDemoraModal({ sectorCodigo, onCancel, onConfirm }: Props) {
  const causas = useLiveQuery<CausaDemora[]>(
    async () => {
      const todas = await db.causasDemora.toArray()
      return todas
        .filter((c) => c.activa && c.sectores_aplicables.includes(sectorCodigo))
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
    },
    [sectorCodigo],
    [],
  )

  const [filtro, setFiltro] = useState('')
  const [seleccion, setSeleccion] = useState<CausaDemora | null>(null)
  const [obs, setObs] = useState('')

  const filtradas = useMemo(() => {
    if (!filtro.trim()) return causas
    const q = filtro.toLowerCase()
    return causas.filter(
      (c) =>
        c.descripcion.toLowerCase().includes(q) ||
        c.codigo.toLowerCase().includes(q) ||
        CATEGORIA_LABEL[c.categoria].toLowerCase().includes(q),
    )
  }, [causas, filtro])

  const porCategoria = useMemo(() => {
    const map = new Map<CategoriaCausa, CausaDemora[]>()
    for (const c of filtradas) {
      const arr = map.get(c.categoria) ?? []
      arr.push(c)
      map.set(c.categoria, arr)
    }
    return Array.from(map.entries())
  }, [filtradas])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <header className="p-5 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-touch-lg font-bold">Causa de demora</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-2xl leading-none">
            ×
          </button>
        </header>

        <div className="p-5 border-b border-slate-700">
          <input
            autoFocus
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por descripción o código…"
            className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-600
                       text-touch-base text-slate-100 placeholder:text-slate-500
                       focus:outline-none focus:border-inelpa-accent"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {porCategoria.length === 0 && (
            <p className="text-slate-400 text-center py-8">
              No hay causas que coincidan con la búsqueda.
            </p>
          )}
          {porCategoria.map(([cat, lista]) => (
            <div key={cat}>
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
                {CATEGORIA_LABEL[cat]}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {lista.map((c) => {
                  const activa = seleccion?.codigo === c.codigo
                  return (
                    <button
                      key={c.codigo}
                      onClick={() => setSeleccion(c)}
                      className={`text-left p-3 rounded-lg border transition ${
                        activa
                          ? 'bg-inelpa-accent text-slate-900 border-inelpa-accent'
                          : 'bg-slate-800 border-slate-700 hover:border-slate-500 text-slate-200'
                      }`}
                    >
                      <div className="font-bold text-sm">{c.codigo}</div>
                      <div className="text-sm">{c.descripcion}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-5 border-t border-slate-700 space-y-3">
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Observación (opcional)"
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600
                       text-slate-100 placeholder:text-slate-500
                       focus:outline-none focus:border-inelpa-accent"
          />
          <div className="flex gap-3 justify-end">
            <button onClick={onCancel} className="btn-secondary !min-h-0 !py-3">
              Cancelar
            </button>
            <button
              onClick={() => seleccion && onConfirm(seleccion, obs.trim() || undefined)}
              disabled={!seleccion}
              className="btn-primary !min-h-0 !py-3"
            >
              Confirmar demora
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
