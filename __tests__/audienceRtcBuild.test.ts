import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

it.each(['true', 'false'].flatMap(flag => ['audience', 'control'].map(entry => ({ flag, entry }))))('builds the real $entry entry with RTC build=$flag and inspects included modules', async ({ flag, entry }) => {
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
        if (flag === 'false' && (/\/livekit-client\//.test(normalized) || /\/LiveAudio(Audience|Control)Container\.tsx$/.test(normalized) || normalized.endsWith('/useLiveAudio.ts'))) {
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
      write: false, outDir: resolve(root, 'tmp/p1c-build-validation', entry, flag),
      rolldownOptions: { input: resolve(root, `${entry}.html`) },
    },
  });
  for (const module of entry === 'audience'
    ? ['main-audience.tsx', 'hooks/useAudienceParticipation.ts', 'components/audience/AudienceParticipationSurface.tsx', 'components/audience/AudienceParticipationPanel.tsx', 'components/audience/AudienceScreen.tsx']
    : ['main-control.tsx', 'components/control/ControlParticipationOwner.tsx', 'hooks/useControlConversations.ts', 'features/liveAudio/components/control/PrivateControlInbox.tsx', 'features/liveAudio/components/control/LiveAudioControlPanel.tsx']) {
    expect([...included].some(id => id.endsWith('/src/' + module)), module).toBe(true);
  }
  expect([...included].some(id => id.includes('/livekit-client/'))).toBe(flag === 'true');
  expect([...loaded].some(id => id.endsWith(entry === 'audience' ? '/LiveAudioAudienceContainer.tsx' : '/LiveAudioControlContainer.tsx'))).toBe(flag === 'true');
}, 90000);
