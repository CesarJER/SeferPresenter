import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  cacheDir: join(tmpdir(), 'sefer-astra-ui-cache'),
  plugins: [react()],
  test: { environment: 'jsdom', include: ['docs/audits/2026-09-29/astra-red-team/harness/ui-review.test.tsx'], maxWorkers: 1 },
});
