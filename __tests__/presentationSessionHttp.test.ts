import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { get, type ClientRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

const sockets: WebSocket[] = [];
const streams: ClientRequest[] = [];
let child: ChildProcess | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  streams.forEach(request => request.destroy()); streams.length = 0;
  sockets.forEach(ws => ws.terminate()); sockets.length = 0;
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.kill();
    await exited;
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  child = undefined; dataDir = undefined;
});

const startHttp = async (defaultAccess: 'PUBLIC' | 'CONTROLLED' = 'PUBLIC') => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-http-session-'));
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const address = reserve.address();
  if (!address || typeof address === 'string') throw new Error('TCP address required');
  const port = address.port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  child = spawn(process.execPath, ['server/local-server.mjs'], {
    cwd: process.cwd(), stdio: 'ignore', windowsHide: true,
    env: {
      ...process.env, SEFER_DATA_DIR: dataDir, SEFER_PORT: String(port),
      SEFER_REQUIRE_AUTH: 'false', SEFER_LIVE_AUDIO_ENABLED: 'false', SEFER_VOICE_SCRIPTURE_ENABLED: 'false',
      SEFER_SESSION_ACCESS_DEFAULT: defaultAccess,
    },
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await vi.waitFor(async () => {
    expect(child!.exitCode).toBeNull();
    const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) });
    expect(health.ok).toBe(true);
  }, { timeout: 5_000, interval: 50 });
  return baseUrl;
};

it('persists HTTP reset before success and fails closed without changing projection when storage fails', async () => {
  const baseUrl = await startHttp();
  const connect = () => new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/ws?role=control'); sockets.push(ws);
    ws.on('message', raw => { const msg = JSON.parse(raw.toString()); if (msg.type === 'WELCOME') resolve(msg.operatorCredential); });
    ws.on('error', reject);
  });
  let credential = await connect();
  const markerPath = path.join(dataDir, 'presentation-session.json');
  const marker = () => JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { sessionId: string; expiresAt: number };
  const command = (payload: unknown) => fetch(`${baseUrl}/api/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sefer-Operator-Credential': credential },
    body: JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'test-control', payload }),
  });
  const initialId = marker().sessionId;
  const rejected = await command({ command: 'UNKNOWN_COMMAND', clearSession: true });
  expect(rejected.status).toBe(400);
  expect(marker().sessionId).toBe(initialId);
  const accepted = await command({ command: 'RESET_STATE', clearSession: true });
  expect(accepted.status).toBe(200);
  credential = await connect();
  const nextId = marker().sessionId;
  expect(nextId).not.toBe(initialId);
  expect(Object.keys(marker()).sort()).toEqual(['expiresAt', 'sessionId']);
  const projectionBefore = await (await fetch(`${baseUrl}/api/state`)).json();
  // An unwritable backup target makes the existing safe writer reject rotation.
  fs.unlinkSync(`${markerPath}.bak`);
  fs.mkdirSync(`${markerPath}.bak`);
  const failed = await command({ command: 'RESET_STATE', clearSession: true });
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({
    code: 'SESSION_PERSISTENCE_FAILED', error: 'Presentation session reset could not be persisted',
  });
  expect(marker().sessionId).toBe(nextId);
  expect(await (await fetch(`${baseUrl}/api/state`)).json()).toEqual(projectionBefore);
}, 10_000);

type Message = Record<string, unknown>;
type Control = { ws: WebSocket; messages: Message[]; welcome: Message };
type Stream = { events: Message[]; ended: boolean; error?: Error };

const waitWs = (control: Pick<Control, 'messages'>, predicate: (message: Message) => boolean) =>
  vi.waitFor(() => {
    const message = control.messages.find(predicate);
    expect(message).toBeDefined();
    return message!;
  });

const connectControl = async (base: string): Promise<Control> => {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws?role=control');
  sockets.push(ws);
  const messages: Message[] = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.on('error', reject); });
  const welcome = await waitWs({ messages }, message => message.type === 'WELCOME');
  expect(welcome.controlState).toBe('PRINCIPAL');
  return { ws, messages, welcome };
};

const post = (base: string, route: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const command = (base: string, control: Control, payload: Message) =>
  post(base, '/api/command', { type: 'REMOTE_COMMAND', clientId: control.welcome.clientId, payload },
    { 'X-Sefer-Operator-Credential': control.welcome.operatorCredential as string });

const openSse = (base: string, route: string): Stream => {
  const stream: Stream = { events: [], ended: false };
  const request = get(base + route, response => {
    if (response.statusCode !== 200) stream.error = new Error('SSE status ' + response.statusCode);
    let buffer = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      buffer += chunk;
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
        if (!data || data === 'heartbeat') continue;
        try { stream.events.push(JSON.parse(data)); } catch { stream.error = new Error('Invalid SSE JSON'); }
      }
    });
    response.on('end', () => { stream.ended = true; });
    response.on('error', error => { stream.error = error; });
  });
  request.on('error', error => { stream.error = error; });
  streams.push(request);
  return stream;
};

const contains = (stream: Stream, marker: string) => stream.events.some(event => JSON.stringify(event).includes(marker));

const admit = async (base: string, control: Control) => {
  const response = await post(base, '/api/audience/access/bootstrap', {});
  expect(response.status).toBe(200);
  const access = await response.json() as { credential: string; participantId: string; accessState: string; accessMode: string };
  if (access.accessState !== 'ADMITTED') {
    control.ws.send(JSON.stringify({ type: 'AUDIENCE_ACCESS_DECISION', participantId: access.participantId, decision: 'ADMIT' }));
    await waitWs(control, message => message.type === 'AUDIENCE_ACCESS_DECISION_RESULT' && message.participantId === access.participantId);
  }
  return access;
};

const ticket = async (base: string, credential: string, purpose: 'STATE' | 'QUIZ') => {
  const response = await post(base, '/api/audience/sse-ticket', { purpose }, { Authorization: 'Bearer ' + credential });
  expect(response.status).toBe(200);
  return (await response.json() as { ticket: string }).ticket;
};

const select = async (base: string, control: Control, marker: string) => {
  expect((await command(base, control, { command: 'SELECT_PRESENTATION_AND_SLIDE', slideIndex: 0,
    presentation: { id: marker, title: marker, mode: 'trilingual', background: '',
      slides: [{ id: 'synthetic-slide', label: 'Synthetic', lines: ['Synthetic projection'] }] },
  })).status).toBe(200);
};

const publishQuiz = (base: string, control: Control, marker: string) =>
  post(base, '/api/quiz-answer', { type: 'QUIZ_CLEAR_ANSWERS', presentationId: marker },
    { 'X-Sefer-Operator-Credential': control.welcome.operatorCredential as string });

const receiveMarkers = (base: string, control: Control, marker: string, recipients: Stream[]) =>
  vi.waitFor(async () => {
    // QUIZ sends no initial frame/headers: a bounded publication also confirms registration.
    expect((await publishQuiz(base, control, marker)).status).toBe(200);
    for (const stream of recipients) {
      expect(stream.error).toBeUndefined();
      expect(contains(stream, marker)).toBe(true);
    }
  });

const reset = async (base: string, control: Control, entry: string, succeeds = true) => {
  const payload = { command: 'RESET_STATE', clearSession: true };
  if (entry === 'HTTP') {
    const response = await command(base, control, payload);
    expect(response.status).toBe(succeeds ? 200 : 503);
    if (!succeeds) expect((await response.json()).code).toBe('SESSION_PERSISTENCE_FAILED');
  } else {
    control.ws.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: control.welcome.clientId, payload }));
    await waitWs(control, message => succeeds ? message.type === 'PRESENTATION_SESSION_ROTATED'
      : message.type === 'ERROR' && message.code === 'SESSION_PERSISTENCE_FAILED');
  }
};

it.each(['HTTP', 'WS'].flatMap(entry => ['PUBLIC', 'CONTROLLED'].flatMap(from =>
  ['PUBLIC', 'CONTROLLED'].map(to => ({ entry, from, to })))))(
  'revokes prior STATE/QUIZ subscriptions on $entry $from -> $to rotation', async ({ entry, from, to }) => {
  const base = await startHttp(to as 'PUBLIC' | 'CONTROLLED');
  const principal = await connectControl(base);
  if (from !== to) {
    principal.ws.send(JSON.stringify({ type: 'SESSION_ACCESS_POLICY_UPDATE', accessMode: from }));
    await waitWs(principal, message => message.type === 'SESSION_ACCESS_POLICY' && message.accessMode === from);
  }
  const old = await admit(base, principal);
  expect(old.accessMode).toBe(from);
  const oldState = openSse(base, '/api/audience/events?ticket=' + await ticket(base, old.credential, 'STATE'));
  const oldQuiz = openSse(base, '/api/quiz-events?ticket=' + await ticket(base, old.credential, 'QUIZ'));
  const unusedState = await ticket(base, old.credential, 'STATE'), unusedQuiz = await ticket(base, old.credential, 'QUIZ');
  const adminState = openSse(base, '/api/state-events'), adminQuiz = openSse(base, '/api/quiz-control-events');
  const before = randomUUID();
  await select(base, principal, before);
  await receiveMarkers(base, principal, before, [oldState, oldQuiz, adminState, adminQuiz]);
  oldState.events.length = 0; oldQuiz.events.length = 0;

  await reset(base, principal, entry);
  const next = await connectControl(base);
  expect(next.welcome.presentationSessionId).not.toBe(principal.welcome.presentationSessionId);
  expect((await post(base, '/api/audience/sse-ticket', { purpose: 'STATE' }, { Authorization: 'Bearer ' + old.credential })).status).toBe(401);
  if (to === 'CONTROLLED') {
    expect((await fetch(base + '/api/audience/state', { headers: { Authorization: 'Bearer ' + old.credential } })).status).toBe(401);
    expect((await fetch(base + '/api/audience/events?ticket=' + unusedState)).status).toBe(401);
    expect((await fetch(base + '/api/quiz-events?ticket=' + unusedQuiz)).status).toBe(401);
  }
  const marker = randomUUID();
  await select(base, next, marker);
  expect((await publishQuiz(base, next, marker)).status).toBe(200);
  const fresh = await admit(base, next);
  expect(fresh.accessMode).toBe(to);
  const freshState = openSse(base, '/api/audience/events?ticket=' + await ticket(base, fresh.credential, 'STATE'));
  const freshQuiz = openSse(base, '/api/quiz-events?ticket=' + await ticket(base, fresh.credential, 'QUIZ'));
  await receiveMarkers(base, next, marker, [freshState, freshQuiz, adminState, adminQuiz]);
  await vi.waitFor(() => {
    expect(oldState.ended || contains(oldState, marker)).toBe(true);
    expect(oldQuiz.ended || contains(oldQuiz, marker)).toBe(true);
  });
  expect({ stateEnded: oldState.ended, stateLeaked: contains(oldState, marker),
    quizEnded: oldQuiz.ended, quizLeaked: contains(oldQuiz, marker) })
    .toEqual({ stateEnded: true, stateLeaked: false, quizEnded: true, quizLeaked: false });
  expect([adminState.ended, adminQuiz.ended]).toEqual([false, false]);
  for (const field of ['operatorCredential', 'pendingControls', 'verificationCode', 'authorizations']) {
    expect(freshState.events.some(event => field in event)).toBe(false);
  }
  if (entry === 'HTTP' && from === 'CONTROLLED' && to === 'CONTROLLED') {
    await reset(base, next, entry);
    await vi.waitFor(() => expect([freshState.ended, freshQuiz.ended]).toEqual([true, true]));
    expect([adminState.ended, adminQuiz.ended]).toEqual([false, false]);
  }
}, 10_000);

it.each(['HTTP', 'WS'])('preserves admitted streams and session when %s rotation persistence fails', async entry => {
  const base = await startHttp('CONTROLLED'), principal = await connectControl(base);
  const access = await admit(base, principal), before = randomUUID();
  const state = openSse(base, '/api/audience/events?ticket=' + await ticket(base, access.credential, 'STATE'));
  const quiz = openSse(base, '/api/quiz-events?ticket=' + await ticket(base, access.credential, 'QUIZ'));
  await select(base, principal, before);
  await receiveMarkers(base, principal, before, [state, quiz]);
  const markerPath = path.join(dataDir!, 'presentation-session.json');
  const persisted = fs.readFileSync(markerPath, 'utf8');
  if (fs.existsSync(markerPath + '.bak')) fs.unlinkSync(markerPath + '.bak');
  fs.mkdirSync(markerPath + '.bak');
  const previousState = await (await fetch(base + '/api/state')).json();
  await reset(base, principal, entry, false);
  expect(fs.readFileSync(markerPath, 'utf8')).toBe(persisted);
  expect(await (await fetch(base + '/api/state')).json()).toEqual(previousState);
  expect(principal.messages.some(message => message.type === 'PRESENTATION_SESSION_ROTATED')).toBe(false);
  expect((await fetch(base + '/api/audience/state', { headers: { Authorization: 'Bearer ' + access.credential } })).status).toBe(200);
  expect([state.ended, quiz.ended]).toEqual([false, false]);
  const marker = randomUUID();
  await select(base, principal, marker);
  await receiveMarkers(base, principal, marker, [state, quiz]);
}, 10_000);
