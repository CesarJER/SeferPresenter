import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  base: '/',
})
