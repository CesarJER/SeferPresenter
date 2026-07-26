import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { createWsServer, resetWsServerStateForTests } from '../server/ws-server.mjs';

type Message = Record<string, unknown> & { type: string };

interface Client {
  ws: WebSocket;
  messages: Message[];
  send: (message: Message) => void;
}

let httpServer: Server;
let wss: WebSocketServer;
let wsUrl: string;
let sameOrigin: string;
let clients: Client[] = [];
const fallback = vi.fn(() => true);

const waitFor = (client: Client, predicate: (message: Message) => boolean, timeoutMs = 1000) => {
  const existing = client.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise<Message>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.ws.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const parsed = JSON.parse(raw.toString()) as Message;
      if (!predicate(parsed)) return;
      clearTimeout(timeout);
      client.ws.off('message', onMessage);
      resolve(parsed);
    };
    client.ws.on('message', onMessage);
  });
};

const connect = (role: 'control' | 'presenter' | 'audience', origin?: string) =>
  new Promise<Client>((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}?role=${role}&clientId=${randomUUID()}`, origin ? { origin } : undefined);
    const client: Client = {
      ws,
      messages: [],
      send: (message) => ws.send(JSON.stringify(message)),
    };
    ws.on('message', (raw) => client.messages.push(JSON.parse(raw.toString()) as Message));
    ws.on('open', () => {
      clients.push(client);
      resolve(client);
    });
    ws.on('error', reject);
  });

describe('WebSocket transport authorization', () => {
  beforeEach(async () => {
    process.env.SEFER_REQUIRE_AUTH = 'false';
    delete process.env.SEFER_ALLOWED_ORIGINS;
    fallback.mockClear();
    resetWsServerStateForTests();
    httpServer = createServer();
    wss = createWsServer(httpServer, fallback);
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    wsUrl = `ws://127.0.0.1:${address.port}/ws`;
    sameOrigin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) client.ws.terminate();
    }
    clients = [];
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    resetWsServerStateForTests();
    delete process.env.SEFER_REQUIRE_AUTH;
    delete process.env.SEFER_ALLOWED_ORIGINS;
  });

  it('accepts same-origin clients and closes a cross-origin connection with policy violation', async () => {
    const allowed = await connect('audience', sameOrigin);
    await waitFor(allowed, (message) => message.type === 'WELCOME');

    const forbidden = await connect('audience', 'https://evil.example');
    const error = await waitFor(forbidden, (message) => message.type === 'ERROR');
    expect(error.code).toBe('ORIGIN_FORBIDDEN');
    const closeCode = await new Promise<number>((resolve) => forbidden.ws.once('close', resolve));
    expect(closeCode).toBe(1008);
  });

  it('blocks pending controls before reset, timeline, and telemetry side effects', async () => {
    const principal = await connect('control');
    const pending = await connect('control');
    await waitFor(principal, (message) => message.type === 'WELCOME');
    await waitFor(pending, (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');

    pending.send({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'PLAY' } });
    await waitFor(pending, (message) => message.type === 'ERROR' && message.code === 'CONTROL_PENDING_FORBIDDEN');
    pending.send({ type: 'AUDIO_TELEMETRY', clientId: 'pending', audioState: {} });
    pending.send({
      type: 'REMOTE_COMMAND',
      clientId: 'pending',
      payload: { command: 'RESET_STATE', clearSession: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fallback).not.toHaveBeenCalled();

    const third = await connect('control');
    const thirdState = await waitFor(
      third,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE',
    );
    expect(thirdState.controlState).toBe('PENDING');
  });

  it('allows authorized Control messages but never Presenter remote commands', async () => {
    const control = await connect('control');
    const presenter = await connect('presenter');
    await waitFor(control, (message) => message.type === 'WELCOME');
    await waitFor(presenter, (message) => message.type === 'WELCOME');

    control.send({ type: 'REMOTE_COMMAND', clientId: 'control', payload: { command: 'NEXT_SLIDE' } });
    presenter.send({ type: 'REMOTE_COMMAND', clientId: 'presenter', payload: { command: 'RESET_STATE', clearSession: true } });
    presenter.send({ type: 'AUDIO_TELEMETRY', clientId: 'presenter', audioState: {} });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(fallback.mock.calls.map(([message]) => message.type)).toEqual(['REMOTE_COMMAND', 'AUDIO_TELEMETRY']);
  });

  it('closes messages larger than the 64 KiB transport limit', async () => {
    const audience = await connect('audience');
    await waitFor(audience, (message) => message.type === 'WELCOME');
    const closed = new Promise<number>((resolve) => audience.ws.once('close', resolve));
    audience.ws.send(JSON.stringify({ type: 'SERVER_TIME_PING', padding: 'x'.repeat(70 * 1024) }));
    await expect(closed).resolves.toBe(1009);
  });

  it('does not expose session content or accept participant state before credential binding', async () => {
    const audience = await connect('audience');
    await waitFor(audience, (message) => message.type === 'WELCOME');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(audience.messages.some((message) => message.type === 'AUDIO_TIMELINE_STATE')).toBe(false);

    audience.send({
      type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
      participantId: randomUUID(),
      role: 'audience',
      speakerState: 'LISTENER',
      canSubscribe: true,
      canPublishAudio: false,
    });
    const error = await waitFor(
      audience,
      (message) => message.type === 'ERROR' && message.code === 'AUDIENCE_ACCESS_NOT_BOUND',
    );
    expect(error.code).toBe('AUDIENCE_ACCESS_NOT_BOUND');
  });
});
