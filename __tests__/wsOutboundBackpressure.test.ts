import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  authorizeOperatorCredential, broadcastWs, createWsServer,
  isLiveAudioControlAuthorized, resetWsServerStateForTests,
} from '../server/ws-server.mjs';

type Message = Record<string, unknown> & { type: string };
interface Client {
  ws: WebSocket;
  serverSocket: WebSocket;
  messages: Message[];
  closed: Promise<{ code: number; reason: string }>;
}
const budget = 512 * 1024;
let http: Server;
let wss: WebSocketServer;
let url: string;
let clients: Client[];
let heartbeat: () => void;
let liveKitState: Record<string, unknown> | undefined;

const waitFor = async (client: Client, predicate: (message: Message) => boolean) => vi.waitFor(() => {
  const message = client.messages.find(predicate);
  expect(message).toBeDefined();
  return message!;
}, { timeout: 1500 });

const connect = async (role: string, sessionId?: string) => {
  const accepted = new Promise<WebSocket>(resolve => wss.once('connection', resolve));
  const ws = new WebSocket(`${url}?role=${role}&clientId=${randomUUID()}${sessionId ? `&controlSessionId=${sessionId}` : ''}`);
  const messages: Message[] = [];
  ws.on('error', () => {});
  ws.on('message', data => messages.push(JSON.parse(data.toString()) as Message));
  const closed = new Promise<{ code: number; reason: string }>(resolve => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const client = { ws, serverSocket: await accepted, messages, closed };
  clients.push(client);
  return client;
};
const ping = async (client: Client) => {
  const marker = randomUUID();
  client.ws.send(JSON.stringify({ type: 'SERVER_TIME_PING', clientSentAtMs: marker }));
  await waitFor(client, message => message.type === 'SERVER_TIME_PONG' && message.clientSentAtMs === marker);
};
const ready = async (role: string, sessionId?: string) => {
  const client = await connect(role, sessionId);
  await waitFor(client, message => message.type === 'WELCOME');
  await ping(client);
  return client;
};
const wireBytes = (message: unknown) => {
  const bytes = Buffer.byteLength(JSON.stringify(message));
  return bytes + (bytes < 126 ? 2 : bytes < 65536 ? 4 : 10);
};

beforeEach(async () => {
  vi.stubEnv('SEFER_REQUIRE_AUTH', 'false');
  resetWsServerStateForTests();
  clients = [];
  liveKitState = undefined;
  http = createServer();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  wss = createWsServer(http, undefined, { getLiveKitState: () => liveKitState });
  heartbeat = intervals.mock.calls.find(([, ms]) => ms === 25000)![0] as () => void;
  intervals.mockRestore();
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  url = `ws://127.0.0.1:${address.port}/ws`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  clients.forEach(client => client.ws.terminate());
  await new Promise<void>(resolve => wss.close(() => resolve()));
  await new Promise<void>(resolve => http.close(() => resolve()));
  resetWsServerStateForTests();
  vi.unstubAllEnvs();
});

it('serializes a filtered exported broadcast once and sends normal UTF-8 messages', async () => {
  const audience = await ready('audience');
  const presenter = await ready('presenter');
  const control = await ready('control');
  const toJSON = vi.fn(() => ({ type: 'R2_NORMAL', text: 'א😀' }));
  broadcastWs({ toJSON }, meta => meta.role !== 'control');
  await waitFor(audience, message => message.type === 'R2_NORMAL');
  await waitFor(presenter, message => message.type === 'R2_NORMAL');
  await ping(control);
  expect(toJSON).toHaveBeenCalledTimes(1);
  expect(control.messages.some(message => message.type === 'R2_NORMAL')).toBe(false);
});

it.each(['below', 'exact fit', 'one byte short', 'at budget', 'above budget'])(
  'accounts for the new UTF-8 frame with an existing queue: %s', async position => {
    const slow = await ready('audience');
    const healthy = await ready('audience');
    const message = { type: 'R2_BUDGET', text: 'א'.repeat(100) };
    const size = wireBytes(message);
    const queued = position === 'below' ? budget - size - 1 : position === 'exact fit' ? budget - size
      : position === 'one byte short' ? budget - size + 1 : position === 'at budget' ? budget : budget + 1;
    vi.spyOn(slow.serverSocket, 'bufferedAmount', 'get').mockReturnValue(queued);
    const send = vi.spyOn(slow.serverSocket, 'send');
    broadcastWs(message, meta => meta.role === 'audience');
    await waitFor(healthy, received => received.type === 'R2_BUDGET');
    if (position === 'below' || position === 'exact fit') {
      await waitFor(slow, received => received.type === 'R2_BUDGET');
      expect(slow.ws.readyState).toBe(WebSocket.OPEN);
    } else {
      await expect(slow.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
      expect(send).not.toHaveBeenCalled();
    }
  },
);

it('rejects a single oversized outgoing message without enqueuing it', async () => {
  const target = await ready('audience');
  const healthy = await ready('presenter');
  const send = vi.spyOn(target.serverSocket, 'send');
  broadcastWs({ type: 'R2_OVERSIZE', text: 'x'.repeat(budget) }, meta => meta.role === 'audience');
  await expect(target.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
  expect(send).not.toHaveBeenCalled();
  await ping(healthy);
});

it('includes the frame header in the exact single-message budget', async () => {
  const client = await ready('audience');
  const message = { type: 'R2_EXACT_FRAME', text: '' };
  message.text = 'x'.repeat(budget - 10 - Buffer.byteLength(JSON.stringify(message)));
  expect(wireBytes(message)).toBe(budget);
  broadcastWs(message);
  await waitFor(client, received => received.type === 'R2_EXACT_FRAME');
  broadcastWs({ ...message, text: `${message.text}x` });
  await expect(client.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
});

it('bounds repeated sends to a stalled recipient while healthy clients receive each update', async () => {
  const slow = await ready('audience');
  const healthy = await ready('audience');
  let queued = 0;
  vi.spyOn(slow.serverSocket, 'bufferedAmount', 'get').mockImplementation(() => queued);
  const send = vi.spyOn(slow.serverSocket, 'send').mockImplementation(data => {
    const bytes = Buffer.byteLength(String(data));
    queued += bytes + (bytes < 126 ? 2 : bytes < 65536 ? 4 : 10);
  });
  for (let i = 0; i < 10; i++) {
    broadcastWs({ type: 'R2_STALLED', i, text: 'x'.repeat(100000) });
    await waitFor(healthy, message => message.type === 'R2_STALLED' && message.i === i);
  }
  await expect(slow.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
  await waitFor(healthy, message => message.type === 'R2_STALLED' && message.i === 9);
  expect(send).toHaveBeenCalledTimes(5);
  expect(queued).toBeLessThanOrEqual(budget);
});

it('applies the remaining budget to internal snapshot sends', async () => {
  const control = await ready('control');
  const welcome = control.messages.find(message => message.type === 'WELCOME')!;
  vi.spyOn(control.serverSocket, 'bufferedAmount', 'get').mockReturnValue(budget - 20);
  control.ws.send(JSON.stringify({ type: 'LIVE_AUDIO_SNAPSHOT_REQUEST' }));
  await expect(control.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
  expect(isLiveAudioControlAuthorized(String(welcome.controlSessionId))).toBe(false);
});

it('closes a Control explicitly if its operational snapshot cannot be serialized', async () => {
  const control = await ready('control');
  const healthy = await ready('presenter');
  liveKitState = { participants: [1n] };
  control.ws.send(JSON.stringify({ type: 'LIVE_AUDIO_SNAPSHOT_REQUEST' }));
  await expect(control.closed).resolves.toMatchObject({ code: 1011 });
  await ping(healthy);
});

it('applies the remaining budget to internal timeline broadcasts and direct clock replies', async () => {
  const control = await ready('control');
  const slow = await ready('audience');
  const healthy = await ready('audience');
  slow.messages.length = 0; healthy.messages.length = 0;
  vi.spyOn(slow.serverSocket, 'bufferedAmount', 'get').mockReturnValue(budget - 1);
  control.ws.send(JSON.stringify({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'PAUSE' } }));
  await expect(slow.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
  await waitFor(healthy, message => message.type === 'AUDIO_TIMELINE_STATE');
  vi.spyOn(healthy.serverSocket, 'bufferedAmount', 'get').mockReturnValue(budget - 1);
  healthy.ws.send(JSON.stringify({ type: 'SERVER_TIME_PING', clientSentAtMs: 1 }));
  await expect(healthy.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
  await ping(control);
});

it.each(['control', 'presenter'])('enforces the policy before the initial %s WELCOME', async role => {
  wss.prependOnceListener('connection', socket => {
    vi.spyOn(socket, 'bufferedAmount', 'get').mockReturnValue(budget);
  });
  const client = await connect(role);
  await expect(client.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
  expect(client.messages.some(message => message.type === 'WELCOME')).toBe(false);
  const replacement = await ready(role);
  expect(replacement.messages.some(message => message.type === 'WELCOME')).toBe(true);
});

it('retains the authentication error and close when its frame fits the budget', async () => {
  vi.stubEnv('SEFER_REQUIRE_AUTH', 'true');
  vi.stubEnv('SEFER_CONTROL_PASSWORD', 'synthetic-password');
  const client = await connect('control');
  await expect(client.closed).resolves.toMatchObject({ code: 4001 });
  expect(client.messages[0]).toMatchObject({ type: 'ERROR', code: 'UNAUTHORIZED' });
});

it('uses the outbound close policy if an authentication error cannot fit', async () => {
  vi.stubEnv('SEFER_REQUIRE_AUTH', 'true');
  vi.stubEnv('SEFER_CONTROL_PASSWORD', 'synthetic-password');
  wss.prependOnceListener('connection', socket => {
    vi.spyOn(socket, 'bufferedAmount', 'get').mockReturnValue(budget);
  });
  const client = await connect('control');
  await expect(client.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
});

it.each(['circular', 'throwing toJSON', 'BigInt'])('closes eligible recipients explicitly on serialization failure: %s', async failure => {
  const target = await ready('audience');
  const healthy = await ready('presenter');
  const circular: Record<string, unknown> = { type: 'R2_BAD' }; circular.self = circular;
  const message = failure === 'circular' ? circular : failure === 'BigInt' ? { type: 'R2_BAD', number: 1n }
    : { toJSON: () => { throw new Error('Synthetic serialization failure'); } };
  expect(() => broadcastWs(message, meta => meta.role === 'audience')).not.toThrow();
  await expect(target.closed).resolves.toMatchObject({ code: 1011 });
  await ping(healthy);
});

it('isolates synchronous send failures and late callback errors from replacement Controls', async () => {
  const old = await ready('control');
  const welcome = old.messages.find(message => message.type === 'WELCOME')!;
  let complete: ((error?: Error) => void) | undefined;
  vi.spyOn(old.serverSocket, 'send').mockImplementation((_data, callback) => {
    complete = callback as (error?: Error) => void;
  });
  broadcastWs({ type: 'R2_DELAYED_WRITE' }, meta => meta.role === 'control');
  expect(typeof complete).toBe('function');
  old.ws.close(); await old.closed;
  const replacement = await ready('control', String(welcome.controlSessionId));
  const next = replacement.messages.find(message => message.type === 'WELCOME')!;
  expect(next.controlSessionId).toBe(welcome.controlSessionId);
  complete!(new Error('Synthetic late write failure'));
  old.serverSocket.emit('close');
  await ping(replacement);
  expect(isLiveAudioControlAuthorized(String(next.controlSessionId))).toBe(true);
  expect(authorizeOperatorCredential({ headers: { 'x-sefer-operator-credential': next.operatorCredential } }, { controlOnly: true })?.ws).toBe(replacement.serverSocket);

  const healthy = await ready('audience');
  vi.spyOn(replacement.serverSocket, 'send').mockImplementation(() => { throw new Error('Synthetic send failure'); });
  broadcastWs({ type: 'R2_SEND_FAILURE' });
  await replacement.closed;
  await waitFor(healthy, message => message.type === 'R2_SEND_FAILURE');
  expect(isLiveAudioControlAuthorized(String(next.controlSessionId))).toBe(false);
});

it('cleans up an asynchronous failed write without affecting a healthy recipient', async () => {
  const target = await ready('audience');
  const healthy = await ready('audience');
  vi.spyOn(target.serverSocket, 'send').mockImplementation((_data, callback) => {
    queueMicrotask(() => (callback as (error: Error) => void)(new Error('Synthetic write failure')));
  });
  broadcastWs({ type: 'R2_ASYNC_FAILURE' });
  await target.closed;
  await waitFor(healthy, message => message.type === 'R2_ASYNC_FAILURE');
  const send = vi.spyOn(target.serverSocket, 'send'); send.mockClear();
  broadcastWs({ type: 'R2_AFTER_WRITE_FAILURE' });
  await waitFor(healthy, message => message.type === 'R2_AFTER_WRITE_FAILURE');
  expect(send).not.toHaveBeenCalled();
});

it('applies the budget to heartbeat ping frames', async () => {
  const slow = await ready('audience');
  const healthy = await ready('audience');
  vi.spyOn(slow.serverSocket, 'bufferedAmount', 'get').mockReturnValue(budget - 1);
  heartbeat();
  await expect(slow.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
  await ping(healthy);
});

it('echoes a normal WebSocket ping payload in its pong', async () => {
  const client = await ready('audience');
  const payload = Buffer.from('א😀');
  const pong = new Promise<Buffer>(resolve => client.ws.once('pong', resolve));
  client.ws.ping(payload);
  await expect(pong).resolves.toEqual(payload);
});

it('bounds pong replies before writing them to a slow connection', async () => {
  const target = await ready('audience');
  const healthy = await ready('presenter');
  vi.spyOn(target.serverSocket, 'bufferedAmount', 'get').mockReturnValue(budget - 1);
  const pong = vi.spyOn(target.serverSocket, 'pong');
  target.ws.ping(Buffer.from('synthetic'));
  await expect(target.closed).resolves.toEqual({ code: 1013, reason: 'Slow consumer' });
  expect(pong).not.toHaveBeenCalled();
  await ping(healthy);
});

it.each(['throw', 'callback'])('isolates a pong write failure through %s', async failure => {
  const target = await ready('audience');
  const healthy = await ready('presenter');
  vi.spyOn(target.serverSocket, 'pong').mockImplementation((_data, _mask, callback) => {
    const error = new Error('Synthetic pong failure');
    if (failure === 'throw') throw error;
    queueMicrotask(() => callback!(error));
  });
  target.ws.ping(Buffer.from('synthetic'));
  await target.closed;
  await ping(healthy);
});

it('terminates only the affected connection if its overflow close throws', async () => {
  const target = await ready('audience');
  const healthy = await ready('presenter');
  vi.spyOn(target.serverSocket, 'bufferedAmount', 'get').mockReturnValue(budget);
  vi.spyOn(target.serverSocket, 'close').mockImplementation(() => { throw new Error('Synthetic close failure'); });
  broadcastWs({ type: 'R2_CLOSE_FAILURE' }, meta => meta.role === 'audience');
  await target.closed;
  await ping(healthy);
});

it('does not send to closed sockets and propagates a legitimate large update', async () => {
  const closed = await ready('audience');
  closed.ws.close(); await closed.closed;
  const send = vi.spyOn(closed.serverSocket, 'send');
  const control = await ready('control');
  const presenter = await ready('presenter');
  const message = { type: 'R2_LARGE_STATE', presentation: { id: 'synthetic', slides: Array.from({ length: 109 }, (_, i) =>
    ({ id: `s${i}`, lines: ['א'.repeat(300), 'a'.repeat(650), 'b'.repeat(650)] })) } };
  expect(wireBytes(message)).toBeGreaterThan(200000);
  expect(wireBytes(message)).toBeLessThan(budget);
  broadcastWs(message);
  await waitFor(control, received => received.type === 'R2_LARGE_STATE');
  await waitFor(presenter, received => received.type === 'R2_LARGE_STATE');
  expect(send).not.toHaveBeenCalled();
});
