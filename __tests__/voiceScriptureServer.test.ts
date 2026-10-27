import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createVoiceScriptureService,
  getVoiceScriptureStatus,
} from '../server/voice-scripture-server.mjs';

const originalEnv = { ...process.env };

const listen = (server: http.Server) => new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
});

const close = (server: http.Server) => new Promise<void>((resolve) => server.close(() => resolve()));

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Voice Scripture server boundary', () => {
  const configure = () => {
    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'true';
    process.env.SEFER_VOICE_SCRIPTURE_STT_URL = 'ws://127.0.0.1:8080/v1/realtime';
    process.env.SEFER_VOICE_SCRIPTURE_READY_URL = 'http://127.0.0.1:8080/ready';
    process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY = 'local-secret';
    process.env.SEFER_CONTROL_PASSWORD = 'control-secret';
  };

  it('cancels capability expiration timers on close, including repeated close', async () => {
    configure();
    vi.useFakeTimers();
    const service = createVoiceScriptureService(http.createServer());
    await service.issueToken({ fetchImpl: async () => new Response(JSON.stringify({ ready: true })) });
    expect(vi.getTimerCount()).toBe(1);
    service.close();
    service.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not issue a capability when readiness completes after service closure', async () => {
    configure();
    vi.useFakeTimers();
    const service = createVoiceScriptureService(http.createServer());
    let complete!: (response: Response) => void;
    const pending = service.issueToken({ fetchImpl: () => new Promise<Response>(resolve => { complete = resolve; }) });
    service.close();
    complete(new Response(JSON.stringify({ ready: true })));
    expect(await pending).not.toHaveProperty('token');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires an unused capability at ten seconds', async () => {
    configure();
    vi.useFakeTimers();
    const service = createVoiceScriptureService(http.createServer());
    await service.issueToken({ fetchImpl: async () => new Response(JSON.stringify({ ready: true })) });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
    service.close();
  });

  it('rejects an expired capability through the real upgrade authorization', async () => {
    configure();
    const appHttp = http.createServer();
    const service = createVoiceScriptureService(appHttp);
    const appPort = await listen(appHttp);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const capability = await service.issueToken({ fetchImpl: async () => new Response(JSON.stringify({ ready: true })) });
    const expiry = timers.mock.calls.find(([, delay]) => delay === 10_000)![0] as () => void;
    expiry();
    const client = new WebSocket(`ws://127.0.0.1:${appPort}/voice-scripture/ws`, ['voice-scripture', capability.token as string], {
      headers: { Origin: `http://127.0.0.1:${appPort}` },
    });
    client.on('error', () => {});
    try {
      const status = await new Promise<number | undefined>(resolve => client.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); }));
      expect(status).toBe(401);
    } finally {
      client.terminate();
      service.close();
      await close(appHttp);
    }
  });

  it.each(['service', 'request'])('cancels a pending upstream handshake when its %s closes', async owner => {
    configure();
    const upstreamHttp = http.createServer();
    const request = new Promise<import('node:stream').Duplex>(resolve => upstreamHttp.once('upgrade', (_req, socket) => resolve(socket)));
    const upstreamPort = await listen(upstreamHttp);
    process.env.SEFER_VOICE_SCRIPTURE_STT_URL = `ws://127.0.0.1:${upstreamPort}/v1/realtime`;
    const appHttp = http.createServer();
    const service = createVoiceScriptureService(appHttp);
    const appPort = await listen(appHttp);
    const client = new WebSocket(`ws://127.0.0.1:${appPort}/voice-scripture/ws`, {
      headers: { Origin: `http://127.0.0.1:${appPort}`, Authorization: `Basic ${Buffer.from('control:control-secret').toString('base64')}` },
    });
    client.on('error', () => {});
    const upstreamSocket = await request;
    upstreamSocket.on('error', () => {});
    upstreamSocket.on('end', () => upstreamSocket.destroy());
    upstreamSocket.resume();
    try {
      if (owner === 'service') service.close();
      else client.terminate();
      await vi.waitFor(() => expect(upstreamSocket.destroyed).toBe(true));
    } finally {
      upstreamSocket.destroy();
      client.terminate();
      service.close();
      await close(appHttp);
      await close(upstreamHttp);
    }
  });

  it('fails closed when disabled or incomplete', async () => {
    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'false';
    expect(await getVoiceScriptureStatus()).toEqual({ enabled: false, available: false, debug: false });

    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'true';
    delete process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY;
    expect(await getVoiceScriptureStatus()).toEqual({ enabled: true, available: false, debug: false });
  });

  it('reports a minimal readiness status', async () => {
    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'true';
    process.env.SEFER_VOICE_SCRIPTURE_STT_URL = 'ws://127.0.0.1:8080/v1/realtime';
    process.env.SEFER_VOICE_SCRIPTURE_READY_URL = 'http://127.0.0.1:8080/ready';
    process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY = 'local-secret';
    process.env.SEFER_CONTROL_PASSWORD = 'control-secret';

    const result = await getVoiceScriptureStatus({
      fetchImpl: async () => new Response(JSON.stringify({ ready: true }), { status: 200 }),
    });
    expect(result).toEqual({ enabled: true, available: true, debug: false });
    expect(result).not.toHaveProperty('sttUrl');
  });

  it('issues a short-lived token separately from status', async () => {
    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'true';
    process.env.SEFER_VOICE_SCRIPTURE_STT_URL = 'ws://127.0.0.1:8080/v1/realtime';
    process.env.SEFER_VOICE_SCRIPTURE_READY_URL = 'http://127.0.0.1:8080/ready';
    process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY = 'local-secret';
    process.env.SEFER_CONTROL_PASSWORD = 'control-secret';

    const appHttp = http.createServer();
    const service = createVoiceScriptureService(appHttp);
    const fetchImpl = async () => new Response(JSON.stringify({ ready: true }), { status: 200 });

    await expect(service.getStatus({ fetchImpl })).resolves.toEqual({ enabled: true, available: true, debug: false });
    await expect(service.issueToken({ fetchImpl })).resolves.toMatchObject({
      enabled: true,
      available: true,
      debug: false,
      token: expect.any(String),
      expiresInMs: 10_000,
    });

    service.close();
  });

  it('emits opt-in diagnostics without exposing server configuration', async () => {
    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'true';
    process.env.SEFER_VOICE_SCRIPTURE_DEBUG = 'true';
    process.env.SEFER_VOICE_SCRIPTURE_STT_URL = 'ws://127.0.0.1:8080/v1/realtime';
    process.env.SEFER_VOICE_SCRIPTURE_READY_URL = 'http://127.0.0.1:8080/ready';
    process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY = 'local-secret';
    process.env.SEFER_CONTROL_PASSWORD = 'control-secret';
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await getVoiceScriptureStatus({
      fetchImpl: async () => new Response(JSON.stringify({ ready: true }), { status: 200 }),
    });

    expect(result).toEqual({ enabled: true, available: true, debug: true });
    expect(result).not.toHaveProperty('sttUrl');
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('"event":"status.ready"'));
  });

  it('proxies text and PCM with a one-use same-origin Control capability', async () => {
    const upstreamHttp = http.createServer();
    const upstreamWss = new WebSocketServer({ server: upstreamHttp, path: '/v1/realtime' });
    upstreamWss.on('connection', (socket, request) => {
      expect(request.headers.authorization).toBe('Bearer local-secret');
      socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }));
    });
    const upstreamPort = await listen(upstreamHttp);

    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'true';
    process.env.SEFER_VOICE_SCRIPTURE_STT_URL = `ws://127.0.0.1:${upstreamPort}/v1/realtime`;
    process.env.SEFER_VOICE_SCRIPTURE_READY_URL = `http://127.0.0.1:${upstreamPort}/ready`;
    process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY = 'local-secret';
    process.env.SEFER_CONTROL_PASSWORD = 'control-secret';

    const appHttp = http.createServer();
    const service = createVoiceScriptureService(appHttp);
    const appPort = await listen(appHttp);
    const timers = vi.spyOn(globalThis, 'setTimeout');
    const capability = await service.issueToken({
      fetchImpl: async () => new Response(JSON.stringify({ ready: true }), { status: 200 }),
    });
    const index = timers.mock.calls.findIndex(([, delay]) => delay === 10_000);
    const expiration = timers.mock.results[index].value;
    const cancel = vi.spyOn(globalThis, 'clearTimeout');
    const client = new WebSocket(
      `ws://127.0.0.1:${appPort}/voice-scripture/ws`,
      ['voice-scripture', capability.token as string],
      { headers: { Origin: `http://127.0.0.1:${appPort}` } },
    );

    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    expect(cancel).toHaveBeenCalledWith(expiration);
    const echoed = new Promise<{ data: Buffer; binary: boolean }>((resolve) => {
      client.once('message', (data, binary) => resolve({ data: data as Buffer, binary }));
    });
    client.send(Buffer.from([1, 2, 3, 4]));
    const result = await echoed;
    expect(result.binary).toBe(true);
    expect([...result.data]).toEqual([1, 2, 3, 4]);

    client.close();
    service.close();
    upstreamWss.close();
    await close(appHttp);
    await close(upstreamHttp);
  });
});

