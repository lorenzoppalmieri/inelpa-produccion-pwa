import { registerSW } from 'virtual:pwa-register'

/**
 * Registro del service worker de vite-plugin-pwa.
 * autoUpdate → cuando hay nueva versión, se aplica al próximo reload.
 * En planta preferimos que los PC panel tomen actualizaciones en caliente
 * sin requerir acción del operario.
 */
export function registerServiceWorker() {
  if (import.meta.env.DEV && !import.meta.env.VITE_ENABLE_PWA_DEV) {
    // En dev, evitar el SW salvo que lo pidamos explícitamente
    return
  }

  registerSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      console.info('[PWA] Service worker registrado:', swUrl)
      // Chequeo de actualizaciones cada 60s
      if (registration) {
        setInterval(() => {
          registration.update().catch(() => {
            /* sin red, ignorar */
          })
        }, 60_000)
      }
    },
    onOfflineReady() {
      console.info('[PWA] App lista para usar offline')
    },
    onNeedRefresh() {
      console.info('[PWA] Nueva versión disponible — se aplicará en el próximo reload')
    },
  })
}
