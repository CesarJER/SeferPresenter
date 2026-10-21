import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

it.each(['true', 'false'])('builds the real Audience entry with RTC build=%s and inspects included modules', async flag => {
  const loaded = new Set<string>();
  const included = new Set<string>();
  await build({
    root, configFile: false, envDir: false, publicDir: false, logLevel: 'error',
    define: { 'import.meta.env.VITE_SEFER_LIVE_AUDIO_BUILD': JSON.stringify(flag) },
    plugins: [react(), {
      name: 'verify-audience-rtc-boundary',
      load(id) {
        const normalized = id.replaceAll('\\', '/');
        loaded.add(normalized);
        if (flag === 'false' && (/\/livekit-client\//.test(normalized) || normalized.endsWith('/LiveAudioAudienceContainer.tsx') || normalized.endsWith('/useLiveAudio.ts'))) {
          throw new Error(`Excluded RTC module was loaded: ${normalized}`);
        }
      },
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') {
          for (const id of Object.keys(chunk.modules)) included.add(id.replaceAll('\\', '/'));
        }
      },
    }],
    build: {
      write: false, outDir: resolve(root, 'tmp/p1b-build-validation', flag),
      rolldownOptions: { input: resolve(root, 'audience.html') },
    },
  });
  for (const module of ['main-audience.tsx', 'hooks/useAudienceParticipation.ts', 'components/audience/AudienceParticipationSurface.tsx', 'components/audience/AudienceParticipationPanel.tsx', 'components/audience/AudienceScreen.tsx']) {
    expect([...included].some(id => id.endsWith('/src/' + module)), module).toBe(true);
  }
  expect([...included].some(id => id.includes('/livekit-client/'))).toBe(flag === 'true');
  expect([...loaded].some(id => id.endsWith('/LiveAudioAudienceContainer.tsx'))).toBe(flag === 'true');
}, 90000);
