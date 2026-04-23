/**
 * Gate de acceso al tablero de supervisor.
 *
 * Idéntico en filosofía al adminAuth: sessionStorage (sesión por pestaña),
 * PIN de 4 dígitos configurable vía VITE_SUPERVISOR_PIN (fallback 8888).
 *
 * ¿Por qué un PIN separado del admin? Un jefe de sector debería poder ver
 * el tablero sin tener permisos para crear/cancelar órdenes.
 */

const SESSION_KEY = 'inelpa_supervisor_unlocked'
const DEFAULT_PIN = '8888'

function getSupervisorPin(): string {
  const configured = import.meta.env.VITE_SUPERVISOR_PIN
  return (configured && String(configured).trim()) || DEFAULT_PIN
}

export function esSupervisorDesbloqueado(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function desbloquearSupervisor(pinIngresado: string): boolean {
  if (pinIngresado === getSupervisorPin()) {
    sessionStorage.setItem(SESSION_KEY, '1')
    return true
  }
  return false
}

export function bloquearSupervisor() {
  sessionStorage.removeItem(SESSION_KEY)
}
