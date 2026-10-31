import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { request, type ClientRequest } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';

let child: ChildProcess | undefined;
let dataDir: string | undefined;
const sockets: WebSocket[] = [];
const pendingRequests: ClientRequest[] = [];
const headers = { Authorization: `Basic ${Buffer.from('control:synthetic-password').toString('base64')}` };
type Operator = { ws: WebSocket; welcome: Record<string, string>; messages: Record<string, unknown>[] };
afterEach(async () => {
  pendingRequests.forEach(req => req.destroy()); pendingRequests.length = 0;
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
async function start(authRequired = true, prepare?: (directory: string) => void) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-remediation-'));
  prepare?.(dataDir);
  const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const address = reserve.address(); if (!address || typeof address === 'string') throw new Error('Address required');
  const port = address.port; await new Promise<void>(resolve => reserve.close(() => resolve()));
  child = spawn(process.execPath, ['server/local-server.mjs'], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env, SEFER_DATA_DIR: dataDir, SEFER_PORT: String(port), SEFER_REQUIRE_AUTH: String(authRequired),
    SEFER_CONTROL_PASSWORD: 'synthetic-password', SEFER_LIVE_AUDIO_ENABLED: 'false', SEFER_VOICE_SCRIPTURE_ENABLED: 'false',
    SEFER_PRIVACY_MANIFEST_DIR: path.join(dataDir, 'manifests'), SEFER_BACKUP_DIR: path.join(dataDir, 'backups'),
    SEFER_PUBLIC_CATALOGS_JSON: JSON.stringify([{ id: 'audit', path: '/audit', title: 'Synthetic', tags: ['audit'] }]),
  } });
  const base = `http://127.0.0.1:${port}`;
  await vi.waitFor(async () => expect((await fetch(`${base}/api/health`)).ok).toBe(true), { timeout: 5000 });
  const connect = (role = 'control', controlSessionId?: string) => new Promise<Operator>((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?role=${role}${controlSessionId ? `&controlSessionId=${encodeURIComponent(controlSessionId)}` : ''}`, { headers }); sockets.push(ws);
    const messages: Record<string, unknown>[] = [];
    ws.on('message', raw => { const message = JSON.parse(raw.toString()); messages.push(message); if (message.type === 'WELCOME') resolve({ ws, welcome: message, messages }); });
    ws.on('error', reject);
  });
  const post = (route: string, body: unknown, credential?: string, etag?: string) => fetch(`${base}${route}`, { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', ...(credential ? { 'X-Sefer-Operator-Credential': credential } : {}), ...(etag ? { 'If-Match': etag } : {}) }, body: JSON.stringify(body) });
  return { base, connect, post };
}

// 100 Continue synchronizes with the real server entering its delayed-body handler.
async function delayedOperatorPost(base: string, route: string, credential: string, body: unknown) {
  const serialized = JSON.stringify(body);
  let req!: ClientRequest;
  const response = new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    req = request(base + route, { method: 'POST', headers: {
      ...headers, 'X-Sefer-Operator-Credential': credential, 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(serialized), Expect: '100-continue',
    } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
    });
    req.on('error', reject);
  });
  pendingRequests.push(req);
  const continued = new Promise<void>(resolve => req.once('continue', resolve));
  req.flushHeaders();
  await continued;
  req.write(serialized.slice(0, 10));
  return { response, finish: () => { req.end(serialized.slice(10)); return response; } };
}

const operatorBodies = [
  { route: '/api/state', body: { clientId: 'r4-retired', slideIndex: -1 } },
  { route: '/api/command', body: { type: 'REMOTE_COMMAND', clientId: 'r4-retired',
    payload: { command: 'SELECT_BG_OVERRIDE', bg: 'retired-background' } } },
  { route: '/api/audio-telemetry', body: { type: 'AUDIO_TELEMETRY', audioState: {
    isPlaying: false, currentTime: 5, duration: 20, volume: 0.5, audioSrc: '/audio/synthetic.mp3',
    activeSyncMapId: null, syncMode: 'none', lastUpdatedBy: 'controller', timestamp: 1,
  } } },
  { route: '/api/video-telemetry', body: { type: 'VIDEO_TELEMETRY', videoState: {
    isPlaying: false, currentTime: 5, duration: 20, volume: 0.5, speed: 1, lastUpdatedBy: 'controller', timestamp: 1,
  } } },
  { route: '/api/display-telemetry', body: { type: 'DISPLAY_TELEMETRY', backgroundLock: true,
    lockedBackgroundValue: 'retired-background', userSelectedBackground: null } },
];
const operatorCases = operatorBodies.flatMap(test =>
  (test.route === '/api/command' ? ['control'] : ['control', 'presenter']).map(role => ({ ...test, role })));

async function wsBarrier(operator: Operator) {
  const marker = Math.random().toString();
  operator.ws.send(JSON.stringify({ type: 'SERVER_TIME_PING', clientSentAtMs: marker }));
  await vi.waitFor(() => {
    expect(child!.exitCode).toBeNull();
    expect(operator.messages.some(message => message.type === 'SERVER_TIME_PONG' && message.clientSentAtMs === marker)).toBe(true);
  });
}

async function playingCueFixture(syncMode: string) {
  const presentation = { id: 'r4-cue-presentation', title: 'Synthetic cues', mode: 'trilingual', background: '',
    slides: [{ id: 's0', label: 'First', lines: ['Synthetic first'] }, { id: 's1', label: 'Second', lines: ['Synthetic second'] }] };
  const app = await start(true, directory => {
    fs.writeFileSync(path.join(directory, 'presentations.json'), JSON.stringify([presentation]));
    fs.writeFileSync(path.join(directory, 'audio_sync.json'), JSON.stringify([{ id: 'r4-cue-map', name: 'Synthetic',
      audioSrc: '/audio/synthetic.mp3', presentationId: presentation.id, defaultSyncMode: syncMode, defaultVolume: 0.7,
      cues: [{ timeSec: 0, slideIndex: 0 }, { timeSec: 1.2, slideIndex: 1 }] }]));
  });
  const principal = await app.connect();
  const select = (operator: Operator, slideIndex: number) => app.post('/api/command', {
    type: 'REMOTE_COMMAND', clientId: 'r4-human', payload: { command: 'SELECT_PRESENTATION_AND_SLIDE', presentation, slideIndex },
  }, operator.welcome.operatorCredential);
  const play = async (operator: Operator) => {
    operator.ws.send(JSON.stringify({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'SET_TRACK',
      presentationId: presentation.id, audioSrc: '/audio/synthetic.mp3', syncMapId: 'r4-cue-map', syncMode } }));
    operator.ws.send(JSON.stringify({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'PLAY', positionSec: 0 } }));
    await wsBarrier(operator);
  };
  const state = async () => (await fetch(app.base + '/api/state', { headers })).json();
  const timeline = async () => {
    const observer = await app.connect('presenter');
    return vi.waitFor(() => {
      const message = observer.messages.find(message => message.type === 'AUDIO_TIMELINE_STATE');
      expect(message).toBeDefined();
      return message!.timeline as Record<string, unknown>;
    });
  };
  await select(principal, 1);
  await play(principal);
  await vi.waitFor(async () => expect(await state()).toMatchObject({ clientId: 'server', slideIndex: 0 }));
  return { ...app, principal, select, play, state, timeline };
}

it.each(['HTTP', 'WS'].flatMap(entry => ['unilateral', 'bilateral'].flatMap(syncMode =>
  [false, true].map(hardRefresh => ({ entry, syncMode, hardRefresh })))))(
  'retires cues across $entry session rotation ($syncMode, hardRefresh=$hardRefresh) and permits new playback',
  async ({ entry, syncMode, hardRefresh }) => {
    const app = await playingCueFixture(syncMode);
    const oldTimeline = await app.timeline();
    const payload = { command: 'RESET_STATE', clearSession: true, hardRefresh };
    const closed = new Promise<void>(resolve => app.principal.ws.once('close', () => resolve()));
    if (entry === 'HTTP') {
      const response = await app.post('/api/command', { type: 'REMOTE_COMMAND', clientId: 'r4', payload },
        app.principal.welcome.operatorCredential);
      expect(response.status).toBe(200);
      expect((await response.json()).state.presentation).toBeNull();
    } else app.principal.ws.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'r4', payload }));
    await closed;
    // Let the real 100 ms evaluator cross the old map's last cue without a Control.
    await new Promise(resolve => setTimeout(resolve, 1400));
    expect((await app.state()).presentation).toBeNull();
    const fresh = await app.connect('control', app.principal.welcome.controlSessionId);
    expect(fresh.welcome.presentationSessionId).not.toBe(app.principal.welcome.presentationSessionId);
    const timeline = await app.timeline();
    expect(timeline).toMatchObject({ status: 'idle', audioSrc: null, syncMapId: null, presentationId: null, syncMode: 'none' });
    expect(timeline.timelineId).not.toBe(oldTimeline.timelineId);
    expect((await app.select(fresh, 1)).status).toBe(200);
    await app.play(fresh);
    // Reusing the same map's first cue also proves its previous cursor was retired.
    await vi.waitFor(async () => expect(await app.state()).toMatchObject({ clientId: 'server', slideIndex: 0 }));
  }, 10000);

it.each(['HTTP', 'WS'].flatMap(entry => ['unilateral', 'bilateral'].map(syncMode => ({ entry, syncMode })) ))(
  'preserves timeline and session on failed $entry rotation ($syncMode)', async ({ entry, syncMode }) => {
    const app = await playingCueFixture(syncMode);
    app.principal.ws.send(JSON.stringify({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'PAUSE' } }));
    await wsBarrier(app.principal);
    const beforeTimeline = await app.timeline(), beforeState = await app.state();
    const markerPath = path.join(dataDir!, 'presentation-session.json');
    const marker = fs.readFileSync(markerPath, 'utf8');
    fs.mkdirSync(markerPath + '.bak');
    const payload = { command: 'RESET_STATE', clearSession: true };
    if (entry === 'HTTP') {
      const response = await app.post('/api/command', { type: 'REMOTE_COMMAND', clientId: 'r4', payload },
        app.principal.welcome.operatorCredential);
      expect(response.status).toBe(503);
    } else {
      app.principal.ws.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'r4', payload }));
      await wsBarrier(app.principal);
      expect(app.principal.messages.some(message => message.type === 'ERROR' && message.code === 'SESSION_PERSISTENCE_FAILED')).toBe(true);
    }
    expect(fs.readFileSync(markerPath, 'utf8')).toBe(marker);
    expect(await app.state()).toEqual(beforeState);
    expect(await app.timeline()).toEqual(beforeTimeline);
  });

it.each(['unilateral', 'bilateral'])('preserves the existing non-session soft reset timeline (%s)', async syncMode => {
  const app = await playingCueFixture(syncMode);
  app.principal.ws.send(JSON.stringify({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'PAUSE' } }));
  await wsBarrier(app.principal);
  const before = await app.timeline();
  const markerPath = path.join(dataDir!, 'presentation-session.json'), marker = fs.readFileSync(markerPath, 'utf8');
  const response = await app.post('/api/command', { type: 'REMOTE_COMMAND', clientId: 'r4', payload: { command: 'RESET_STATE' } },
    app.principal.welcome.operatorCredential);
  expect(response.status).toBe(200);
  expect(fs.readFileSync(markerPath, 'utf8')).toBe(marker);
  expect(await app.timeline()).toEqual(before);
  expect(app.principal.ws.readyState).toBe(WebSocket.OPEN);
});

it.each(['control', 'presenter'])('rejects malformed real-backend %s telemetry before mutation on HTTP and WS', async role => {
  const { base, connect, post } = await start();
  const operator = await connect(role);
  const healthy = await connect('audience');
  const initial = await (await fetch(base + '/api/state', { headers })).json();
  const validAudio = operatorBodies[2].body;
  const malformed: Record<string, unknown>[] = [
    { type: 'AUDIO_TELEMETRY' },
    ...[null, [], 'bad', 1, false, {}].map(audioState => ({ type: 'AUDIO_TELEMETRY', audioState })),
    ...Object.entries({ isPlaying: 'yes', currentTime: '5', duration: null, volume: 2,
      audioSrc: 4, activeSyncMapId: [], syncMode: 'bad', lastUpdatedBy: 'bad', timestamp: null })
      .map(([field, value]) => ({ ...validAudio, audioState: { ...validAudio.audioState, [field]: value } })),
    { ...validAudio, payload: null },
    { type: 'VIDEO_TELEMETRY' }, { type: 'VIDEO_TELEMETRY', videoState: {} },
    { type: 'VIDEO_TELEMETRY', videoState: [] },
    { type: 'DISPLAY_TELEMETRY', backgroundLock: true, lockedBackgroundValue: 1, userSelectedBackground: null },
    { type: 'DISPLAY_TELEMETRY', backgroundLock: null, lockedBackgroundValue: null, userSelectedBackground: null },
  ];
  for (const message of malformed) {
    operator.ws.send(JSON.stringify(message));
    await wsBarrier(operator);
    await wsBarrier(healthy);
    expect(await (await fetch(base + '/api/state', { headers })).json()).toEqual(initial);
    const route = message.type === 'AUDIO_TELEMETRY' ? '/api/audio-telemetry'
      : message.type === 'VIDEO_TELEMETRY' ? '/api/video-telemetry' : '/api/display-telemetry';
    expect((await post(route, message, operator.welcome.operatorCredential)).status).toBe(400);
    expect(await (await fetch(base + '/api/state', { headers })).json()).toEqual(initial);
  }
  expect((await fetch(base + '/api/health')).status).toBe(200);
}, 10000);

it.each(['control', 'presenter'])('preserves valid %s telemetry on HTTP and WS, including null video', async role => {
  const { base, connect, post } = await start();
  const operator = await connect(role);
  for (const { route, body } of [...operatorBodies.slice(2),
    { route: '/api/video-telemetry', body: { type: 'VIDEO_TELEMETRY', videoState: null } }]) {
    const before = await (await fetch(base + '/api/state', { headers })).json();
    operator.ws.send(JSON.stringify(body));
    await wsBarrier(operator);
    const after = await (await fetch(base + '/api/state', { headers })).json();
    expect(after.stateRevision).toBe(before.stateRevision + 1);
    expect((await post(route, body, operator.welcome.operatorCredential)).status).toBe(200);
    expect((await (await fetch(base + '/api/state', { headers })).json()).stateRevision).toBe(after.stateRevision + 1);
  }
});

it('contains a real callback exception without terminating the backend or changing projection', async () => {
  const { base, connect } = await start();
  const operator = await connect('presenter');
  const healthy = await connect('control');
  const initial = await (await fetch(base + '/api/state', { headers })).json();
  const nested = '['.repeat(3000) + '0' + ']'.repeat(3000);
  operator.ws.send('{"type":"SYNC_STATE","clientId":"synthetic","presentation":{"extra":' + nested + '}}');
  await wsBarrier(operator);
  await wsBarrier(healthy);
  expect(operator.messages.some(message => message.type === 'ERROR' && message.code === 'INVALID_MESSAGE')).toBe(true);
  expect(await (await fetch(base + '/api/state', { headers })).json()).toEqual(initial);
});

it.each(operatorCases.flatMap(test => ['disconnect', 'rotation'].map(ending => ({ ...test, ending }))))(
  'rejects delayed $role $route after $ending, even with a reused Control ID', async ({ route, body, role, ending }) => {
    const { base, connect, post } = await start();
    const principal = await connect('control', 'r4-original-control');
    const operator = role === 'control' ? principal : await connect('presenter');
    const delayed = await delayedOperatorPost(base, route, operator.welcome.operatorCredential, body);
    const closed = new Promise<void>(resolve => operator.ws.once('close', () => resolve()));
    if (ending === 'disconnect') operator.ws.close();
    else principal.ws.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'r4-reset',
      payload: { command: 'RESET_STATE', clearSession: true } }));
    await closed;
    const replacement = await connect(role, operator.welcome.controlSessionId);
    if (role === 'control') {
      expect(replacement.welcome.controlSessionId).toBe(operator.welcome.controlSessionId);
      expect(replacement.welcome.controlState).toBe('PRINCIPAL');
    }
    expect((await post(route, body, operator.welcome.operatorCredential)).status).toBe(403);
    const before = await (await fetch(base + '/api/state', { headers })).json();
    expect(await delayed.finish()).toMatchObject({ status: 403, body: { code: 'OPERATOR_FORBIDDEN' } });
    expect(await (await fetch(base + '/api/state', { headers })).json()).toEqual(before);
    expect((await fetch(base + '/api/health')).status).toBe(200);
  }, 10000);

it.each(operatorCases)('accepts a delayed $role $route while its original authority is unchanged', async ({ route, body, role }) => {
  const { base, connect } = await start();
  const operator = await connect(role);
  const delayed = await delayedOperatorPost(base, route, operator.welcome.operatorCredential, body);
  expect((await delayed.finish()).status).toBe(200);
});

it.each([true, false])('rechecks delayed HTTP authority with auth=%s and preserves early rejection', async authRequired => {
  const { base, connect } = await start(authRequired);
  const principal = await connect();
  const pending = await connect();
  const denied = await delayedOperatorPost(base, '/api/state', pending.welcome.operatorCredential,
    { clientId: 'pending', slideIndex: -1 });
  // No complete body is sent: the entry guard must reject immediately.
  expect((await denied.response).status).toBe(403);
  const delayed = await delayedOperatorPost(base, '/api/state', principal.welcome.operatorCredential,
    { clientId: 'retired', slideIndex: -1 });
  const closed = new Promise<void>(resolve => principal.ws.once('close', () => resolve()));
  principal.ws.close(); await closed;
  expect((await delayed.finish()).status).toBe(403);
});

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

it('refreshes a warm public projection after corpus, metadata and external presentation changes', async () => {
  const presentation = { id: 'p', title: 'Synthetic', mode: 'standard', background: '', tags: ['audit'],
    slides: [{ id: 's', label: 'Scripture', lines: ['Synthetic'], type: 'tanaj', scriptureBook: 'Gn', scriptureChapter: '1', scriptureVerseStart: '1' }] };
  const content = 'book\tabbrev\theb\tchapter\tverse\tnikud\ttranslit\ttranslation\nGenesis\tGn\tBereshit\t1\t1\tHEB\tTRANS\tOLD\n';
  const { base } = await start(true, directory => {
    fs.mkdirSync(path.join(directory, 'public/books'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'public/metadata.json'), JSON.stringify({ Genesis: { bookAbbrevEs: 'Gn', safeFile: 'genesis' } }));
    fs.writeFileSync(path.join(directory, 'public/books/genesis.tsv'), content);
    fs.writeFileSync(path.join(directory, 'presentations.json'), JSON.stringify([presentation]));
  });
  const publicState = async () => (await (await fetch(`${base}/api/public-catalogs/audit/presentations`)).json())[0];
  expect((await publicState()).slides[0].scriptureVerses[0][2]).toBe('OLD');
  const file = path.join(dataDir!, 'public/books/genesis.tsv');
  const stat = fs.statSync(file);
  fs.writeFileSync(file, content.replace('OLD', 'NEW'));
  fs.utimesSync(file, stat.atime, stat.mtime);
  expect((await publicState()).slides[0].scriptureVerses[0][2]).toBe('NEW');
  fs.writeFileSync(path.join(dataDir!, 'public/books/override.tsv'), content.replace('OLD', 'OVERRIDE'));
  fs.writeFileSync(path.join(dataDir!, 'public/metadata.json'), JSON.stringify({ Genesis: { bookAbbrevEs: 'Gn', safeFile: 'override' } }));
  expect((await publicState()).slides[0].scriptureVerses[0][2]).toBe('OVERRIDE');
  fs.writeFileSync(path.join(dataDir!, 'presentations.json'), JSON.stringify([{ ...presentation, title: 'External edit' }]));
  expect((await publicState()).title).toBe('External edit');
  expect(await publicState()).toEqual(await publicState());
}, 10000);

const startBilateral = () => start(true, directory => {
  fs.writeFileSync(path.join(directory, 'presentations.json'), JSON.stringify([{
    id: 'p', title: 'Synthetic', mode: 'standard', background: '',
    slides: [{ id: 's0', label: 'First', lines: ['One'] }, { id: 's1', label: 'Second', lines: ['Two'] }],
  }]));
  fs.writeFileSync(path.join(directory, 'audio_sync.json'), JSON.stringify([{
    id: 'm', name: 'Synthetic', presentationId: 'p', audioSrc: '/synthetic.mp3', defaultVolume: 0.7, defaultSyncMode: 'bilateral',
    cues: [{ slideIndex: 0, timeSec: 0 }, { slideIndex: 1, timeSec: 10 }, { slideIndex: 1, timeSec: 30 }],
  }]));
});

it.each(['HTTP', 'WS'])('keeps clientId=server external for bilateral commands over %s', async entry => {
  const { base, connect, post } = await startBilateral();
  const principal = await connect();
  const pending = await connect();
  const send = (message: Record<string, unknown>) => principal.ws.send(JSON.stringify(message));
  send({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'SET_TRACK', presentationId: 'p', audioSrc: '/synthetic.mp3', syncMapId: 'm', syncMode: 'bilateral' } });
  send({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'SEEK', positionSec: 5 } });
  send({ type: 'SERVER_TIME_PING', clientSentAtMs: 'ready' });
  await vi.waitFor(() => expect(principal.messages.some(message => message.clientSentAtMs === 'ready')).toBe(true));
  const command = { type: 'REMOTE_COMMAND', clientId: 'server', origin: 'server', sourceMeta: null, internal: true,
    payload: { command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: (await (await fetch(`${base}/api/presentations`, { headers })).json())[0], slideIndex: 1 } };
  if (entry === 'HTTP') {
    expect((await post('/api/command', command, pending.welcome.operatorCredential)).status).toBe(403);
    expect((await post('/api/command', command, principal.welcome.operatorCredential)).status).toBe(200);
  } else {
    pending.ws.send(JSON.stringify(command));
    await vi.waitFor(() => expect(pending.messages.some(message => message.code === 'CONTROL_PENDING_FORBIDDEN')).toBe(true));
    send(command); send({ type: 'SERVER_TIME_PING', clientSentAtMs: 'after-command' });
    await vi.waitFor(() => expect(principal.messages.some(message => message.clientSentAtMs === 'after-command')).toBe(true));
  }
  const observer = await connect('audience');
  const timeline = await vi.waitFor(() => {
    const message = observer.messages.find(message => message.type === 'AUDIO_TIMELINE_STATE');
    expect(message).toBeDefined(); return message!.timeline as { basePositionSec: number };
  });
  expect(timeline.basePositionSec).toBe(10);
}, 10000);

it('does not seek to an earlier same-slide cue when the timeline generates a selection internally', async () => {
  const { base, connect } = await startBilateral();
  const principal = await connect();
  for (const action of [
    { type: 'SET_TRACK', presentationId: 'p', audioSrc: '/synthetic.mp3', syncMapId: 'm', syncMode: 'bilateral' },
    { type: 'PLAY', positionSec: 35 },
  ]) principal.ws.send(JSON.stringify({ type: 'AUDIO_TIMELINE_ACTION', action }));
  await vi.waitFor(async () => expect((await (await fetch(`${base}/api/state`, { headers })).json()).slideIndex).toBe(1));
  const observer = await connect('audience');
  const timeline = await vi.waitFor(() => {
    const message = observer.messages.find(message => message.type === 'AUDIO_TIMELINE_STATE');
    expect(message).toBeDefined(); return message!.timeline as { basePositionSec: number; status: string };
  });
  expect(timeline.status).toBe('playing');
  expect(timeline.basePositionSec).toBe(35);
}, 10000);

it('publishes large selections over SSE and accepts them again after Control reconnects', async () => {
  const { base, connect } = await start();
  const control = await connect();
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 8000);
  const stream = await fetch(`${base}/api/state-events`, { headers, signal: abort.signal });
  expect(stream.status).toBe(200);
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const nextPresentation = async (id: string) => {
    while (true) {
      const result = await reader.read();
      if (result.done) throw new Error('SSE closed before selection');
      pending += decoder.decode(result.value, { stream: true });
      const events = pending.split('\n\n');
      pending = events.pop()!;
      for (const event of events) {
        const data = event.split('\n').find(line => line.startsWith('data: '));
        if (!data) continue;
        const message = JSON.parse(data.slice(6));
        if (message.presentation?.id === id) return message;
      }
    }
  };
  const presentation = (id: string, count: number) => ({ id, title: 'Synthetic', mode: 'trilingual', background: '',
    slides: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, label: `Synthetic ${i}`,
      lines: ['א'.repeat(300), 'a'.repeat(650), 'b'.repeat(650)] })) });
  const select = (ws: WebSocket, item: ReturnType<typeof presentation>) => ws.send(JSON.stringify({
    type: 'REMOTE_COMMAND', clientId: 'synthetic', payload: { command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: item, slideIndex: 0 },
  }));
  try {
    select(control.ws, presentation('small', 1));
    expect((await nextPresentation('small')).presentation.slides).toHaveLength(1);
    const large = presentation('large', 109);
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(200_000);
    select(control.ws, large);
    const first = await nextPresentation('large');
    expect(first.presentation.slides).toHaveLength(109);
    expect(first.stateRevision).toBeGreaterThan(0);

    const closed = new Promise<number>(resolve => control.ws.once('close', resolve));
    control.ws.send(JSON.stringify({ type: 'SERVER_TIME_PING', padding: 'x'.repeat(65537) }));
    expect(await closed).toBe(1009);
    const reconnected = await connect();
    expect(reconnected.welcome.controlState).toBe('PRINCIPAL');
    select(reconnected.ws, { ...large, id: 'large-after-reconnect' });
    const second = await nextPresentation('large-after-reconnect');
    expect(second.presentation.slides).toHaveLength(109);
    expect(second.stateRevision).toBeGreaterThan(first.stateRevision);
    expect(reconnected.ws.readyState).toBe(WebSocket.OPEN);

    const presenter = await connect('presenter');
    presenter.ws.send(JSON.stringify({ type: 'SYNC_STATE', clientId: 'synthetic-presenter', origin: 'presenter',
      presentation: { ...large, id: 'presenter-large' }, slideIndex: 0, backgroundLock: false,
      lockedBackgroundValue: null, userSelectedBackground: null, videoState: null, appMode: 'slides', scriptureState: null,
      audioState: { isPlaying: false, currentTime: 0, duration: 0, volume: 0.7, audioSrc: null, activeSyncMapId: null,
        syncMode: 'none', lastUpdatedBy: 'controller', timestamp: 0 } }));
    const third = await nextPresentation('presenter-large');
    expect(third.presentation.slides).toHaveLength(109);
    expect(third.stateRevision).toBeGreaterThan(second.stateRevision);
    expect(presenter.ws.readyState).toBe(WebSocket.OPEN);
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await reader.cancel().catch(() => {});
  }
}, 10000);

it('rejects an unauthenticated Control before it can send a large state', async () => {
  const { base } = await start();
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?role=control`);
  sockets.push(ws);
  const closed = new Promise<number>(resolve => ws.once('close', resolve));
  await expect(closed).resolves.toBe(4001);
}, 10000);

it('rejects a deeply nested oversized presentation without terminating the server', async () => {
  const { base, connect } = await start();
  const principal = await connect();
  const healthy = await connect('audience');
  const nested = '['.repeat(12_000) + '0' + ']'.repeat(12_000);
  const raw = '{"type":"REMOTE_COMMAND","clientId":"synthetic","payload":{"command":"SELECT_PRESENTATION_AND_SLIDE","slideIndex":0,"presentation":{"id":"p","title":"Synthetic","slides":[],"extra":' + nested + ',"padding":"' + 'x'.repeat(50_000) + '"}}}';
  expect(Buffer.byteLength(raw)).toBeGreaterThan(65536);
  const closed = new Promise<number>(resolve => principal.ws.once('close', resolve));
  principal.ws.send(raw);
  await expect(closed).resolves.toBe(1009);
  healthy.ws.send(JSON.stringify({ type: 'SERVER_TIME_PING', clientSentAtMs: 'healthy' }));
  await vi.waitFor(() => expect(healthy.messages.some(message => message.type === 'SERVER_TIME_PONG' && message.clientSentAtMs === 'healthy')).toBe(true));
  expect((await fetch(`${base}/api/health`)).status).toBe(200);
}, 10000);

it('rejects oversized state that would overflow projection cloning', async () => {
  const { base, connect } = await start();
  const presenter = await connect('presenter');
  const healthy = await connect('audience');
  const nested = '['.repeat(3000) + '0' + ']'.repeat(3000);
  const message = { type: 'SYNC_STATE', clientId: 'synthetic', origin: 'presenter', slideIndex: 0,
    presentation: { id: 'p', title: 'Synthetic', slides: [], extra: 'nested-placeholder', padding: 'x'.repeat(70_000) },
    backgroundLock: false, lockedBackgroundValue: null, userSelectedBackground: null, videoState: null,
    appMode: 'slides', scriptureState: null, audioState: { isPlaying: false, currentTime: 0, duration: 0,
      volume: 0.7, audioSrc: null, activeSyncMapId: null, syncMode: 'none', lastUpdatedBy: 'controller', timestamp: 0 } };
  const raw = JSON.stringify(message).replace('"nested-placeholder"', nested);
  const closed = new Promise<number>(resolve => presenter.ws.once('close', resolve));
  presenter.ws.send(raw);
  await expect(closed).resolves.toBe(1009);
  healthy.ws.send(JSON.stringify({ type: 'SERVER_TIME_PING', clientSentAtMs: 'healthy' }));
  await vi.waitFor(() => expect(healthy.messages.some(event => event.type === 'SERVER_TIME_PONG' && event.clientSentAtMs === 'healthy')).toBe(true));
  expect((await fetch(`${base}/api/health`)).status).toBe(200);
}, 10000);
