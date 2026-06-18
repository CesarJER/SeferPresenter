import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  createWsServer,
  getLiveAudioParticipantSnapshot,
  resetWsServerStateForTests,
} from '../server/ws-server.mjs';

type WsMessage = Record<string, unknown> & { type: string };

interface WsClient {
  ws: WebSocket;
  messages: WsMessage[];
  send: (message: WsMessage) => void;
}

let httpServer: Server;
let wss: WebSocketServer;
let baseUrl: string;
let clients: WsClient[] = [];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  client: WsClient,
  predicate: (message: WsMessage) => boolean,
  timeoutMs = 750,
) => {
  const existing = client.messages.find(predicate);
  if (existing) return existing;

  return new Promise<WsMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(raw.toString()) as WsMessage;
        if (predicate(parsed)) {
          cleanup();
          resolve(parsed);
        }
      } catch {
        cleanup();
        reject(new Error('Invalid JSON WebSocket message'));
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.ws.off('message', onMessage);
    };

    client.ws.on('message', onMessage);
  });
};

const connectWs = (role: 'presenter' | 'control' | 'audience' | 'unknown') =>
  new Promise<WsClient>((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}?role=${role}&clientId=${randomUUID()}`);
    const client: WsClient = {
      ws,
      messages: [],
      send: (message) => ws.send(JSON.stringify(message)),
    };

    ws.on('message', (raw) => {
      client.messages.push(JSON.parse(raw.toString()) as WsMessage);
    });
    ws.on('open', () => {
      clients.push(client);
      resolve(client);
    });
    ws.on('error', reject);
  });

const makeParticipantStatus = (participantId: string): WsMessage => ({
  type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
  participantId,
  role: 'audience',
  speakerState: 'LISTENER',
  canSubscribe: true,
  canPublishAudio: false,
  isMuted: false,
  updatedAt: Date.now(),
});

const makePrivateSignal = (participantId: string, suffix = ''): WsMessage => ({
  type: 'PRIVATE_CONTROL_SIGNAL',
  fromParticipantId: participantId,
  keyId: `key-${suffix || 'one'}`,
  ephemeralPublicKey: Buffer.from(`ephemeral-${suffix || 'one'}`).toString('base64'),
  ciphertext: Buffer.from(`ciphertext-${suffix || 'one'}`).toString('base64'),
  nonce: Buffer.alloc(12, suffix.charCodeAt(0) || 1).toString('base64'),
  createdAt: Date.now(),
});

describe('Live Audio WebSocket routing', () => {
  beforeEach(async () => {
    process.env.SEFER_REQUIRE_AUTH = 'false';
    process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS = '1';
    resetWsServerStateForTests();

    httpServer = createServer();
    wss = createWsServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected HTTP server address');
    baseUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) {
        client.ws.close();
      }
    }
    clients = [];
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    resetWsServerStateForTests();
    delete process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS;
  });

  it('routes private audience signals only to authorized controls', async () => {
    const principal = await connectWs('control');
    const pending = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    await waitFor(principal, (message) => message.type === 'WELCOME');
    await waitFor(pending, (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');

    audience.send(makeParticipantStatus(participantId));
    audience.send(makePrivateSignal(participantId));

    const received = await waitFor(principal, (message) => message.type === 'PRIVATE_CONTROL_SIGNAL');
    await wait(100);

    expect(received.fromParticipantId).toBe(participantId);
    expect(pending.messages.some((message) => message.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
  });

  it('does not echo participant status lists to audience clients', async () => {
    const presenter = await connectWs('presenter');
    const sender = await connectWs('audience');
    const observer = await connectWs('audience');
    const participantId = randomUUID();

    sender.send(makeParticipantStatus(participantId));

    const reducedStatus = await waitFor(
      presenter,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId,
    );
    await wait(100);

    expect(reducedStatus).not.toHaveProperty('alias');
    expect(observer.messages.some((message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS')).toBe(false);
  });

  it('rejects moderation actions sent by audience clients', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send({
      type: 'LIVE_AUDIO_GRANT_SPEAK',
      participantId,
      createdAt: Date.now(),
    });
    await wait(100);

    expect(control.messages.some((message) => message.type === 'LIVE_AUDIO_GRANT_SPEAK')).toBe(false);
  });

  it('rate-limits private control signals to five messages per minute per participant', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    for (let index = 0; index < 6; index += 1) {
      audience.send(makePrivateSignal(participantId, String(index + 1)));
    }
    await wait(150);

    const privateSignals = control.messages.filter((message) => message.type === 'PRIVATE_CONTROL_SIGNAL');
    expect(privateSignals).toHaveLength(5);
  });

  it('cleans ephemeral audience participant state after the rejoin grace period', async () => {
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    await wait(50);
    expect(getLiveAudioParticipantSnapshot().participants).toHaveLength(1);

    audience.ws.close();
    await wait(1_250);

    expect(getLiveAudioParticipantSnapshot().participants).toHaveLength(0);
  });
});
