import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  bootstrapAudienceAccess, createWsServer, getLiveAudioControlState, getLiveAudioControlSnapshot,
  getLiveAudioParticipantState, issueAudienceSseTicket, consumeAudienceSseTicket,
  resetWsServerStateForTests,
} from '../server/ws-server.mjs';

type Message = Record<string, unknown> & { type: string };
interface Client { ws: WebSocket; server: WebSocket; messages: Message[] }
let http: Server;
let wss: WebSocketServer & { rotatePresentationSession: () => void };
let url: string;
let clients: Client[];
let stopped: boolean;
let heartbeat: () => void;
let heartbeatHandle: ReturnType<typeof setInterval>;
let revoke: ReturnType<typeof vi.fn>;
let record: ReturnType<typeof vi.fn>;

const send = (client: Client, message: Message) => client.ws.send(JSON.stringify(message));
const received = (client: Client, type: string) => vi.waitFor(() => {
  const message = client.messages.find(message => message.type === type);
  expect(message).toBeDefined();
  return message!;
});
const barrier = async (client: Client) => {
  const marker = randomUUID();
  send(client, { type: 'SERVER_TIME_PING', clientSentAtMs: marker });
  await vi.waitFor(() => expect(client.messages.some(message => message.clientSentAtMs === marker)).toBe(true));
};
const connect = async (role: string, id = randomUUID()) => {
  const accepted = new Promise<WebSocket>(resolve => wss.once('connection', resolve));
  const ws = new WebSocket(`${url}?role=${role}&controlSessionId=${id}`);
  const messages: Message[] = [];
  ws.on('error', () => {});
  ws.on('message', raw => messages.push(JSON.parse(raw.toString()) as Message));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const client = { ws, server: await accepted, messages };
  clients.push(client);
  await received(client, 'WELCOME');
  await barrier(client);
  return client;
};
const disconnect = async (client: Client) => {
  const closed = new Promise<void>(resolve => client.server.once('close', resolve));
  client.ws.close();
  await closed;
};
const trackTimer = (timers: ReturnType<typeof vi.spyOn>, text: string) => {
  const index = timers.mock.calls.findIndex(([callback]) => String(callback).includes(text));
  expect(index).toBeGreaterThanOrEqual(0);
  return { callback: timers.mock.calls[index][0] as () => void, handle: timers.mock.results[index].value };
};
const participant = async () => {
  const access = bootstrapAudienceAccess(null);
  const client = await connect('audience');
  send(client, { type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
  await received(client, 'AUDIENCE_ACCESS_STATE');
  send(client, {
    type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: access.participantId,
    role: 'audience', speakerState: 'LISTENER', canSubscribe: true,
    canPublishAudio: false, isMuted: true, updatedAt: Date.now(),
  });
  await barrier(client);
  expect(getLiveAudioParticipantState(access.participantId)?.connected).toBe(true);
  return { client, access };
};

beforeEach(async () => {
  vi.stubEnv('SEFER_REQUIRE_AUTH', 'false');
  vi.stubEnv('SEFER_LIVE_AUDIO_ENABLED', 'false');
  vi.stubEnv('VITE_SEFER_PUBLICABLE_DEFAULT', 'off');
  resetWsServerStateForTests();
  clients = [];
  stopped = false;
  revoke = vi.fn().mockResolvedValue(true);
  record = vi.fn();
  http = createServer();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  wss = createWsServer(http, undefined, {
    revokeAllLiveKitSpeakers: revoke, recordExternalBroadcastTransition: record,
  });
  const index = intervals.mock.calls.findIndex(([, delay]) => delay === 25_000);
  heartbeat = intervals.mock.calls[index][0] as () => void;
  heartbeatHandle = intervals.mock.results[index].value;
  expect(intervals.mock.calls.filter(([, delay]) => delay === 25_000)).toHaveLength(1);
  intervals.mockRestore();
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(http.address() as { port: number }).port}/ws`;
});

afterEach(async () => {
  clients.forEach(client => client.ws.terminate());
  if (!stopped) await new Promise<void>(resolve => wss.close(() => resolve()));
  await new Promise<void>(resolve => http.close(() => resolve()));
  resetWsServerStateForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('cancels the pending code timer on principal succession', async () => {
  const principal = await connect('control');
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const pending = await connect('control');
  const timer = trackTimer(timers, 'expirePendingControl');
  const cancel = vi.spyOn(globalThis, 'clearTimeout');
  await disconnect(principal);
  const id = pending.messages.find(message => message.type === 'WELCOME')!.controlSessionId as string;
  expect(getLiveAudioControlState(id)?.controlState).toBe('PRINCIPAL');
  expect(cancel).toHaveBeenCalledWith(timer.handle);
  timer.callback();
  expect(getLiveAudioControlState(id)?.controlState).toBe('PRINCIPAL');
});

it('does not expire a replacement pending Control with an obsolete callback', async () => {
  await connect('control');
  const id = randomUUID();
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const original = await connect('control', id);
  const timer = trackTimer(timers, 'expirePendingControl');
  await disconnect(original);
  const replacement = await connect('control', id);
  const before = await received(replacement, 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE');
  expect(before?.verificationCode).toBeDefined();
  replacement.messages.length = 0;
  timer.callback();
  await barrier(replacement);
  expect(replacement.messages.some(message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE')).toBe(false);
  expect(getLiveAudioControlSnapshot().controls.find(control => control.controlSessionId === id)?.codeExpiresAt).toBe(before.codeExpiresAt);
});

it('expires the current pending code at the deadline and refuses late approval', async () => {
  const principal = await connect('control');
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const pending = await connect('control');
  const id = pending.messages.find(message => message.type === 'WELCOME')!.controlSessionId as string;
  const before = getLiveAudioControlSnapshot().controls.find(control => control.controlSessionId === id)!;
  expect(before.codeExpiresAt).toBeTypeOf('number');
  vi.spyOn(Date, 'now').mockReturnValue(before.codeExpiresAt);
  trackTimer(timers, 'expirePendingControl').callback();
  expect(getLiveAudioControlState(id)?.verificationCode).toBeUndefined();
  send(principal, { type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: id, decision: 'APPROVE' });
  expect(await received(principal, 'ERROR')).toMatchObject({ code: 'CONTROL_AUTH_CODE_EXPIRED' });
  expect(getLiveAudioControlState(id)?.controlState).toBe('PENDING');
});

it('cancels participant timers during rotation and ignores callbacks from the old session', async () => {
  const { client, access } = await participant();
  const timers = vi.spyOn(globalThis, 'setTimeout');
  await disconnect(client);
  const timer = trackTimer(timers, 'cleanupExpiredParticipant');
  const cancel = vi.spyOn(globalThis, 'clearTimeout');
  wss.rotatePresentationSession();
  expect(cancel).toHaveBeenCalledWith(timer.handle);
  expect(getLiveAudioParticipantState(access.participantId)).toBeNull();
  timer.callback();
  expect(getLiveAudioParticipantState(access.participantId)).toBeNull();
});

it('retains a rejoined participant until its own grace deadline and cancels a swept timer', async () => {
  const { client, access } = await participant();
  const timers = vi.spyOn(globalThis, 'setTimeout');
  await disconnect(client);
  const original = trackTimer(timers, 'cleanupExpiredParticipant');
  const replacement = await connect('audience');
  send(replacement, { type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
  await received(replacement, 'AUDIENCE_ACCESS_STATE');
  send(replacement, { type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: access.participantId, role: 'audience', speakerState: 'LISTENER', canSubscribe: true, canPublishAudio: false, isMuted: true });
  await barrier(replacement);
  original.callback();
  expect(getLiveAudioParticipantState(access.participantId)?.connected).toBe(true);
  timers.mockClear();
  await disconnect(replacement);
  const current = trackTimer(timers, 'cleanupExpiredParticipant');
  const deadline = getLiveAudioParticipantState(access.participantId)!.disconnectedAt + 60_000;
  const now = vi.spyOn(Date, 'now').mockReturnValue(deadline - 1);
  current.callback();
  expect(getLiveAudioParticipantState(access.participantId)).not.toBeNull();
  now.mockReturnValue(deadline);
  const cancel = vi.spyOn(globalThis, 'clearTimeout');
  heartbeat();
  expect(getLiveAudioParticipantState(access.participantId)).toBeNull();
  expect(cancel).toHaveBeenCalledWith(current.handle);
  original.callback();
  current.callback();
  expect(getLiveAudioParticipantState(access.participantId)).toBeNull();
});

it('closes with no participant timers, heartbeat or upgrade listener left behind', async () => {
  const { client } = await participant();
  const timers = vi.spyOn(globalThis, 'setTimeout');
  await disconnect(client);
  const timer = trackTimer(timers, 'cleanupExpiredParticipant');
  const cancel = vi.spyOn(globalThis, 'clearTimeout');
  const cancelInterval = vi.spyOn(globalThis, 'clearInterval');
  await new Promise<void>(resolve => wss.close(() => resolve()));
  stopped = true;
  expect(cancelInterval).toHaveBeenCalledWith(heartbeatHandle);
  expect(cancel).toHaveBeenCalledWith(timer.handle);
  expect(http.listenerCount('upgrade')).toBe(0);
  timer.callback();
});

it.each(['disconnect', 'rotation', 'shutdown'])('discards a late broadcast transition after %s', async ending => {
  let complete!: (value: boolean) => void;
  revoke.mockImplementation(() => new Promise<boolean>(resolve => { complete = resolve; }));
  const control = await connect('control');
  send(control, { type: 'LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE', state: 'recording' });
  await barrier(control);
  expect(revoke).toHaveBeenCalledOnce();
  if (ending === 'rotation') wss.rotatePresentationSession();
  await disconnect(control);
  if (ending === 'shutdown') {
    await new Promise<void>(resolve => wss.close(() => resolve()));
    stopped = true;
  }
  complete(true);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(record).not.toHaveBeenCalled();
});

it('reaps unused expired SSE tickets while preserving unexpired single-use tickets', () => {
  const access = bootstrapAudienceAccess(null);
  const start = Date.now();
  const now = vi.spyOn(Date, 'now').mockReturnValue(start);
  const expired = issueAudienceSseTicket(access.credential, 'STATE');
  now.mockReturnValue(start + 1);
  const live = issueAudienceSseTicket(access.credential, 'STATE');
  const deletion = vi.spyOn(Map.prototype, 'delete');
  now.mockReturnValue(start + 30_000);
  heartbeat();
  expect(deletion).toHaveBeenCalledWith(expired);
  expect(deletion).not.toHaveBeenCalledWith(live);
  expect(consumeAudienceSseTicket(expired, 'STATE')).toBeNull();
  expect(consumeAudienceSseTicket(live, 'STATE')?.participantId).toBe(access.participantId);
  expect(consumeAudienceSseTicket(live, 'STATE')).toBeNull();
});
