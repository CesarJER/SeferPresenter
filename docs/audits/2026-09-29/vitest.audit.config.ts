import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Audit runner: cache outside the checkout; no corpus generator or application startup.
export default defineConfig({
  cacheDir: join(tmpdir(), 'sefer-audit-vite-cache'),
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.*', 'docs/audits/2026-09-29/runtime-evidence.test.ts'],
    exclude: ['__tests__/generateVerses.test.ts'],
  },
});
