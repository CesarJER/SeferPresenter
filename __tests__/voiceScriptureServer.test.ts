import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
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
});

describe('Voice Scripture server boundary', () => {
  it('fails closed when disabled or incomplete', async () => {
    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'false';
    expect(await getVoiceScriptureStatus()).toEqual({ enabled: false, available: false });

    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'true';
    delete process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY;
    expect(await getVoiceScriptureStatus()).toEqual({ enabled: true, available: false });
  });

  it('reports only enabled and available from readiness', async () => {
    process.env.SEFER_VOICE_SCRIPTURE_ENABLED = 'true';
    process.env.SEFER_VOICE_SCRIPTURE_STT_URL = 'ws://127.0.0.1:8080/v1/realtime';
    process.env.SEFER_VOICE_SCRIPTURE_READY_URL = 'http://127.0.0.1:8080/ready';
    process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY = 'local-secret';
    process.env.SEFER_CONTROL_PASSWORD = 'control-secret';

    const result = await getVoiceScriptureStatus({
      fetchImpl: async () => new Response(JSON.stringify({ ready: true }), { status: 200 }),
    });
    expect(result).toEqual({ enabled: true, available: true });
    expect(result).not.toHaveProperty('sttUrl');
  });

  it('proxies text and PCM only for authenticated same-origin Control', async () => {
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
    const authorization = `Basic ${Buffer.from('control:control-secret').toString('base64')}`;
    const client = new WebSocket(`ws://127.0.0.1:${appPort}/voice-scripture/ws`, {
      headers: { Authorization: authorization, Origin: `http://127.0.0.1:${appPort}` },
    });

    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
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

