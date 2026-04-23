import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { registerServiceWorker } from './lib/registerSW'
import { SessionProvider } from './context/SessionContext'
import { startSyncLoop } from './db/sync'
import { syncCatalogos } from './db/syncCatalogos'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

// Service worker (offline + update prompt)
registerServiceWorker()

// Sync de catálogos al arrancar y cuando vuelva la conexión.
void syncCatalogos()
window.addEventListener('online', () => {
  void syncCatalogos()
})

// Loop de sync de eventos pendientes (cada 30 s).
startSyncLoop()
