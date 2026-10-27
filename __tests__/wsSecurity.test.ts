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

const connect = (role: 'control' | 'presenter' | 'audience' | 'unknown', origin?: string) =>
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
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

  it('closes ordinary Audience messages larger than 64 KiB', async () => {
    const audience = await connect('audience');
    await waitFor(audience, (message) => message.type === 'WELCOME');
    const closed = new Promise<number>((resolve) => audience.ws.once('close', resolve));
    audience.ws.send(JSON.stringify({ type: 'SERVER_TIME_PING', padding: 'x'.repeat(70 * 1024) }));
    await expect(closed).resolves.toBe(1009);
  });

  const largeState = (type: 'REMOTE_COMMAND' | 'SYNC_STATE', targetBytes: number): Message => {
    const presentation = { id: 'synthetic', title: 'Synthetic', mode: 'standard', background: '', slides: [
      { id: 's', label: 'Synthetic', lines: ['', '', '', ''] },
    ] };
    const message: Message = type === 'REMOTE_COMMAND'
      ? { type, clientId: 'synthetic', payload: { command: 'SELECT_PRESENTATION_AND_SLIDE', presentation, slideIndex: 0 } }
      : { type, clientId: 'synthetic', origin: 'presenter', presentation, slideIndex: 0,
        backgroundLock: false, lockedBackgroundValue: null, userSelectedBackground: null,
        videoState: null, appMode: 'slides', scriptureState: null,
        audioState: { isPlaying: false, currentTime: 0, duration: 0, volume: 0.7, audioSrc: null,
          activeSyncMapId: null, syncMode: 'none', lastUpdatedBy: 'controller', timestamp: 0 } };
    let remaining = targetBytes - Buffer.byteLength(JSON.stringify(message));
    expect(remaining).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < presentation.slides[0].lines.length; i++) {
      const size = Math.min(remaining, 180_000);
      presentation.slides[0].lines[i] = 'x'.repeat(size);
      remaining -= size;
    }
    expect(remaining).toBe(0);
    expect(Buffer.byteLength(JSON.stringify(message))).toBe(targetBytes);
    return message;
  };

  const barrier = async (client: Client) => {
    const marker = randomUUID();
    client.send({ type: 'SERVER_TIME_PING', clientSentAtMs: marker });
    await waitFor(client, message => message.type === 'SERVER_TIME_PONG' && message.clientSentAtMs === marker);
  };

  it.each([
    ['control', 'REMOTE_COMMAND'], ['control', 'SYNC_STATE'], ['presenter', 'SYNC_STATE'],
  ] as const)('accepts a large presentation from %s in %s', async (role, type) => {
    const client = await connect(role);
    await waitFor(client, message => message.type === 'WELCOME');
    client.send(largeState(type, 209_000));
    await barrier(client);
    const received = fallback.mock.calls as unknown as [Message, { role: string }][];
    expect(received.some(([message, meta]) => message.type === type && meta.role === role)).toBe(true);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('accepts a large state with active video, scripture and quiz data', async () => {
    const presenter = await connect('presenter');
    await waitFor(presenter, message => message.type === 'WELCOME');
    const message = largeState('SYNC_STATE', 80_000);
    message.videoState = { isPlaying: true, currentTime: 1, duration: 10, volume: 0.5, speed: 1,
      lastUpdatedBy: 'projection', timestamp: 1 };
    message.scriptureState = { bookEs: '', bookHeb: '', bookAbbrevEs: '', chapter: '1', verseStart: '1', verse: '1',
      verseNikud: '', transliteration: '', translation: '', verseIdx: 0, totalVerses: 1 };
    message.quizState = { currentSubslideIndex: 0, timerState: { status: 'idle', timerStartedAt: null,
      timerDurationMs: 0, pausedRemainingMs: null }, presenterDemoSelection: {} };
    message.autoduckState = { enabled: false, factor: 0.2 };
    presenter.send(message); await barrier(presenter);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('enforces the ordinary and presentation limits at their exact byte boundaries', async () => {
    const principal = await connect('control');
    await waitFor(principal, message => message.type === 'WELCOME');
    const ping = { type: 'SERVER_TIME_PING', padding: '' };
    const available = 65536 - Buffer.byteLength(JSON.stringify(ping));
    ping.padding = 'א'.repeat(Math.floor(available / 2)) + 'x'.repeat(available % 2);
    principal.send(ping); await barrier(principal);
    principal.send(largeState('REMOTE_COMMAND', 65537));
    await barrier(principal);
    const large = largeState('REMOTE_COMMAND', 512 * 1024);
    const serialized = JSON.stringify(large);
    principal.ws.send(serialized.slice(0, 200000), { fin: false });
    principal.ws.send(serialized.slice(200000), { fin: true });
    await barrier(principal);
    expect(fallback).toHaveBeenCalledTimes(2);
    const close = new Promise<number>(resolve => principal.ws.once('close', resolve));
    principal.send(largeState('REMOTE_COMMAND', 512 * 1024 + 1));
    await expect(close).resolves.toBe(1009);

    const ordinary = await connect('control');
    await waitFor(ordinary, message => message.type === 'WELCOME');
    const closed = new Promise<number>(resolve => ordinary.ws.once('close', resolve));
    ordinary.send({ ...ping, padding: `${ping.padding}x` });
    await expect(closed).resolves.toBe(1009);
  });

  it.each(['pending', 'audience', 'unknown', 'presenter-command', 'unrelated', 'malformed', 'invalid-presentation', 'invalid-sync-state', 'invalid-video', 'invalid-scripture', 'invalid-quiz', 'invalid-protocol', 'invalid-autoduck', 'excess-metadata'] as const)(
    'rejects large messages without the presentation exception: %s', async scenario => {
      const principal = await connect('control');
      await waitFor(principal, message => message.type === 'WELCOME');
      const role = scenario === 'pending' ? 'control' : scenario === 'presenter-command' ? 'presenter'
        : scenario === 'audience' ? 'audience' : scenario === 'unknown' ? 'unknown' : 'presenter';
      const client = await connect(role);
      await waitFor(client, message => message.type === 'WELCOME');
      const message = largeState(scenario === 'presenter-command' ? 'REMOTE_COMMAND' : 'SYNC_STATE', 70_000);
      if (scenario === 'unrelated') message.type = 'AUDIO_TELEMETRY';
      if (scenario === 'invalid-presentation') (message.presentation as { mode: string }).mode = 'invalid';
      if (scenario === 'invalid-sync-state') message.audioState = {};
      if (scenario === 'invalid-video') message.videoState = {};
      if (scenario === 'invalid-scripture') message.scriptureState = {};
      if (scenario === 'invalid-quiz') message.quizState = {};
      if (scenario === 'invalid-protocol') message.protocolVersion = 2;
      if (scenario === 'invalid-autoduck') message.autoduckState = {};
      if (scenario === 'excess-metadata') message.padding = 'x'.repeat(65537);
      const closed = new Promise<number>(resolve => client.ws.once('close', resolve));
      client.ws.send(scenario === 'malformed' ? `{${'x'.repeat(70_000)}` : JSON.stringify(message));
      await expect(closed).resolves.toBe(1009);
      await barrier(principal);
      expect(principal.ws.readyState).toBe(WebSocket.OPEN);
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid large selection from an authorized Control without affecting another client', async () => {
    const control = await connect('control');
    const healthy = await connect('audience');
    await waitFor(control, message => message.type === 'WELCOME');
    await waitFor(healthy, message => message.type === 'WELCOME');
    const message = largeState('REMOTE_COMMAND', 70_000);
    (message.payload as { slideIndex: unknown }).slideIndex = 'invalid';
    const closed = new Promise<number>(resolve => control.ws.once('close', resolve));
    control.send(message);
    await expect(closed).resolves.toBe(1009);
    await barrier(healthy);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('bounds nested data before handing a large message to the projection coordinator', async () => {
    const control = await connect('control');
    await waitFor(control, message => message.type === 'WELCOME');
    const nestedSelection = (levels: number) => {
      const message = largeState('REMOTE_COMMAND', 70_000);
      let nested: unknown = 0;
      for (let i = 0; i < levels; i++) nested = [nested];
      (message.payload as { presentation: Record<string, unknown> }).presentation.extra = nested;
      return message;
    };
    control.send(nestedSelection(126)); await barrier(control);
    expect(fallback).toHaveBeenCalledTimes(1);
    const closed = new Promise<number>(resolve => control.ws.once('close', resolve));
    control.send(nestedSelection(127));
    await expect(closed).resolves.toBe(1009);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it.each([
    [true, 'APPROVE'], [true, 'REJECT'], [false, 'APPROVE'], [false, 'REJECT'],
  ] as const)('preserves delegated=%s authorization for %s decisions and pending exclusion', async (delegated, decision) => {
    vi.stubEnv('SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS', String(delegated));
    const principal = await connect('control');
    const secondary = await connect('control');
    const secondaryPending = await waitFor(secondary, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');
    expect(secondaryPending.verificationCode).toMatch(/^\d{3}-\d{3}$/);
    principal.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: secondaryPending.controlSessionId, decision: 'APPROVE' });
    const authorized = await waitFor(secondary, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'AUTHORIZED');
    expect(authorized.allowDelegatedModerators).toBe(delegated);
    expect(authorized).not.toHaveProperty('verificationCode');
    expect(authorized).not.toHaveProperty('codeExpiresAt');
    expect('pendingControls' in authorized).toBe(delegated);

    const target = await connect('control');
    const pending = await waitFor(target, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');
    target.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: pending.controlSessionId, decision });
    await waitFor(target, message => message.type === 'ERROR' && message.code === 'CONTROL_AUTH_FORBIDDEN');
    expect(target.messages.some(message => message.type === 'LIVE_AUDIO_SNAPSHOT')).toBe(false);

    secondary.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: pending.controlSessionId, decision });
    if (!delegated) {
      await waitFor(secondary, message => message.type === 'ERROR' && message.code === 'CONTROL_AUTH_FORBIDDEN');
      expect(target.messages.some(message => message.controlState === 'AUTHORIZED')).toBe(false);
      // The principal retains authority when delegation is disabled; no code is supplied in either decision.
      principal.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: pending.controlSessionId, decision });
    }
    if (decision === 'APPROVE') {
      const state = await waitFor(target, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'AUTHORIZED');
      await waitFor(target, message => message.type === 'LIVE_AUDIO_SNAPSHOT');
      expect(state).not.toHaveProperty('verificationCode');
      expect(state).not.toHaveProperty('codeExpiresAt');
      const frames = target.messages.filter(message => message.controlState === 'AUTHORIZED' || message.type === 'LIVE_AUDIO_SNAPSHOT');
      expect(frames.map(message => message.type)).toEqual(['LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE', 'LIVE_AUDIO_SNAPSHOT']);
    } else {
      const closed = new Promise<[number, string]>(resolve => target.ws.once('close', (code, reason) => resolve([code, reason.toString()])));
      await expect(closed).resolves.toEqual([4003, 'Control authorization rejected']);
      const lastState = target.messages.filter(message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE').at(-1)!;
      expect(lastState.controlState).toBe('PENDING');
      expect(lastState).not.toHaveProperty('verificationCode');
      expect(lastState.codeExpiresAt).toEqual(expect.any(Number));
      expect(target.messages.some(message => message.type === 'LIVE_AUDIO_SNAPSHOT')).toBe(false);
    }
    principal.messages.length = 0;
    principal.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: pending.controlSessionId, decision: 'APPROVE' });
    await waitFor(principal, message => message.type === 'ERROR' && message.code === 'CONTROL_AUTH_TARGET_INVALID');
  });

  it('retains missing-target and expired-code checks before authorization mutation', async () => {
    const principal = await connect('control');
    principal.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: 'missing-control', decision: 'APPROVE' });
    await waitFor(principal, message => message.type === 'ERROR' && message.code === 'CONTROL_AUTH_TARGET_INVALID');
    const target = await connect('control');
    const pending = await waitFor(target, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');
    target.messages.length = 0;
    vi.spyOn(Date, 'now').mockReturnValue((pending.codeExpiresAt as number) + 1);
    principal.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: pending.controlSessionId, decision: 'APPROVE' });
    await waitFor(principal, message => message.type === 'ERROR' && message.code === 'CONTROL_AUTH_CODE_EXPIRED');
    const state = await waitFor(target, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE');
    expect(state.controlState).toBe('PENDING');
    expect(state.verificationCode).toBe(pending.verificationCode);
    expect(state.codeExpiresAt).toBe(pending.codeExpiresAt);
    expect(target.messages.some(message => message.type === 'LIVE_AUDIO_SNAPSHOT')).toBe(false);
  });
});
