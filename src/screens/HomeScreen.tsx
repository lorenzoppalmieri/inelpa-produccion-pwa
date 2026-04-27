import { Navigate } from 'react-router-dom'

/**
 * Componente legacy — el flujo real arranca en /cola (o /login si no hay
 * sesión). Mantenido sólo para no romper imports antiguos.
 */
export default function HomeScreen() {
  return <Navigate to="/cola" replace />
}
