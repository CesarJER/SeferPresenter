import { UiLocaleProvider } from './i18n/UiLocaleProvider';
import React from 'react'
import { createRoot } from 'react-dom/client'
import { CatalogApp } from './components/catalog/CatalogApp'
import './index.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <React.StrictMode><UiLocaleProvider role="catalog">
      <CatalogApp />
    </UiLocaleProvider></React.StrictMode>
  )
}
