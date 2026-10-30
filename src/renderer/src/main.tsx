import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist'
import './styles.css'

if (/Mac/.test(navigator.userAgent)) document.documentElement.dataset.platform = 'mac'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
