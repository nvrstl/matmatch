import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import App from './App'
import { IS_STATIC } from './lib/api'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A published snapshot runs inside a frame where URL paths don't exist, so route in memory there. */}
    {IS_STATIC ? (
      <MemoryRouter>
        <App />
      </MemoryRouter>
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
)
