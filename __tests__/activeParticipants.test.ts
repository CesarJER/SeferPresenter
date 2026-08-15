import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import {
  createWsServer,
  getLiveAudioParticipantSnapshot,
  resetWsServerStateForTests,
} from '../server/ws-server.mjs';
import {
  computeVisibleActiveParticipants,
  hasVisibleParticipantsChanged,
  serializeVisibleParticipants,
} from '../src/features/liveAudio/utils/activeParticipants';
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

const makeParticipantStatus = (
  participantId: string,
  patch: Partial<LiveAudioParticipantStatusMessage> = {},
): LiveAudioParticipantStatusMessage => ({
  type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
  participantId,
  role: 'audience',
  speakerState: 'LISTENER',
  canSubscribe: true,
  canPublishAudio: false,
  isMuted: true,
  isActiveAudience: true,
  isMicrophoneActive: false,
  isKicked: false,
  updatedAt: Date.now(),
  ...patch,
});

const makeActiveProfile = (
  participantId: string,
  keySeed: string,
  activeListPublicKey = Buffer.from(`public-key-${keySeed}`).toString('base64'),
): WsMessage => ({
  type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
  participantId,
  activeListPublicKey,
  isAliasVisibleToActiveParticipants: true,
  createdAt: Date.now(),
});

describe('visible active participants', () => {
  beforeEach(async () => {
    delete process.env.VITE_SEFER_PUBLICABLE_DEFAULT;
    process.env.SEFER_REQUIRE_AUTH = 'false';
    process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS = '1';
    resetWsServerStateForTests();
    recordExternalBroadcastTransition.mockReset();

    httpServer = createServer();
    wss = createWsServer(httpServer, undefined, { recordExternalBroadcastTransition });
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
    delete process.env.VITE_SEFER_PUBLICABLE_DEFAULT;
  });

  it('rejects making an alias visible when the participant did not consent', async () => {
    process.env.SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE = 'false';
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);

    control.send({
      type: 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY',
      participantId,
      isAliasHiddenByControl: false,
      createdAt: Date.now(),
    });
    await wait(100);

    const participant = getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId);
    expect(participant?.isAliasVisibleToActiveParticipants).toBe(false);
    expect(participant?.isAliasHiddenByControl).toBe(true);
  });

  it('sends the backend audio timeline to audience clients as read-only state', async () => {
    const audience = await connectWs('audience');

    const timeline = await waitFor(audience, (message) => message.type === 'AUDIO_TIMELINE_STATE');

    expect(timeline.timeline).toMatchObject({
      status: 'idle',
      audioSrc: null,
      syncMode: 'none',
    });
  });

  it('applies control alias hiding after participant consent', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);
    control.send({
      type: 'LIVE_AUDIO_SNAPSHOT_PATCH',
      snapshot: {
        participants: [{
          participantId,
          role: 'audience',
          isAliasVisibleToActiveParticipants: true,
        }],
      },
      createdAt: Date.now(),
    });
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');

    control.send({
      type: 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY',
      participantId,
      isAliasHiddenByControl: true,
      createdAt: Date.now(),
    });
    await wait(100);

    const participant = getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId);
    expect(participant?.isAliasVisibleToActiveParticipants).toBe(true);
    expect(participant?.isAliasHiddenByControl).toBe(true);
  });

  it('uses the moderation default visibility when registering participants', async () => {
    process.env.SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE = 'true';
    const control = await connectWs('control');
    const visibleAudience = await connectWs('audience');
    const visibleParticipantId = randomUUID();

    visibleAudience.send(makeParticipantStatus(visibleParticipantId));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === visibleParticipantId);
    expect(getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === visibleParticipantId)?.isAliasHiddenByControl).toBe(false);

    resetWsServerStateForTests();
    process.env.SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE = 'false';
    const hiddenAudience = await connectWs('audience');
    const hiddenParticipantId = randomUUID();

    hiddenAudience.send(makeParticipantStatus(hiddenParticipantId));
    await wait(100);
    expect(getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === hiddenParticipantId)?.isAliasHiddenByControl).toBe(true);
  });

  it('updates view permission only for an active participant with an E2E public key', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);
    audience.send(makeActiveProfile(participantId, 'active'));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE' && message.participantId === participantId);

    control.send({
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId,
      canViewActiveParticipants: true,
      createdAt: Date.now(),
    });
    await wait(100);

    expect(getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId)?.canViewActiveParticipants).toBe(true);
  });

  it('sends list-view permission changes in clear to the active target participant', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);
    audience.send(makeActiveProfile(participantId, 'target'));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE' && message.participantId === participantId);

    control.send({
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId,
      canViewActiveParticipants: true,
      createdAt: Date.now(),
    });

    const permission = await waitFor(
      audience,
      (message) => message.type === 'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION' && message.participantId === participantId,
    );

    expect(permission.canViewActiveParticipants).toBe(true);
  });

  it('routes only the public key and consent flag in the clear active profile', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();
    const activeListPublicKey = Buffer.from('audience-visible-list-key').toString('base64');

    audience.send(makeParticipantStatus(participantId));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);
    audience.send(makeActiveProfile(participantId, 'profile', activeListPublicKey));

    const profile = await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE' && message.participantId === participantId,
    );
    const participant = getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId);

    expect(profile).not.toHaveProperty('alias');
    expect(profile.activeListPublicKey).toBe(activeListPublicKey);
    expect(participant?.activeListPublicKey).toBe(activeListPublicKey);
    expect(participant?.isAliasVisibleToActiveParticipants).toBe(true);
  });

  it('rejects list permission for a passive Audience even when an authorized Control targets its id', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId, { isActiveAudience: false }));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);

    control.send({
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId,
      canViewActiveParticipants: true,
      createdAt: Date.now(),
    });

    const error = await waitFor(control, (message) => message.type === 'ERROR' && message.code === 'ACTIVE_AUDIENCE_REQUIRED');
    expect(error.code).toBe('ACTIVE_AUDIENCE_REQUIRED');
    expect(getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId)?.canViewActiveParticipants).toBe(false);
  });

  it('revokes existing microphone grants before declaring an external recording state', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId, {
      speakerState: 'GRANTED',
      canPublishAudio: true,
      isMuted: false,
      isMicrophoneActive: true,
    }));
    await waitFor(control, (message) => (
      message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' &&
      message.participantId === participantId &&
      message.speakerState === 'GRANTED'
    ));

    control.send({
      type: 'LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE',
      state: 'recording',
      createdAt: Date.now(),
    });

    const state = await waitFor(audience, (message) => (
      message.type === 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE' && message.state === 'recording'
    ));
    await waitFor(audience, (message) => (
      message.type === 'LIVE_AUDIO_REVOKE_SPEAK' && message.participantId === participantId
    ));

    expect(state.revision).toBe(1);
    expect(recordExternalBroadcastTransition).toHaveBeenCalledWith(expect.objectContaining({
      previousState: 'off',
      nextState: 'recording',
      revision: 1,
    }));
    expect(getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId)).toMatchObject({
      speakerState: 'LISTENER',
      canPublishAudio: false,
      isMuted: true,
      isMicrophoneActive: false,
    });
  });

  it('keeps a raised hand when the participant republishes alias visibility', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId, { speakerState: 'REQUESTED' }));
    await waitFor(
      control,
      (message) => (
        message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' &&
        message.participantId === participantId &&
        message.speakerState === 'REQUESTED'
      ),
    );

    audience.send(makeActiveProfile(participantId, 'Mano Levantada'));
    await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE' && message.participantId === participantId,
    );

    const participant = getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId);
    expect(participant?.speakerState).toBe('REQUESTED');
    expect(participant?.isActiveAudience).toBe(true);
    expect(participant?.canPublishAudio).toBe(false);
    expect(participant?.isMicrophoneActive).toBe(false);
  });

  it('keeps operational state when list-view permission changes', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId, {
      speakerState: 'GRANTED',
      canPublishAudio: true,
      isMuted: false,
      isMicrophoneActive: true,
    }));
    await waitFor(
      control,
      (message) => (
        message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' &&
        message.participantId === participantId &&
        message.speakerState === 'GRANTED'
      ),
    );

    control.send({
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId,
      canViewActiveParticipants: false,
      createdAt: Date.now(),
    });
    await wait(100);

    const participant = getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId);
    expect(participant?.speakerState).toBe('GRANTED');
    expect(participant?.isActiveAudience).toBe(true);
    expect(participant?.canPublishAudio).toBe(true);
    expect(participant?.isMuted).toBe(false);
    expect(participant?.isMicrophoneActive).toBe(true);
  });

  it('removes only kicked participants and clears active-list flags', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);

    control.send({
      type: 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
      participantId,
      createdAt: Date.now(),
    });
    await wait(100);
    expect(getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId)?.isActiveAudience).toBe(true);

    control.send({
      type: 'LIVE_AUDIO_KICK_PARTICIPANT',
      participantId,
      createdAt: Date.now(),
    });
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId && message.isKicked === true);

    control.send({
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId,
      canViewActiveParticipants: true,
      createdAt: Date.now(),
    });
    control.send({
      type: 'LIVE_AUDIO_SNAPSHOT_PATCH',
      snapshot: {
        participants: [{
          participantId,
          role: 'audience',
          isAliasVisibleToActiveParticipants: true,
        }],
      },
      createdAt: Date.now(),
    });
    await wait(100);

    control.send({
      type: 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
      participantId,
      createdAt: Date.now(),
    });
    await waitFor(audience, (message) => message.type === 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT' && message.participantId === participantId);

    const participant = getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === participantId);
    expect(participant?.isKicked).toBe(false);
    expect(participant?.isActiveAudience).toBe(false);
    expect(participant?.isAliasVisibleToActiveParticipants).toBe(false);
    expect(participant?.canViewActiveParticipants).toBe(false);
    expect(participant?.isAliasHiddenByControl).toBe(false);
  });

  it('computes visible aliases with eligibility filters and Spanish A-Z ordering', () => {
    const participantsMap: Record<string, LiveAudioParticipantStatusMessage> = {
      a: makeParticipantStatus('a' as `${string}-${string}-${string}-${string}-${string}`),
      b: makeParticipantStatus('b' as `${string}-${string}-${string}-${string}-${string}`, { isAliasHiddenByControl: true }),
      c: makeParticipantStatus('c' as `${string}-${string}-${string}-${string}-${string}`, { isKicked: true }),
      d: makeParticipantStatus('d' as `${string}-${string}-${string}-${string}-${string}`, { isActiveAudience: false }),
      e: makeParticipantStatus('e' as `${string}-${string}-${string}-${string}-${string}`),
    };

    participantsMap.a.isAliasVisibleToActiveParticipants = true;
    participantsMap.b.isAliasVisibleToActiveParticipants = true;
    participantsMap.c.isAliasVisibleToActiveParticipants = true;
    participantsMap.d.isAliasVisibleToActiveParticipants = true;
    participantsMap.e.isAliasVisibleToActiveParticipants = false;

    const aliases = {
      a: 'David',
      b: 'Aarón',
      c: 'Beto',
      d: 'Carlos',
      e: 'Ester',
    };

    expect(computeVisibleActiveParticipants(participantsMap, aliases)).toEqual(['David']);

    participantsMap.e.isAliasVisibleToActiveParticipants = true;
    aliases.e = 'Aarón';
    expect(computeVisibleActiveParticipants(participantsMap, aliases)).toEqual(['Aarón', 'David']);
  });

  it('detects differential visible-list distribution', () => {
    const initial = ['Aarón', 'David'];
    const serialized = serializeVisibleParticipants(initial);

    expect(hasVisibleParticipantsChanged(initial, serialized)).toBe(false);
    expect(hasVisibleParticipantsChanged(['Aarón', 'Ester'], serialized)).toBe(true);
  });
});
