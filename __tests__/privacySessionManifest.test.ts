import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPrivacySessionManifestRecorder } from '../server/privacy-session-manifest.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sefer-privacy-manifest-'));
  temporaryDirectories.push(root);
  const publicDir = path.join(root, 'public');
  const manifestDir = path.join(root, 'audit.local', 'session-manifests.local');
  await mkdir(path.join(publicDir, 'legal'), { recursive: true });
  await writeFile(
    path.join(publicDir, 'legal', 'privacy.md'),
    '# Política\n\nVersión: test-policy-v1\n',
    'utf8',
  );
  return { manifestDir, publicDir };
};

describe('privacy session manifest recorder', () => {
  it('writes one non-nominative manifest for a completed recording interval', async () => {
    const { manifestDir, publicDir } = await setup();
    const recorder = createPrivacySessionManifestRecorder({
      manifestDir,
      publicDir,
      policyPath: '/legal/privacy.md',
      channels: 'youtube,telegram,INVALID CHANNEL,telegram',
      softwareVersion: 'phase-10-test',
      noticeVersion: 'microphone-v2',
      createId: () => '11111111-1111-4111-8111-111111111111',
    });

    await recorder.recordTransition({ nextState: 'live', updatedAt: Date.UTC(2026, 6, 31, 18, 0) });
    await recorder.recordTransition({ nextState: 'recording', updatedAt: Date.UTC(2026, 6, 31, 18, 5) });
    await recorder.recordTransition({ nextState: 'off', updatedAt: Date.UTC(2026, 6, 31, 19, 0) });

    const files = await readdir(manifestDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.local\.json$/);
    const manifest = JSON.parse(await readFile(path.join(manifestDir, files[0]), 'utf8'));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      manifestId: '11111111-1111-4111-8111-111111111111',
      status: 'completed',
      channels: ['youtube', 'telegram'],
      softwareVersion: 'phase-10-test',
      noticeVersion: 'microphone-v2',
      outcome: 'broadcast-stopped',
      containsPersonalData: false,
      policy: {
        path: '/legal/privacy.md',
        version: 'test-policy-v1',
      },
    });
    expect(manifest.policy.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.startedAt).toBe('2026-07-31T18:05:00.000Z');
    expect(manifest.endedAt).toBe('2026-07-31T19:00:00.000Z');
    expect(JSON.stringify(manifest)).not.toMatch(/alias|participant|sessionId|ipAddress|quiz|voice/i);
  });

  it('does not create a manifest when recording is never declared', async () => {
    const { manifestDir, publicDir } = await setup();
    const recorder = createPrivacySessionManifestRecorder({ manifestDir, publicDir });
    await recorder.recordTransition({ nextState: 'live', updatedAt: Date.now() });
    await recorder.recordTransition({ nextState: 'off', updatedAt: Date.now() });
    await expect(readdir(manifestDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
