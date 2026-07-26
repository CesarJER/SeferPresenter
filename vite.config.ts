import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildOperatorManifest } from './server/operator-config.mjs'
import { createAudienceServiceWorkerSource } from './server/pwa-build.mjs'

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
  const audienceServiceWorkerPlugin: Plugin = {
    name: 'sefer-audience-service-worker',
    enforce: 'post',
    generateBundle(_, bundle) {
      const template = readFileSync(resolve(__dirname, 'public/audience-sw.js'), 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'audience-sw-build.js',
        source: createAudienceServiceWorkerSource(
          template,
          Object.values(bundle).map((output) => output.fileName),
        ),
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
      pool: 'threads',
      fileParallelism: false,
    },
    plugins: [react(), operatorManifestPlugin, audienceServiceWorkerPlugin],
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
