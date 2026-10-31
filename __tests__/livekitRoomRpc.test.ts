import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLiveKitApi, resetLiveKitStateForTests } from '../server/livekit-server.mjs';

let server: Server;
let api: ReturnType<typeof createLiveKitApi>;
let sessionId: string;
let received: { method: string; body: Record<string, string>; grant: Record<string, unknown> }[];
let deleteHangs: boolean;
let creationFails: boolean;

beforeEach(async () => {
  resetLiveKitStateForTests();
  vi.stubEnv('SEFER_LIVE_AUDIO_ENABLED', 'true');
  vi.stubEnv('LIVEKIT_API_KEY', 'synthetic-key');
  vi.stubEnv('LIVEKIT_API_SECRET', 'synthetic-secret-for-local-rpc-tests');
  vi.stubEnv('LIVEKIT_ROOM_NAME', 'synthetic-rpc');
  sessionId = randomUUID(); received = []; deleteHangs = false; creationFails = false;
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const token = String(req.headers.authorization).slice('Bearer '.length);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { video: Record<string, unknown> };
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, string>;
    const method = req.url!.split('/').at(-1)!;
    received.push({ method, body, grant: payload.video });
    if (method === 'DeleteRoom' && deleteHangs) return;
    if (method === 'CreateRoom' && creationFails) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'unavailable', msg: 'Synthetic outage' })); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(method === 'CreateRoom' ? { name: body.name, sid: 'RM_synthetic' } : {}));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  vi.stubEnv('LIVEKIT_URL', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  vi.stubEnv('LIVEKIT_API_URL', process.env.LIVEKIT_URL!);
  api = createLiveKitApi({ getPresentationSessionId: () => sessionId });
});

afterEach(async () => {
  api.close(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  resetLiveKitStateForTests(); vi.unstubAllEnvs();
});

const issue = async () => {
  let result!: { status: number; body: Record<string, unknown> };
  await api.handle({ req: { method: 'POST', headers: {} }, res: {}, url: new URL('http://localhost/api/livekit/token'),
    readBody: async () => JSON.stringify({ role: 'audience' }),
    sendJson: (_res: unknown, status: number, body: Record<string, unknown>) => { result = { status, body }; },
  });
  return result;
};

it('uses the installed SDK over HTTP for canonical creation and old-room deletion', async () => {
  const old = sessionId;
  expect((await issue()).status).toBe(200);
  sessionId = randomUUID(); await api.onPresentationSessionRotated(old);
  expect((await issue()).status).toBe(200);
  expect(received.map(({ method, body }) => [method, body.name || body.room])).toEqual([
    ['CreateRoom', 'synthetic-rpc-' + old], ['DeleteRoom', 'synthetic-rpc-' + old], ['CreateRoom', 'synthetic-rpc-' + sessionId],
  ]);
  expect(received.every(request => request.grant.roomCreate === true)).toBe(true);
});

it('aborts two unresponsive deletion RPCs and preserves the new session', async () => {
  await issue(); const old = sessionId; sessionId = randomUUID(); deleteHangs = true;
  await api.onPresentationSessionRotated(old);
  expect(received.filter(request => request.method === 'DeleteRoom')).toHaveLength(2);
  expect((await issue()).status).toBe(200);
}, 8000);

it('never issues a join token when actual HTTP room creation fails', async () => {
  creationFails = true;
  const result = await issue();
  expect(result.status).toBe(502); expect(result.body).not.toHaveProperty('token');
  expect(api.getState().participants).toHaveLength(0);
});
