import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { buildOperatorManifest } from './server/operator-config.mjs'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const operatorManifest = buildOperatorManifest({
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env,
  })
  const operatorManifestPlugin: Plugin = {
    name: 'sefer-operator-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'operator-manifest.json',
        source: `${JSON.stringify(operatorManifest, null, 2)}\n`,
      })
    },
  }

  return {
    define: {
      __SEFER_OPERATOR_CONFIG__: JSON.stringify(operatorManifest),
    },
    test: {
      environment: 'node',
      include: ['__tests__/**/*.test.*'],
    },
    plugins: [react(), operatorManifestPlugin],
    build: {
      rollupOptions: {
        input: {
          presenter: resolve(__dirname, 'presenter.html'),
          audience: resolve(__dirname, 'audience.html'),
          control: resolve(__dirname, 'control.html'),
          audioEditor: resolve(__dirname, 'audio-editor.html'),
          catalog: resolve(__dirname, 'catalog.html'),
        },
      },
    },
    server: {
      proxy: {
        '/api': 'http://localhost:8787',
        '/ws': {
          target: 'ws://localhost:8787',
          ws: true,
        },
      },
    },
    base: '/',
  }
})
