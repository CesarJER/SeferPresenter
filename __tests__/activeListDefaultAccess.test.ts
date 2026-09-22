import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  createWsServer,
  getLiveAudioParticipantSnapshot,
  resetWsServerStateForTests,
} from '../server/ws-server.mjs';
import type { LiveAudioParticipantStatusMessage } from '../src/types/liveAudio';

type WsMessage = Record<string, unknown> & { type: string };

interface WsClient {
  ws: WebSocket;
  messages: WsMessage[];
  send: (message: Record<string, unknown> | LiveAudioParticipantStatusMessage) => void;
}

let httpServer: Server;
let wss: WebSocketServer;
let baseUrl: string;
let clients: WsClient[] = [];
const recordExternalBroadcastTransition = vi.fn();

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
      const parsed = JSON.parse(raw.toString()) as WsMessage;
      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.ws.off('message', onMessage);
    };

    client.ws.on('message', onMessage);
  });
};

const connectWs = (role: 'control' | 'audience') =>
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

const makeActiveProfile = (
  participantId: string,
  keySeed: string,
  isAliasVisibleToActiveParticipants: boolean,
  activeListPublicKey = Buffer.from(`public-key-${keySeed}`).toString('base64'),
): WsMessage => ({
  type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
  participantId,
  activeListPublicKey,
  isAliasVisibleToActiveParticipants,
  createdAt: Date.now(),
});

describe('Active List Default Access for Public Profiles', () => {
  beforeEach(async () => {
    delete process.env.VITE_SEFER_PUBLICABLE_DEFAULT;
    process.env.SEFER_REQUIRE_AUTH = 'false';
    process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS = '1';
    resetWsServerStateForTests();
    recordExternalBroadcastTransition.mockReset();

    httpServer = createServer();
    wss = createWsServer(httpServer, undefined, {
      recordExternalBroadcastTransition,
      getLiveKitState: () => ({
        participants: getLiveAudioParticipantSnapshot().participants.map((participant) => ({
          participantId: participant.participantId,
          canPublish: false,
        })),
      }),
    });
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
    delete process.env.SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE;
    delete process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES;
    delete process.env.VITE_SEFER_PUBLICABLE_DEFAULT;
  });

  it('Caso 1: env = false, perfil público -> canViewActiveParticipants = false', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'false';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    audience.send(makeActiveProfile(participantId, 'seed', true));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS');
    await wait(50);
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(false);
  });

  it('Caso 2: env = true, perfil público -> canViewActiveParticipants = true', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'true';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    audience.send(makeActiveProfile(participantId, 'seed', true));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS');
    await wait(50);
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(true);
  });

  it('Caso 3: env = true, perfil privado -> canViewActiveParticipants = false', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'true';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    audience.send(makeActiveProfile(participantId, 'seed', false));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS');
    await wait(50);
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(false);
  });

  it('Caso 4: env = true, inicial = false -> permission = false, make public later -> permission continues false', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'true';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    audience.send(makeActiveProfile(participantId, 'seed', false));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && msg.participantId === participantId);

    // Later make it public
    audience.send(makeActiveProfile(participantId, 'seed', true));
    await wait(100);
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(false);
  });

  it('Caso 5: env = true, inicial = true -> permission = true, make private later -> permission continues true', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'true';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    audience.send(makeActiveProfile(participantId, 'seed', true));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && msg.participantId === participantId);

    // Later make it private
    audience.send(makeActiveProfile(participantId, 'seed', false));
    await wait(100);
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(true);
  });

  it('Caso 6: revocación manual', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'true';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    // Initial public join
    audience.send(makeActiveProfile(participantId, 'seed', true));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && msg.participantId === participantId);
    
    // Control revokes permission
    control.send({
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId,
      canViewActiveParticipants: false,
      createdAt: Date.now(),
    });
    await wait(100);

    // Profile republished
    audience.send(makeActiveProfile(participantId, 'seed', true));
    await wait(100);
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(false);
  });

  it('Caso 7: concesión manual', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'false';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    // Initial public join
    audience.send(makeActiveProfile(participantId, 'seed', true));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && msg.participantId === participantId);
    
    // Control grants permission
    control.send({
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId,
      canViewActiveParticipants: true,
      createdAt: Date.now(),
    });
    await wait(100);

    // Profile republished
    audience.send(makeActiveProfile(participantId, 'seed', true));
    await wait(100);
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(true);
  });

  it('Caso 8: actualizaciones operativas tras concesión manual', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'false';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    audience.send(makeActiveProfile(participantId, 'seed', true));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS');

    control.send({
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId,
      canViewActiveParticipants: true,
      createdAt: Date.now(),
    });
    await wait(100);

    // Operational updates (mic off/on via LIVE_AUDIO_PARTICIPANT_STATUS)
    audience.send({
      type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
      participantId,
      role: 'audience',
      speakerState: 'GRANTED',
      canSubscribe: true,
      canPublishAudio: true,
      isMuted: false,
      isActiveAudience: true,
      isMicrophoneActive: true,
      isKicked: false,
      updatedAt: Date.now(),
    });
    await wait(100);

    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(true);
  });

  it('Caso 9: visibilidad moderada continua funcionando', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'true';
    process.env.SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE = 'false';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    audience.send(makeActiveProfile(participantId, 'seed', true));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS');
    await wait(50);
    
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.isAliasHiddenByControl).toBe(true); // From SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE
    expect(participant?.canViewActiveParticipants).toBe(true); // From SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES
  });

  it('Caso 10: usuario autorizado solo ve aliases permitidos', async () => {
    process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES = 'true';
    const audience = await connectWs('audience');
    const control = await connectWs('control');
    const participantId = randomUUID();

    audience.send(makeActiveProfile(participantId, 'seed', true));
    await waitFor(control, (msg) => msg.type === 'LIVE_AUDIO_PARTICIPANT_STATUS');
    await wait(50);
    
    const participant = getLiveAudioParticipantSnapshot().participants.find((p) => p.participantId === participantId);
    expect(participant?.canViewActiveParticipants).toBe(true);
    expect(participant?.isAliasHiddenByControl).toBe(false);
  });
});
