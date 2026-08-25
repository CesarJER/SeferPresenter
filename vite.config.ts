import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { existsSync, readdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { loadEnv } from 'vite'

const backendTarget = 'http://localhost:8787'
const reservedPublicEntries = new Set([
  '@vite',
  'api',
  'assets',
  'audio-editor',
  'audio-editor.html',
  'audience',
  'audience.html',
  'catalog',
  'catalog.html',
  'control',
  'control.html',
  'presenter',
  'presenter.html',
  'src',
  'ws',
])

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getOperatorPublicProxies = (mode: string) => {
  const env = loadEnv(mode, __dirname, '')
  const configuredDataDir = process.env.SEFER_DATA_DIR?.trim() || env.SEFER_DATA_DIR?.trim() || 'data.local'
  const dataDir = isAbsolute(configuredDataDir)
    ? resolve(configuredDataDir)
    : resolve(__dirname, configuredDataDir)
  const operatorPublicDir = resolve(dataDir, 'public')
  if (!existsSync(operatorPublicDir)) return {}

  return Object.fromEntries(
    readdirSync(operatorPublicDir, { withFileTypes: true })
      .filter((entry) => !reservedPublicEntries.has(entry.name))
      .map((entry) => [
        `^/${escapeRegex(entry.name)}${entry.isDirectory() ? '(?:/|$)' : '(?:\\?|$)'}`,
        backendTarget,
      ]),
  )
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  publicDir: 'static',
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.*'],
  },
  plugins: [react()],
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
      ...getOperatorPublicProxies(mode),
      '/api': backendTarget,
      '/legal': backendTarget,
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
    },
  },
  base: '/',
}))
