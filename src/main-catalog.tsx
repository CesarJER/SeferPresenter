import React from 'react'
import { createRoot } from 'react-dom/client'
import { CatalogApp } from './components/catalog/CatalogApp'
import './index.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <CatalogApp />
    </React.StrictMode>
  )
}
