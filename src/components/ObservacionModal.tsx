import { useState } from 'react'

interface Props {
  titulo: string
  placeholder?: string
  onCancel: () => void
  onConfirm: (texto: string) => void
}

/**
 * Modal simple para capturar una observación de texto libre.
 * Se usa actualmente para el control de calidad.
 */
export default function ObservacionModal({ titulo, placeholder, onCancel, onConfirm }: Props) {
  const [texto, setTexto] = useState('')

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col">
        <header className="p-5 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-touch-lg font-bold">{titulo}</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-white text-2xl leading-none">
            ×
          </button>
        </header>

        <div className="p-5">
          <textarea
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={placeholder ?? 'Escribí tu observación…'}
            rows={5}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600
                       text-slate-100 placeholder:text-slate-500
                       focus:outline-none focus:border-inelpa-accent"
          />
        </div>

        <div className="p-5 border-t border-slate-700 flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary !min-h-0 !py-3">
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(texto.trim())}
            disabled={texto.trim().length === 0}
            className="btn-primary !min-h-0 !py-3"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
