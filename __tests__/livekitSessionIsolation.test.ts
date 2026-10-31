import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { createPresentationSessionStore } from '../server/presentation-session.mjs';
import { createLiveKitApi, resetLiveKitStateForTests } from '../server/livekit-server.mjs';
import {
  authorizeAudienceCredential, authorizeOperatorCredential, bootstrapAudienceAccess,
  createWsServer, getSessionAccessMode, isLiveAudioControlAuthorized, resetWsServerStateForTests,
} from '../server/ws-server.mjs';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
type Body = Record<string, unknown>;
let api: ReturnType<typeof createLiveKitApi>;
let store: ReturnType<typeof createPresentationSessionStore>;
let server: Server;
let wss: WebSocketServer & { rotatePresentationSession: () => void };
let directory: string;
let base: string;
let sockets: WebSocket[];
let retirements: Promise<unknown>[];
let sdk: { createRoom: ReturnType<typeof vi.fn>; deleteRoom: ReturnType<typeof vi.fn>; updateParticipant: ReturnType<typeof vi.fn> };

const tokenRoom = (body: Body) => (JSON.parse(Buffer.from(String(body.token).split('.')[1], 'base64url').toString()) as { video: { room: string; roomCreate?: boolean } }).video;
const call = async (route: string, body: Body, credential?: string) => {
  const response = await fetch(base + '/api/livekit/' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? {
      'X-Sefer-Operator-Credential': credential, Authorization: `Basic ${Buffer.from('control:synthetic-password').toString('base64')}`,
    } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Body };
};
const control = () => new Promise<Body>((resolve, reject) => {
  const socket = new WebSocket(base.replace('http', 'ws') + '/ws?role=control');
  sockets.push(socket);
  socket.on('error', reject);
  socket.on('message', raw => { const body = JSON.parse(raw.toString()) as Body; if (body.type === 'WELCOME') resolve(body); });
});
const rotate = () => { wss.rotatePresentationSession(); return store.getSessionId(); };
const issue = async (body: Body = {}) => {
  const result = await call('token', { role: 'audience', ...body });
  expect(result.status).toBe(200);
  return result.body;
};

beforeEach(async () => {
  vi.stubEnv('SEFER_REQUIRE_AUTH', 'false');
  vi.stubEnv('SEFER_CONTROL_PASSWORD', 'synthetic-password');
  vi.stubEnv('SEFER_LIVE_AUDIO_ENABLED', 'true');
  vi.stubEnv('SEFER_SESSION_ACCESS_DEFAULT', 'PUBLIC');
  vi.stubEnv('LIVEKIT_URL', 'ws://synthetic.invalid');
  vi.stubEnv('LIVEKIT_API_KEY', 'synthetic-key');
  vi.stubEnv('LIVEKIT_API_SECRET', 'synthetic-secret-for-session-isolation-tests');
  vi.stubEnv('LIVEKIT_ROOM_NAME', 'synthetic-room');
  resetWsServerStateForTests(); resetLiveKitStateForTests();
  sockets = []; retirements = [];
  directory = mkdtempSync(path.join(tmpdir(), 'sefer-rtc-session-'));
  store = createPresentationSessionStore({ filePath: path.join(directory, 'session.json') });
  sdk = { createRoom: vi.fn().mockResolvedValue({}), deleteRoom: vi.fn().mockResolvedValue(undefined), updateParticipant: vi.fn().mockResolvedValue({}) };
  api = createLiveKitApi({
    getPresentationSessionId: () => store.getSessionId(), authorizeAudienceCredential,
    authorizeOperatorCredential, isLiveAudioControlAuthorized, getSessionAccessMode,
  }, { roomServiceClient: sdk });
  server = createServer(async (req, res) => {
    await api.handle({ req, res, url: new URL(req.url!, 'http://localhost'),
      readBody: async () => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer); return Buffer.concat(chunks).toString(); },
      sendJson: (_res: unknown, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); },
    });
  });
  wss = createWsServer(server, undefined, { presentationSessionStore: store,
    onPresentationSessionRotated: (previous: string) => { retirements.push(api.onPresentationSessionRotated(previous)); },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  sockets.forEach(socket => socket.terminate());
  api.close();
  await Promise.allSettled(retirements);
  await new Promise<void>(resolve => wss.close(() => resolve()));
  await new Promise<void>(resolve => server.close(() => resolve()));
  resetWsServerStateForTests(); resetLiveKitStateForTests();
  expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});

it('creates only the canonical room, ignores client roomSession and gives no roomCreate grant', async () => {
  const result = await issue({ roomSession: 'attacker-selected' });
  expect(tokenRoom(result).room).toBe('synthetic-room-' + store.getSessionId());
  expect(tokenRoom(result).roomCreate).not.toBe(true);
  expect(sdk.createRoom).toHaveBeenCalledExactlyOnceWith({ name: tokenRoom(result).room });
});

it('invalidates old records and refresh credentials while keeping new PUBLIC listeners eligible', async () => {
  const before = await issue();
  rotate();
  expect(api.getState().participants).toHaveLength(0);
  expect((await call('refresh-token', { participantId: before.participantId, refreshCredential: before.refreshCredential })).status).toBe(403);
  const after = await issue();
  expect(tokenRoom(after).room).not.toBe(tokenRoom(before).room);
  await Promise.all(retirements);
  expect(sdk.deleteRoom).toHaveBeenCalledWith(tokenRoom(before).room);
});

it('preserves CONTROLLED admission across rotation', async () => {
  vi.stubEnv('SEFER_SESSION_ACCESS_DEFAULT', 'CONTROLLED');
  rotate();
  const access = bootstrapAudienceAccess(null);
  expect((await call('token', { role: 'audience', audienceAccessCredential: access.credential })).status).toBe(403);
  expect((await call('token', { role: 'audience' })).status).toBe(403);
  expect(sdk.createRoom).not.toHaveBeenCalled();
});

it('accepts only current admitted Audience under CONTROLLED using the real Control decision', async () => {
  vi.stubEnv('SEFER_SESSION_ACCESS_DEFAULT', 'CONTROLLED'); rotate();
  await control(); const access = bootstrapAudienceAccess(null);
  sockets[0].send(JSON.stringify({ type: 'AUDIENCE_ACCESS_DECISION', participantId: access.participantId, decision: 'ADMIT' }));
  await vi.waitFor(() => expect(authorizeAudienceCredential(access.credential)).not.toBeNull());
  const token = await issue({ audienceAccessCredential: access.credential });
  rotate();
  expect((await call('refresh-token', { participantId: token.participantId, refreshCredential: token.refreshCredential, audienceAccessCredential: access.credential })).status).toBe(403);
  expect((await call('token', { role: 'audience', audienceAccessCredential: access.credential })).status).toBe(403);
});

it('rejects a token request whose body finishes loading after rotation', async () => {
  const body = deferred<string>(); let status = 0;
  const request = api.handle({ req: { method: 'POST', headers: {} }, res: {}, url: new URL('/api/livekit/token', base),
    readBody: () => body.promise, sendJson: (_res: unknown, code: number) => { status = code; },
  });
  rotate(); body.resolve(JSON.stringify({ role: 'audience' })); await request;
  expect(status).toBe(403); expect(sdk.createRoom).not.toHaveBeenCalled();
});

it('fails closed when room creation fails', async () => {
  sdk.createRoom.mockRejectedValueOnce(Object.assign(new Error('synthetic'), { code: 'unavailable', status: 503 }));
  const failed = await call('token', { role: 'audience' });
  expect(failed.status).toBe(502); expect(failed.body).not.toHaveProperty('token');
  expect(api.getState().participants).toHaveLength(0);
});

it('does not fall back to a shared room without a canonical session getter', async () => {
  const unscoped = createLiveKitApi({}, { roomServiceClient: sdk });
  let status = 0;
  try {
    await unscoped.handle({ req: { method: 'POST', headers: {} }, res: {}, url: new URL('/api/livekit/token', base),
      readBody: async () => JSON.stringify({ role: 'audience' }), sendJson: (_res: unknown, code: number) => { status = code; },
    });
    expect(status).toBe(403); expect(sdk.createRoom).not.toHaveBeenCalled();
  } finally { unscoped.close(); }
});

it('revalidates a Control credential after room creation before issuing its token', async () => {
  const owner = await control();
  const pending = deferred<unknown>(); sdk.createRoom.mockReturnValue(pending.promise);
  const response = call('token', { role: 'control', controlSessionId: owner.controlSessionId }, String(owner.operatorCredential));
  await vi.waitFor(() => expect(sdk.createRoom).toHaveBeenCalled());
  sockets[0].terminate();
  await vi.waitFor(() => expect(isLiveAudioControlAuthorized(String(owner.controlSessionId))).toBe(false));
  pending.resolve({});
  expect((await response).status).toBe(403);
});

it('rejects an old token request and deletes only after its in-flight creation completes', async () => {
  const old = store.getSessionId(); const pending = deferred<unknown>();
  sdk.createRoom.mockReturnValueOnce(pending.promise);
  const response = call('token', { role: 'audience' });
  await vi.waitFor(() => expect(sdk.createRoom).toHaveBeenCalledOnce());
  const next = rotate();
  const current = await issue();
  expect(tokenRoom(current).room).toBe('synthetic-room-' + next);
  expect(sdk.deleteRoom).not.toHaveBeenCalled();
  pending.resolve({});
  expect((await response).status).toBe(403);
  await Promise.all(retirements);
  expect(sdk.deleteRoom).toHaveBeenCalledExactlyOnceWith('synthetic-room-' + old);
});

it('coalesces concurrent creation but recreates the current room on a later refresh after inactivity', async () => {
  const arrivals = vi.fn(); server.on('request', arrivals);
  const pending = deferred<unknown>(); sdk.createRoom.mockReturnValueOnce(pending.promise);
  const first = call('token', { role: 'audience' });
  await vi.waitFor(() => expect(sdk.createRoom).toHaveBeenCalledOnce());
  const second = call('token', { role: 'audience' });
  await vi.waitFor(() => expect(arrivals).toHaveBeenCalledTimes(2));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(sdk.createRoom).toHaveBeenCalledOnce();
  pending.resolve({});
  const [one, two] = await Promise.all([first, second]);
  expect(one.status).toBe(200); expect(two.status).toBe(200);
  const refreshed = await call('refresh-token', { participantId: one.body.participantId, refreshCredential: one.body.refreshCredential });
  expect(refreshed.status).toBe(200);
  expect(sdk.createRoom).toHaveBeenLastCalledWith({ name: tokenRoom(one.body).room });
});

it('isolates two rapid rotations with deletion completions in reverse order', async () => {
  const a = tokenRoom(await issue()).room;
  const deletionA = deferred<void>(); const deletionB = deferred<void>();
  sdk.deleteRoom.mockImplementation((name: string) => name === a ? deletionA.promise : deletionB.promise);
  rotate(); const b = tokenRoom(await issue()).room;
  rotate(); const c = tokenRoom(await issue()).room;
  await vi.waitFor(() => expect(sdk.deleteRoom).toHaveBeenCalledTimes(2));
  deletionB.resolve(); deletionA.resolve(); await Promise.all(retirements);
  expect(sdk.deleteRoom.mock.calls.map(([name]) => name).sort()).toEqual([a, b].sort());
  expect(sdk.deleteRoom).not.toHaveBeenCalledWith(c);
});

it.each(['not_found', 'permission_denied', 'unavailable'])('bounds old-room deletion failure %s without rolling back the new session', async code => {
  const before = await issue(); const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  sdk.deleteRoom.mockRejectedValue(Object.assign(new Error(String(before.token)), { code, status: code === 'unavailable' ? 503 : code === 'not_found' ? 404 : 403 }));
  const next = rotate(); await Promise.all(retirements);
  expect(store.getSessionId()).toBe(next);
  expect(tokenRoom(await issue()).room).toBe('synthetic-room-' + next);
  expect(sdk.deleteRoom).toHaveBeenCalledTimes(code === 'unavailable' ? 2 : 1);
  expect(JSON.stringify(log.mock.calls)).not.toContain(before.token);
  if (code !== 'not_found') expect(log).toHaveBeenCalled();
});

it('does not let stale moderation restore records after rotation', async () => {
  const owner = await control(); const target = await issue();
  const pending = deferred<unknown>(); sdk.updateParticipant.mockReturnValueOnce(pending.promise);
  const response = call('grant-speak', { role: 'control', controlSessionId: owner.controlSessionId, participantId: target.participantId }, String(owner.operatorCredential));
  await vi.waitFor(() => expect(sdk.updateParticipant).toHaveBeenCalledOnce());
  rotate(); const current = await issue(); pending.resolve({});
  expect((await response).status).toBe(403);
  expect(api.getState().participants.map(p => p.participantId)).toEqual([current.participantId]);
  expect(api.getState().speakers).toEqual([]);
});

it('discards a previous session global revocation without changing the new participants', async () => {
  const owner = await control(); const target = await issue();
  expect((await call('grant-speak', { role: 'control', controlSessionId: owner.controlSessionId, participantId: target.participantId }, String(owner.operatorCredential))).status).toBe(200);
  sdk.updateParticipant.mockClear();
  const pending = deferred<unknown>(); sdk.updateParticipant.mockReturnValueOnce(pending.promise);
  const revocation = api.revokeAllSpeakers();
  await vi.waitFor(() => expect(sdk.updateParticipant).toHaveBeenCalledOnce());
  rotate(); const current = await issue();
  expect(await api.revokeAllSpeakers()).toBe(true);
  pending.resolve({}); expect(await revocation).toBe(false);
  expect(api.getState().participants.map(p => p.participantId)).toEqual([current.participantId]);
});

it('preserves the canonical room across a restart with a valid marker', async () => {
  const before = await issue();
  const restarted = createPresentationSessionStore({ filePath: path.join(directory, 'session.json') });
  expect('synthetic-room-' + restarted.getSessionId()).toBe(tokenRoom(before).room);
});

it('does not create rooms when RTC is disabled or initial authorization fails', async () => {
  vi.stubEnv('SEFER_LIVE_AUDIO_ENABLED', 'false');
  expect((await call('token', { role: 'audience' })).status).toBe(503);
  expect(sdk.createRoom).not.toHaveBeenCalled();
});
