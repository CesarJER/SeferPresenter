import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';

let child: ChildProcess | undefined;
let dataDir: string | undefined;
const sockets: WebSocket[] = [];
const headers = { Authorization: `Basic ${Buffer.from('control:synthetic-password').toString('base64')}` };
afterEach(async () => {
  sockets.forEach(ws => ws.terminate()); sockets.length = 0;
  if (child && child.exitCode === null) {
    const exited = new Promise<void>(resolve => child!.once('exit', () => resolve())); child.kill(); await exited;
  }
  if (dataDir) {
    if (path.dirname(path.resolve(dataDir)) !== path.resolve(os.tmpdir()) || !path.basename(dataDir).startsWith('sefer-remediation-')) throw new Error('Unexpected cleanup target');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  child = undefined; dataDir = undefined;
});
async function start(authRequired = true) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-remediation-'));
  const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const address = reserve.address(); if (!address || typeof address === 'string') throw new Error('Address required');
  const port = address.port; await new Promise<void>(resolve => reserve.close(() => resolve()));
  child = spawn(process.execPath, ['server/local-server.mjs'], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env, SEFER_DATA_DIR: dataDir, SEFER_PORT: String(port), SEFER_REQUIRE_AUTH: String(authRequired),
    SEFER_CONTROL_PASSWORD: 'synthetic-password', SEFER_LIVE_AUDIO_ENABLED: 'false', SEFER_VOICE_SCRIPTURE_ENABLED: 'false',
  } });
  const base = `http://127.0.0.1:${port}`;
  await vi.waitFor(async () => expect((await fetch(`${base}/api/health`)).ok).toBe(true), { timeout: 5000 });
  const connect = (role = 'control', controlSessionId?: string) => new Promise<{ ws: WebSocket; welcome: Record<string, string> }>((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?role=${role}${controlSessionId ? `&controlSessionId=${encodeURIComponent(controlSessionId)}` : ''}`, { headers }); sockets.push(ws);
    ws.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.type === 'WELCOME') resolve({ ws, welcome: message }); });
    ws.on('error', reject);
  });
  const post = (route: string, body: unknown, credential?: string, etag?: string) => fetch(`${base}${route}`, { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', ...(credential ? { 'X-Sefer-Operator-Credential': credential } : {}), ...(etag ? { 'If-Match': etag } : {}) }, body: JSON.stringify(body) });
  return { base, connect, post };
}
it.each([true, false])('clears controlled quiz aggregates only for active Controls (auth=%s)', async (authRequired) => {
  const { connect, post } = await start(authRequired);
  const principal = await connect();
  const pending = await connect('control');
  const presenter = await connect('presenter');
  const audience = await connect('audience');
  const presentationId = 'release-quiz';
  expect((await post('/api/state', {
    clientId: principal.welcome.clientId, slideIndex: 0,
    presentation: { id: presentationId, title: 'Synthetic quiz', mode: 'trilingual', background: '',
      slides: [{ id: 'q1', label: 'Question', lines: ['Synthetic'] }] },
  }, principal.welcome.operatorCredential)).status).toBe(200);
  for (const slideId of ['q1', 'q2']) {
    for (let i = 0; i < 3; i++) {
      expect((await post('/api/quiz-answer', { type: 'QUIZ_ANSWER_AGGREGATE', presentationId,
        slideId, submissionId: `${slideId}-${i}`, selectedOptionIds: ['A'] })).status).toBe(200);
    }
  }
  const controlled = new Promise<void>(resolve => principal.ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'SESSION_ACCESS_POLICY' && message.accessMode === 'CONTROLLED') resolve();
  }));
  principal.ws.send(JSON.stringify({ type: 'SESSION_ACCESS_POLICY_UPDATE', accessMode: 'CONTROLLED' }));
  await controlled;
  const clear = { type: 'QUIZ_CLEAR_ANSWERS', presentationId, slideId: 'q1' };
  expect((await post('/api/quiz-answer', clear, principal.welcome.operatorCredential)).status).toBe(200);
  const snapshot = await (await post('/api/quiz-control-state', { presentationId })).json();
  expect(snapshot.aggregate.slides.q1).toBeUndefined();
  expect(snapshot.aggregate.slides.q2.submittedCount).toBe(3);
  for (const credential of [undefined, pending.welcome.operatorCredential, presenter.welcome.operatorCredential, audience.welcome.operatorCredential]) {
    expect((await post('/api/quiz-answer', { ...clear, slideId: 'q2' }, credential)).status).toBe(403);
  }
  expect((await post('/api/quiz-answer', { type: 'QUIZ_ANSWER_AGGREGATE', presentationId,
    slideId: 'q2', submissionId: 'not-admitted', selectedOptionIds: ['B'] })).status).toBe(401);
  const closed = new Promise<void>(resolve => principal.ws.once('close', () => resolve()));
  principal.ws.close(); await closed;
  expect((await post('/api/quiz-answer', { ...clear, slideId: 'q2' }, principal.welcome.operatorCredential)).status).toBe(403);
}, 10000);
it('blocks pending/copy-ID HTTP mutations, allows Presenter telemetry and reenters after soft reset', async () => {
  const { base, connect, post } = await start();
  const principal = await connect(); const pending = await connect('control', principal.welcome.controlSessionId);
  expect(pending.welcome.controlSessionId).not.toBe(principal.welcome.controlSessionId); const presenter = await connect('presenter');
  expect(pending.welcome.controlState).toBe('PENDING');
  for (const route of ['/api/command', '/api/state', '/api/audio-telemetry', '/api/video-telemetry', '/api/display-telemetry']) {
    const response = await post(route, { controlSessionId: principal.welcome.controlSessionId }, pending.welcome.operatorCredential);
    expect(response.status).toBe(403);
  }
  const approval = new Promise<void>(resolve => pending.ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && msg.controlState === 'AUTHORIZED') resolve();
  }));
  principal.ws.send(JSON.stringify({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: pending.welcome.controlSessionId, decision: 'APPROVE', createdAt: Date.now() }));
  await approval;
  const telemetry = { type: 'DISPLAY_TELEMETRY', clientId: 'presenter', backgroundLock: false, lockedBackgroundValue: null, userSelectedBackground: null };
  expect((await post('/api/display-telemetry', telemetry, presenter.welcome.operatorCredential)).status).toBe(200);
  expect((await post('/api/display-telemetry', telemetry, pending.welcome.operatorCredential)).status).toBe(200);
  expect((await post('/api/command', {}, presenter.welcome.operatorCredential)).status).toBe(403);
  expect((await post('/api/state', {})).status).toBe(403);
  const before = await (await fetch(`${base}/api/state`, { headers })).json();
  const closed = new Promise<void>(resolve => principal.ws.once('close', () => resolve()));
  const reset = await post('/api/command', { type: 'REMOTE_COMMAND', clientId: principal.welcome.clientId, payload: { command: 'RESET_STATE', clearSession: true, hardRefresh: false } }, principal.welcome.operatorCredential);
  expect(reset.status).toBe(200); await closed;
  expect((await post('/api/state', before, principal.welcome.operatorCredential)).status).toBe(403);
  const reentered = await connect(); expect(reentered.welcome.controlState).toBe('PRINCIPAL');
  expect(reentered.welcome.operatorCredential).not.toBe(principal.welcome.operatorCredential);
  expect((await post('/api/state', before, reentered.welcome.operatorCredential)).status).toBe(200);
  const audience = await connect('audience'); expect(audience.welcome.operatorCredential).toBeUndefined();
}, 10000);
it('rejects stale catalog replacements and emits audio-map invalidation only after persistence', async () => {
  const { base, post } = await start();
  const catalog = await fetch(`${base}/api/presentations`, { headers }); const initial = await catalog.json();
  const etag = catalog.headers.get('ETag')!; expect(catalog.headers.get('Cache-Control')).toBe('no-store');
  const item = { id: 'synthetic', title: 'First edit', mode: 'trilingual', background: '', slides: [{ id: 's', label: 's', lines: ['a'] }] };
  expect((await post('/api/presentations', [...initial, item], undefined, etag)).status).toBe(200);
  expect((await post('/api/presentations', [...initial, { ...item, title: 'Stale edit' }], undefined, etag)).status).toBe(412);
  expect((await (await fetch(`${base}/api/presentations`, { headers })).json()).at(-1).title).toBe('First edit');
  expect((await post('/api/presentations', initial)).status).toBe(428);
  const stream = await fetch(`${base}/api/state-events`, { headers, signal: AbortSignal.timeout(3000) });
  const reader = stream.body!.getReader(); await reader.read();
  const maps = await fetch(`${base}/api/audio-sync`, { headers });
  const map = { id: 'sync', name: 'Synthetic map', defaultSyncMode: 'unilateral', defaultVolume: 0.7, audioSrc: '/audio/test.mp3', presentationId: item.id, cues: [{ slideIndex: 0, timeSec: 1 }] };
  expect((await post('/api/audio-sync', [map], undefined, maps.headers.get('ETag')!)).status).toBe(200);
  let received = '';
  while (!received.includes('AUDIO_SYNC_MAPS_UPDATE')) received += new TextDecoder().decode((await reader.read()).value);
  expect(received).toContain('Synthetic map'); await reader.cancel();
}, 10000);

it.each(['', '-gzip', '-zstd'])('accepts current catalog revisions through Caddy encoding %s and rejects stale ones', async (suffix) => {
  const { base, post } = await start();
  const presentation = { id: 'encoded', title: 'First save', mode: 'standard', background: '', slides: [{ id: 's', label: 's', lines: ['a'] }] };
  const map = { id: 'encoded', name: 'First save', defaultSyncMode: 'unilateral', defaultVolume: 0.7, audioSrc: '/audio/test.mp3', presentationId: presentation.id, cues: [{ slideIndex: 0, timeSec: 1 }] };
  for (const [route, item, field] of [
    ['/api/presentations', presentation, 'title'],
    ['/api/audio-sync', map, 'name'],
  ] as const) {
    const initial = await fetch(`${base}${route}`, { headers });
    const revision = initial.headers.get('ETag')!;
    await initial.body!.cancel();
    const encoded = revision.slice(0, -1) + suffix + '"';
    const first = await post(route, [item], undefined, encoded);
    expect(first.status).toBe(200);
    const next = first.headers.get('ETag')!;
    expect(next).not.toBe(revision);
    const edited = [{ ...item, [field]: 'Second save' }];
    const second = await post(route, edited, undefined, next.slice(0, -1) + suffix + '"');
    expect(second.status).toBe(200);
    const current = second.headers.get('ETag')!;
    for (const invalid of [encoded, '*', `W/${current}`, current.slice(0, -1) + '-unknown"', `${current}, ${revision}`]) {
      expect((await post(route, [item], undefined, invalid)).status).toBe(412);
    }
    expect((await post(route, [item])).status).toBe(428);
    expect(await (await fetch(`${base}${route}`, { headers })).json()).toEqual(edited);
  }
}, 10000);
