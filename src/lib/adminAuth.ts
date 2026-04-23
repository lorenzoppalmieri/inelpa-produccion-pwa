/**
 * Gate de acceso al panel admin.
 *
 * Por qué sessionStorage (y no Dexie.kv como la sesión de operario):
 *  - El admin NO debe quedar logueado entre sesiones/reinicios del PC panel.
 *  - Al cerrar la pestaña del navegador se desloguea solo.
 *  - Es síncrono → no necesitamos estado global/provider para este gate.
 *
 * El PIN admin se lee de VITE_ADMIN_PIN. Si no está configurado, usa '9999'
 * como fallback (sólo para desarrollo; en producción se debe definir en
 * el .env.local del PC panel).
 */

const SESSION_KEY = 'inelpa_admin_unlocked'
const DEFAULT_PIN = '9999'

function getAdminPin(): string {
  const configured = import.meta.env.VITE_ADMIN_PIN
  return (configured && String(configured).trim()) || DEFAULT_PIN
}

export function esAdminDesbloqueado(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function desbloquearAdmin(pinIngresado: string): boolean {
  if (pinIngresado === getAdminPin()) {
    sessionStorage.setItem(SESSION_KEY, '1')
    return true
  }
  return false
}

export function bloquearAdmin() {
  sessionStorage.removeItem(SESSION_KEY)
}
