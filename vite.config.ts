import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        presenter: resolve(__dirname, 'presenter.html'),
        audience: resolve(__dirname, 'audience.html'),
        control: resolve(__dirname, 'control.html'),
        audioEditor: resolve(__dirname, 'audio-editor.html'),
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
})
