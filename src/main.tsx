import { UiLocaleProvider } from './i18n/UiLocaleProvider';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode><UiLocaleProvider role="presenter">
    <App />
  </UiLocaleProvider></StrictMode>,
)
