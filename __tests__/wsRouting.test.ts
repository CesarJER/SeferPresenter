import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { decrypt, deriveSharedKey, encrypt, exportPublicKey, generateSessionKeyPair } from '../src/utils/cryptoUtils';
import {
  createWsServer,
  bootstrapAudienceAccess,
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
let liveKitPermissions: Map<string, boolean>;

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

const makeControlPrivateSignal = (participantId: string, suffix = ''): WsMessage => ({
  type: 'PRIVATE_CONTROL_SIGNAL',
  fromParticipantId: `control-session-${suffix || 'one'}`,
  toParticipantId: participantId,
  keyId: `key-${suffix || 'one'}`,
  ephemeralPublicKey: Buffer.from(`control-public-${suffix || 'one'}`).toString('base64'),
  ciphertext: Buffer.from(`control-ciphertext-${suffix || 'one'}`).toString('base64'),
  nonce: Buffer.alloc(12, suffix.charCodeAt(0) || 2).toString('base64'),
  createdAt: Date.now(),
});

describe('Live Audio WebSocket routing', () => {
  beforeEach(async () => {
    process.env.SEFER_REQUIRE_AUTH = 'false';
    process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS = '1';
    resetWsServerStateForTests();
    liveKitPermissions = new Map();

    httpServer = createServer();
    wss = createWsServer(httpServer, undefined, {
      getLiveKitState: () => ({
        participants: Array.from(liveKitPermissions, ([participantId, canPublish]) => ({ participantId, canPublish })),
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
    delete process.env.SEFER_SESSION_ACCESS_DEFAULT;
  });

  it('relays encrypted reply synchronization to authorized Controls including sender, but never a pending Control', async () => {
    const principal = await connectWs('control');
    const secondary = await connectWs('control');
    const pending = await waitFor(secondary, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');
    principal.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: pending.controlSessionId, decision: 'APPROVE' });
    await waitFor(secondary, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'AUTHORIZED');
    const outsider = await connectWs('control');
    await waitFor(outsider, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');
    const keyPair = await generateSessionKeyPair();
    const key = await deriveSharedKey(keyPair.privateKey, keyPair.publicKey);
    const plaintext = JSON.stringify({ type: 'MESSAGE_REPLY_SYNC', replyId: 'reply-1', messageId: 'message-1', responseText: 'Synthetic private reply' });
    const encrypted = await encrypt(key, plaintext);
    const welcome = await waitFor(principal, message => message.type === 'WELCOME');
    const frame: WsMessage = {
      type: 'PRIVATE_CONTROL_SIGNAL', fromParticipantId: welcome.controlSessionId as string,
      keyId: 'reply-key', ephemeralPublicKey: await exportPublicKey(keyPair), ...encrypted,
    };
    expect(JSON.stringify(frame)).not.toContain('Synthetic private reply');
    principal.send(frame);
    const received = await waitFor(secondary, message => message.type === 'PRIVATE_CONTROL_SIGNAL');
    expect(await decrypt(key, received.ciphertext as string, received.nonce as string)).toBe(plaintext);
    expect((await waitFor(principal, message => message.type === 'PRIVATE_CONTROL_SIGNAL')).ciphertext).toBe(encrypted.ciphertext);
    await wait(50);
    expect(outsider.messages.some(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
  });

  it('requires Control admission when the session access mode is controlled', async () => {
    process.env.SEFER_SESSION_ACCESS_DEFAULT = 'CONTROLLED';
    resetWsServerStateForTests();
    const principal = await connectWs('control');
    const audience = await connectWs('audience');
    const access = bootstrapAudienceAccess(null);

    await waitFor(principal, (message) => message.type === 'WELCOME');
    audience.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
    await waitFor(audience, (message) => message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'REQUEST_REQUIRED');
    audience.send({
      type: 'AUDIENCE_ACCESS_REQUEST',
      participantId: access.participantId,
      createdAt: Date.now(),
    });

    await waitFor(principal, (message) => (
      message.type === 'AUDIENCE_ACCESS_REQUEST' && message.participantId === access.participantId
    ));
    principal.send({
      type: 'AUDIENCE_ACCESS_DECISION',
      participantId: access.participantId,
      decision: 'ADMIT',
      createdAt: Date.now(),
    });

    const admitted = await waitFor(audience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'ADMITTED'
    ));
    expect(admitted.participantId).toBe(access.participantId);

    const liveAudioParticipantId = randomUUID();
    audience.send(makeParticipantStatus(liveAudioParticipantId));
    await waitFor(principal, (message) => (
      message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' &&
      message.participantId === liveAudioParticipantId
    ));

    liveKitPermissions.set(liveAudioParticipantId, true);
    principal.send({
      type: 'LIVE_AUDIO_GRANT_SPEAK',
      participantId: liveAudioParticipantId,
      createdAt: Date.now(),
    });
    const grant = await waitFor(audience, (message) => (
      message.type === 'LIVE_AUDIO_GRANT_SPEAK' &&
      message.participantId === liveAudioParticipantId
    ));
    expect(grant.participantId).toBe(liveAudioParticipantId);

    audience.send({ type: 'AUDIENCE_ACCESS_LEAVE', createdAt: Date.now() });
    await waitFor(audience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'REQUEST_REQUIRED'
    ));
    audience.send(makePrivateSignal(access.participantId, 'second-request'));
    await waitFor(principal, (message) => (
      message.type === 'PRIVATE_CONTROL_SIGNAL' &&
      message.fromParticipantId === access.participantId
    ));
    audience.send({
      type: 'AUDIENCE_ACCESS_REQUEST',
      participantId: access.participantId,
      createdAt: Date.now(),
    });
    await waitFor(principal, (message) => (
      message.type === 'AUDIENCE_ACCESS_REQUEST' &&
      message.participantId === access.participantId &&
      typeof message.requestedAt === 'number'
    ));

    principal.send({
      type: 'AUDIENCE_ACCESS_DECISION',
      participantId: access.participantId,
      decision: 'BLOCK',
      createdAt: Date.now(),
    });
    await waitFor(audience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'BLOCKED'
    ));
    principal.send({ type: 'LIVE_AUDIO_SNAPSHOT_REQUEST', createdAt: Date.now() });
    const snapshot = await waitFor(principal, (message) => {
      if (message.type !== 'LIVE_AUDIO_SNAPSHOT') return false;
      const value = message.snapshot as { audienceAccessRequests?: Array<{ participantId: string; accessState: string }> };
      return value.audienceAccessRequests?.some((request) => (
        request.participantId === access.participantId && request.accessState === 'BLOCKED'
      )) === true;
    });
    expect(snapshot.type).toBe('LIVE_AUDIO_SNAPSHOT');

    principal.send({
      type: 'AUDIENCE_ACCESS_DECISION',
      participantId: access.participantId,
      decision: 'UNBLOCK',
      createdAt: Date.now(),
    });
    const unblocked = await waitFor(audience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'WAITING'
    ));
    expect(unblocked.accessState).toBe('WAITING');
  });

  it('keeps nicked audience admitted and requires access from anonymous audience when switching to controlled', async () => {
    const principal = await connectWs('control');
    const nickedAudience = await connectWs('audience');
    const anonymousAudience = await connectWs('audience');
    const nickedAccess = bootstrapAudienceAccess(null);
    const anonymousAccess = bootstrapAudienceAccess(null);

    nickedAudience.send({ type: 'AUDIENCE_ACCESS_BIND', credential: nickedAccess.credential });
    anonymousAudience.send({ type: 'AUDIENCE_ACCESS_BIND', credential: anonymousAccess.credential });
    await waitFor(nickedAudience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'ADMITTED'
    ));
    await waitFor(anonymousAudience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'ADMITTED'
    ));

    const nickedParticipantId = randomUUID();
    nickedAudience.send(makeParticipantStatus(nickedParticipantId));
    nickedAudience.send({
      type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
      participantId: nickedParticipantId,
      activeListPublicKey: Buffer.from('nicked-audience-public-key').toString('base64'),
      isAliasVisibleToActiveParticipants: false,
      createdAt: Date.now(),
    });
    await waitFor(principal, (message) => (
      message.type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE' &&
      message.participantId === nickedParticipantId
    ));

    principal.send({
      type: 'SESSION_ACCESS_POLICY_UPDATE',
      accessMode: 'CONTROLLED',
      createdAt: Date.now(),
    });
    await waitFor(nickedAudience, (message) => (
      message.type === 'SESSION_ACCESS_POLICY' && message.accessMode === 'CONTROLLED'
    ));
    await waitFor(anonymousAudience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'REQUEST_REQUIRED'
    ));

    nickedAudience.send({ ...makeParticipantStatus(nickedParticipantId), speakerState: 'REQUESTED' });
    const status = await waitFor(principal, (message) => (
      message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' &&
      message.participantId === nickedParticipantId &&
      message.speakerState === 'REQUESTED'
    ));
    expect(status.participantId).toBe(nickedParticipantId);
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

  it('routes private control signals only to the target audience participant', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const observer = await connectWs('audience');
    const participantId = randomUUID();
    const observerParticipantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    observer.send(makeParticipantStatus(observerParticipantId));
    await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId,
    );

    control.send(makeControlPrivateSignal(participantId));

    const received = await waitFor(
      audience,
      (message) => message.type === 'PRIVATE_CONTROL_SIGNAL' && message.toParticipantId === participantId,
    );
    await wait(100);

    expect(received.toParticipantId).toBe(participantId);
    expect(observer.messages.some((message) => message.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
  });

  it('blocks private control signals from pending controls', async () => {
    const principal = await connectWs('control');
    const pending = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    await waitFor(principal, (message) => message.type === 'WELCOME');
    await waitFor(pending, (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');
    audience.send(makeParticipantStatus(participantId));

    pending.send(makeControlPrivateSignal(participantId, 'pending'));

    const error = await waitFor(
      pending,
      (message) => message.type === 'ERROR' && message.code === 'CONTROL_PENDING_FORBIDDEN',
    );
    await wait(100);

    expect(String(error.message)).toContain('private signals');
    expect(audience.messages.some((message) => message.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
  });

  it('routes empty alias requests from authorized controls to audience clients', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');

    await waitFor(control, (message) => message.type === 'WELCOME');
    control.send({
      type: 'LIVE_AUDIO_REQUEST_ALIASES',
      createdAt: Date.now(),
    });

    const request = await waitFor(audience, (message) => message.type === 'LIVE_AUDIO_REQUEST_ALIASES');

    expect(request).not.toHaveProperty('alias');
    expect(request).not.toHaveProperty('participantId');
  });

  it('replays the current control public key to audience clients that connect later', async () => {
    const control = await connectWs('control');
    const welcome = await waitFor(control, (message) => message.type === 'WELCOME');

    control.send({
      type: 'LIVE_AUDIO_CONTROL_PUBLIC_KEY',
      controlSessionId: String(welcome.controlSessionId),
      keyId: 'control-key-one',
      publicKey: Buffer.from('control-public-key-one').toString('base64'),
      createdAt: Date.now(),
    });

    const audience = await connectWs('audience');
    const key = await waitFor(
      audience,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_PUBLIC_KEY' && message.keyId === 'control-key-one',
    );

    expect(key.publicKey).toBe(Buffer.from('control-public-key-one').toString('base64'));
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

    [
      {
        type: 'LIVE_AUDIO_GRANT_SPEAK',
        participantId,
        createdAt: Date.now(),
      },
      {
        type: 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY',
        participantId,
        isAliasHiddenByControl: true,
        createdAt: Date.now(),
      },
      {
        type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
        participantId,
        canViewActiveParticipants: true,
        createdAt: Date.now(),
      },
      {
        type: 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
        participantId,
        createdAt: Date.now(),
      },
    ].forEach((message) => audience.send(message));
    await wait(100);

    expect(control.messages.some((message) => message.type === 'LIVE_AUDIO_GRANT_SPEAK')).toBe(false);
    expect(control.messages.some((message) => message.type === 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY')).toBe(false);
    expect(control.messages.some((message) => message.type === 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION')).toBe(false);
    expect(control.messages.some((message) => message.type === 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT')).toBe(false);
  });

  it('does not broadcast a grant before the LiveKit permission update is confirmed', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();
    audience.send(makeParticipantStatus(participantId));
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);

    liveKitPermissions.set(participantId, false);
    control.send({ type: 'LIVE_AUDIO_GRANT_SPEAK', participantId, createdAt: Date.now() });
    const error = await waitFor(control, (message) => message.type === 'ERROR' && message.code === 'LIVEKIT_PERMISSION_NOT_CONFIRMED');

    expect(error.code).toBe('LIVEKIT_PERMISSION_NOT_CONFIRMED');
    expect(audience.messages.some((message) => message.type === 'LIVE_AUDIO_GRANT_SPEAK')).toBe(false);
    expect(getLiveAudioParticipantSnapshot().participants.find((participant) => participant.participantId === participantId)?.speakerState).not.toBe('GRANTED');
  });

  it('keeps client reported publication permission and connection telemetry separate from authority', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();
    liveKitPermissions.set(participantId, false);
    audience.send({ ...makeParticipantStatus(participantId), speakerState: 'GRANTED', canPublishAudio: true,
      isMicrophoneActive: true, isMuted: false, liveAudioConnectionState: 'connected' });
    const status = await waitFor(control, (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);
    expect(status).toMatchObject({ speakerState: 'LISTENER', canPublishAudio: false, isMicrophoneActive: false, liveAudioConnectionState: 'connected' });
  });

  it('ignores null and non-object messages without terminating the WebSocket server', async () => {
    const audience = await connectWs('audience');
    audience.ws.send('null');
    audience.ws.send('[]');
    audience.send({ type: 'SERVER_TIME_PING', clientSentAtMs: 1234 });
    expect(await waitFor(audience, (message) => message.type === 'SERVER_TIME_PONG')).toMatchObject({ clientSentAtMs: 1234 });
  });

  it('broadcasts total live audio websocket connection counts to control and presenter', async () => {
    const presenter = await connectWs('presenter');
    const control = await connectWs('control');
    const audience = await connectWs('audience');

    const controlCounts = await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_CONNECTION_COUNTS' && message.totalConnections === 3,
    );
    const presenterCounts = await waitFor(
      presenter,
      (message) => message.type === 'LIVE_AUDIO_CONNECTION_COUNTS' && message.totalConnections === 3,
    );
    await wait(100);

    expect(controlCounts.audienceConnections).toBe(1);
    expect(controlCounts.controlConnections).toBe(1);
    expect(controlCounts.presenterConnections).toBe(1);
    expect(presenterCounts.totalConnections).toBe(3);
    expect(audience.messages.some((message) => message.type === 'LIVE_AUDIO_CONNECTION_COUNTS')).toBe(false);
  });

  it('routes control moderation actions to the target audience participant', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const observer = await connectWs('audience');
    const participantId = randomUUID();
    const observerParticipantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    observer.send(makeParticipantStatus(observerParticipantId));
    await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId,
    );

    liveKitPermissions.set(participantId, true);
    control.send({
      type: 'LIVE_AUDIO_GRANT_SPEAK',
      participantId,
      createdAt: Date.now(),
    });

    const grant = await waitFor(
      audience,
      (message) => message.type === 'LIVE_AUDIO_GRANT_SPEAK' && message.participantId === participantId,
    );
    await wait(100);

    expect(grant.participantId).toBe(participantId);
    expect(observer.messages.some((message) => message.type === 'LIVE_AUDIO_GRANT_SPEAK')).toBe(false);
  });

  it('keeps kicked participants passive until control grants them again', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send({
      ...makeParticipantStatus(participantId),
      isActiveAudience: true,
      speakerState: 'REQUESTED',
    });
    await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId,
    );

    liveKitPermissions.set(participantId, false);
    control.send({
      type: 'LIVE_AUDIO_KICK_PARTICIPANT',
      participantId,
      createdAt: Date.now(),
    });
    await waitFor(
      control,
      (message) =>
        message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' &&
        message.participantId === participantId &&
        message.isKicked === true,
    );

    audience.send({
      ...makeParticipantStatus(participantId),
      speakerState: 'REQUESTED',
      isActiveAudience: true,
      isKicked: false,
    });
    await wait(100);

    const snapshot = getLiveAudioParticipantSnapshot().participants.find(
      (participant) => participant.participantId === participantId,
    );
    expect(snapshot?.speakerState).toBe('REVOKED');
    expect(snapshot?.isActiveAudience).toBe(false);
    expect(snapshot?.isKicked).toBe(true);
  });

  it('sends an operational snapshot to a secondary control after authorization', async () => {
    const principal = await connectWs('control');
    const secondary = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    const pending = await waitFor(
      secondary,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING',
    );
    audience.send({
      ...makeParticipantStatus(participantId),
      isActiveAudience: true,
      speakerState: 'REQUESTED',
    });
    await waitFor(
      principal,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId,
    );

    principal.send({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION',
      targetControlSessionId: pending.controlSessionId,
      decision: 'APPROVE',
      createdAt: Date.now(),
    });

    const snapshot = await waitFor(secondary, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
    const participants = snapshot.snapshot as { participants?: Array<{ participantId: string; speakerState: string }> };
    expect(participants.participants?.some((participant) => (
      participant.participantId === participantId && participant.speakerState === 'REQUESTED'
    ))).toBe(true);
  });

  it('sends an operational snapshot to a new control when the previous control is gone', async () => {
    const firstControl = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send({
      ...makeParticipantStatus(participantId),
      isActiveAudience: true,
    });
    await waitFor(
      firstControl,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId,
    );

    firstControl.ws.close();
    await wait(100);
    const nextControl = await connectWs('control');
    const snapshot = await waitFor(nextControl, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
    const body = snapshot.snapshot as { participants?: Array<{ participantId: string }> };
    expect(body.participants?.some((participant) => participant.participantId === participantId)).toBe(true);
  });

  it('does not send operational snapshots to pending controls', async () => {
    await connectWs('control');
    const pending = await connectWs('control');

    await waitFor(
      pending,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING',
    );
    pending.send({
      type: 'LIVE_AUDIO_SNAPSHOT_REQUEST',
      createdAt: Date.now(),
    });
    const error = await waitFor(
      pending,
      (message) => message.type === 'ERROR' && message.code === 'CONTROL_PENDING_FORBIDDEN',
    );
    await wait(100);

    expect(String(error.message)).toContain('snapshots');
    expect(pending.messages.some((message) => message.type === 'LIVE_AUDIO_SNAPSHOT')).toBe(false);
  });

  it('rescues kicked participants as active listeners without microphone publishing', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send({
      ...makeParticipantStatus(participantId),
      isActiveAudience: true,
      speakerState: 'REQUESTED',
    });
    await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId,
    );

    liveKitPermissions.set(participantId, false);
    control.send({
      type: 'LIVE_AUDIO_KICK_PARTICIPANT',
      participantId,
      createdAt: Date.now(),
    });
    await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId && message.isKicked === true,
    );

    control.send({
      type: 'LIVE_AUDIO_RESCUE_PARTICIPANT',
      participantId,
      createdAt: Date.now(),
    });

    const rescued = await waitFor(
      control,
      (message) => (
        message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' &&
        message.participantId === participantId &&
        message.isKicked === false &&
        message.speakerState === 'LISTENER'
      ),
    );
    expect(rescued.speakerState).toBe('LISTENER');
    expect(rescued.isActiveAudience).toBe(true);
    expect(rescued.canPublishAudio).toBe(false);
    expect(rescued.isMicrophoneActive).toBe(false);
  });

  it('does not include historical private messages in operational snapshots', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    audience.send(makePrivateSignal(participantId, 'secret'));
    await waitFor(control, (message) => message.type === 'PRIVATE_CONTROL_SIGNAL');

    control.send({
      type: 'LIVE_AUDIO_SNAPSHOT_REQUEST',
      createdAt: Date.now(),
    });

    const snapshot = await waitFor(control, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('PRIVATE_CONTROL_SIGNAL');
    expect(serialized).not.toContain('ciphertext');
    expect(serialized).not.toContain(Buffer.from('ciphertext-secret').toString('base64'));
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
