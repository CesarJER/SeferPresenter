import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { decrypt, deriveSharedKey, encrypt, exportPublicKey, generateSessionKeyPair } from '../src/utils/cryptoUtils';
import {
  createWsServer,
  bootstrapAudienceAccess,
  broadcastWs,
  getLiveAudioControlSnapshot,
  getLiveAudioControlState,
  getLiveAudioParticipantState,
  getLiveAudioParticipantSnapshot,
  isLiveAudioControlAuthorized,
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
let heartbeatTick: () => void;

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

const connectWs = (role: 'presenter' | 'control' | 'audience' | 'unknown', controlSessionId?: string) =>
  new Promise<WsClient>((resolve, reject) => {
    const ws = new WebSocket(`${baseUrl}?role=${role}&clientId=${randomUUID()}${controlSessionId ? `&controlSessionId=${encodeURIComponent(controlSessionId)}` : ''}`);
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

const flushMessages = async (sender: WsClient, recipients: WsClient[]) => {
  const ping = async (client: WsClient) => {
    const marker = randomUUID();
    client.send({ type: 'SERVER_TIME_PING', clientSentAtMs: marker });
    await waitFor(client, message => message.type === 'SERVER_TIME_PONG' && message.clientSentAtMs === marker);
  };
  // The sender barrier precedes recipient barriers, so earlier routed frames have arrived.
  await ping(sender);
  await Promise.all(recipients.map(ping));
};

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
    const intervals = vi.spyOn(globalThis, 'setInterval');
    wss = createWsServer(httpServer, undefined, {
      getLiveKitState: () => ({
        participants: Array.from(liveKitPermissions, ([participantId, canPublish]) => ({ participantId, canPublish })),
      }),
    });
    heartbeatTick = intervals.mock.calls.find(([, ms]) => ms === 25_000)![0] as () => void;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected HTTP server address');
    baseUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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
    vi.unstubAllEnvs();
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

  it('discovers an admitted recipient before any private message and routes both E2EE conversation paths without RTC', async () => {
    process.env.SEFER_SESSION_ACCESS_DEFAULT = 'CONTROLLED'; resetWsServerStateForTests();
    const a = await connectWs('control'), b = await connectWs('control'), pending = await connectWs('control');
    const welcome = await waitFor(a, message => message.type === 'WELCOME');
    const bState = await waitFor(b, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE');
    a.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: bState.controlSessionId, decision: 'APPROVE' });
    await waitFor(b, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'AUTHORIZED');
    const access = bootstrapAudienceAccess(null), audience = await connectWs('audience');
    audience.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
    await waitFor(audience, message => message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'REQUEST_REQUIRED');
    const recipientKeys = await generateSessionKeyPair(), groupKeys = await generateSessionKeyPair();
    const publicKey = await exportPublicKey(recipientKeys), groupPublicKey = await exportPublicKey(groupKeys);
    const profile: WsMessage = { type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', participantId: access.participantId,
      activeListPublicKey: publicKey, isAliasVisibleToActiveParticipants: false, createdAt: Date.now() };
    audience.send(profile); await wait(50);
    expect(a.messages.some(message => message.type === profile.type)).toBe(false);
    a.send({ type: 'AUDIENCE_ACCESS_DECISION', participantId: access.participantId, decision: 'ADMIT' });
    await waitFor(audience, message => message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'ADMITTED');
    audience.send({ ...makeParticipantStatus(access.participantId), isActiveAudience: true, canPublishAudio: false,
      isMicrophoneActive: false, microphoneTrackState: 'off', liveAudioConnectionState: 'unavailable' });
    audience.send(profile);
    expect((await waitFor(a, message => message.type === profile.type)).activeListPublicKey).toBe(publicKey);
    await waitFor(b, message => message.type === profile.type);
    expect(a.messages.some(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
    const shared = await deriveSharedKey(groupKeys.privateKey, recipientKeys.publicKey);
    const operationId = randomUUID(), conversationId = JSON.stringify([welcome.presentationSessionId, access.participantId]);
    const audienceValue = { type: 'CHAT_RESPONSE', text: 'Synthetic first conversation', operationId, conversationId,
      presentationSessionId: welcome.presentationSessionId, senderNick: 'Control' };
    a.send({ type: 'PRIVATE_CONTROL_SIGNAL', fromParticipantId: welcome.controlSessionId,
      toParticipantId: access.participantId, keyId: 'conversation-key', ephemeralPublicKey: groupPublicKey,
      ...await encrypt(shared, JSON.stringify(audienceValue)) });
    const delivered = await waitFor(audience, message => message.type === 'PRIVATE_CONTROL_SIGNAL');
    expect(JSON.parse(await decrypt(shared, delivered.ciphertext as string, delivered.nonce as string))).toEqual(audienceValue);
    const teamKey = await deriveSharedKey(groupKeys.privateKey, groupKeys.publicKey);
    const syncValue = { type: 'CONTROL_CONVERSATION_MESSAGE', version: 1, operationId, conversationId,
      participantId: access.participantId, presentationSessionId: welcome.presentationSessionId,
      text: audienceValue.text, operator: 'Synthetic operator', createdAt: Date.now(), audienceQueued: true };
    a.send({ type: 'PRIVATE_CONTROL_SIGNAL', fromParticipantId: welcome.controlSessionId,
      keyId: 'conversation-key', ephemeralPublicKey: groupPublicKey, ...await encrypt(teamKey, JSON.stringify(syncValue)) });
    const synchronized = await waitFor(b, message => message.type === 'PRIVATE_CONTROL_SIGNAL');
    expect(JSON.parse(await decrypt(teamKey, synchronized.ciphertext as string, synchronized.nonce as string))).toEqual(syncValue);
    const reply = { type: 'PRIVATE_MESSAGE', text: 'Synthetic correlated answer', operationId: randomUUID(), replyTo: operationId,
      conversationId, presentationSessionId: welcome.presentationSessionId };
    const encryptedReply = await encrypt(shared, JSON.stringify(reply));
    audience.send({ type: 'PRIVATE_CONTROL_SIGNAL', fromParticipantId: access.participantId,
      keyId: 'conversation-key', ephemeralPublicKey: publicKey, ...encryptedReply });
    for (const control of [a, b]) {
      const frame = await waitFor(control, message => message.ciphertext === encryptedReply.ciphertext);
      expect(JSON.parse(await decrypt(shared, frame.ciphertext as string, frame.nonce as string))).toEqual(reply);
    }
    a.send({ type: 'AUDIENCE_ACCESS_DECISION', participantId: access.participantId, decision: 'REJECT' });
    await waitFor(audience, message => message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'REJECTED');
    const before = a.messages.filter(message => message.type === profile.type).length;
    audience.send({ ...profile, createdAt: Date.now() }); await wait(50);
    expect(a.messages.filter(message => message.type === profile.type)).toHaveLength(before);
    expect(pending.messages.some(message => message.type === profile.type || message.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
    expect(JSON.stringify([...a.messages, ...b.messages, ...audience.messages, getLiveAudioParticipantSnapshot()]))
      .not.toMatch(/Synthetic first conversation|Synthetic correlated answer|Synthetic operator/);
    expect(liveKitPermissions.size).toBe(0);
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
    expect(presenterCounts).toEqual(controlCounts);
    expect(Object.keys(controlCounts)).toEqual(['type', 'totalConnections', 'audienceConnections', 'controlConnections', 'presenterConnections', 'updatedAt']);
    expect(controlCounts.updatedAt).toEqual(expect.any(Number));
    expect(audience.messages.some((message) => message.type === 'LIVE_AUDIO_CONNECTION_COUNTS')).toBe(false);
  });

  it('preserves count recipients, snapshot shape, timestamps and publication order across disconnect and reconnect', async () => {
    const principal = await connectWs('control');
    const pending = await connectWs('control');
    const presenter = await connectWs('presenter');
    const unknown = await connectWs('unknown');
    await waitFor(pending, message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING');
    await flushMessages(principal, [pending, presenter, unknown]);
    const recipients = [principal, pending, presenter];
    const timestamp = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
    for (const client of [...recipients, unknown]) client.messages.length = 0;

    const audience = await connectWs('audience');
    await flushMessages(audience, [...recipients, unknown]);
    const expected = {
      type: 'LIVE_AUDIO_CONNECTION_COUNTS', totalConnections: 4,
      audienceConnections: 1, controlConnections: 2, presenterConnections: 1, updatedAt: timestamp,
    };
    for (const client of recipients) {
      expect(client.messages.filter(message => message.type === expected.type)).toEqual([expected]);
      expect(client.messages.filter(message => [expected.type, 'MEDIA_MASTER_STATUS'].includes(message.type)).map(message => message.type))
        .toEqual(client === presenter ? [expected.type] : [expected.type, 'MEDIA_MASTER_STATUS', 'MEDIA_MASTER_STATUS']);
    }
    expect(audience.messages.some(message => message.type === expected.type)).toBe(false);
    expect(unknown.messages.some(message => message.type === expected.type)).toBe(false);

    principal.send({ type: 'LIVE_AUDIO_SNAPSHOT_REQUEST' });
    await flushMessages(principal, [pending]);
    const snapshot = principal.messages.find(message => message.type === 'LIVE_AUDIO_SNAPSHOT')!;
    expect((snapshot.snapshot as { connectionCounts: unknown }).connectionCounts).toEqual({
      totalConnections: 4, audienceConnections: 1, controlConnections: 2, presenterConnections: 1, updatedAt: timestamp,
    });
    expect(pending.messages.some(message => message.type === 'LIVE_AUDIO_SNAPSHOT')).toBe(false);

    for (const client of recipients) client.messages.length = 0;
    clock.mockReturnValue(timestamp + 1);
    const closed = new Promise<void>(resolve => audience.ws.once('close', () => resolve()));
    audience.ws.close();
    await closed;
    await waitFor(principal, message => message.type === expected.type && message.totalConnections === 3);
    await flushMessages(principal, [pending, presenter]);
    for (const client of recipients) {
      expect(client.messages.filter(message => message.type === expected.type)).toEqual([
        { ...expected, totalConnections: 3, audienceConnections: 0, updatedAt: timestamp + 1 },
      ]);
      client.messages.length = 0;
    }

    clock.mockReturnValue(timestamp + 2);
    const reconnected = await connectWs('audience');
    await flushMessages(reconnected, recipients);
    for (const client of recipients) {
      expect(client.messages.filter(message => message.type === expected.type)).toEqual([{ ...expected, updatedAt: timestamp + 2 }]);
    }
    expect(reconnected.messages.some(message => message.type === expected.type)).toBe(false);
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

  it('allows logical kick, rescue and revoke moderation without LiveKit registration while preserving Control session issuer', async () => {
    const control = await connectWs('control');
    const welcome = await waitFor(control, (message) => message.type === 'WELCOME');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send({
      ...makeParticipantStatus(participantId),
      isActiveAudience: true,
      speakerState: 'REQUESTED',
      liveAudioConnectionState: 'unavailable',
    });
    await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId,
    );

    expect(liveKitPermissions.has(participantId)).toBe(false);

    control.send({
      type: 'LIVE_AUDIO_KICK_PARTICIPANT',
      participantId,
      issuedByParticipantId: String(welcome.controlSessionId),
      createdAt: Date.now(),
    });
    const kicked = await waitFor(
      audience,
      (message) => message.type === 'LIVE_AUDIO_KICK_PARTICIPANT' && message.participantId === participantId,
    );
    expect(kicked.issuedByParticipantId).toBe(welcome.controlSessionId);

    control.send({
      type: 'LIVE_AUDIO_RESCUE_PARTICIPANT',
      participantId,
      issuedByParticipantId: String(welcome.controlSessionId),
      createdAt: Date.now(),
    });
    const rescued = await waitFor(
      audience,
      (message) => message.type === 'LIVE_AUDIO_RESCUE_PARTICIPANT' && message.participantId === participantId,
    );
    expect(rescued.issuedByParticipantId).toBe(welcome.controlSessionId);
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

  it('keeps distinct technical wire views and excludes pending Controls and Audience from operational data', async () => {
    const principal = await connectWs('control');
    const pending = await connectWs('control');
    const presenter = await connectWs('presenter');
    const audience = await connectWs('audience');
    const otherAudience = await connectWs('audience');
    const participantId = randomUUID();
    audience.send({
      ...makeParticipantStatus(participantId), speakerState: 'REQUESTED', isActiveAudience: true,
      microphonePermissionState: 'denied', microphoneTrackState: 'mutedByUser', liveAudioConnectionState: 'reconnecting',
      operatorCredential: 'private-operator', credentialHash: 'private-hash', cleanupTimer: 42,
      privateSignalTimestamps: [1], controlState: 'PRINCIPAL', presentationSessionId: 'private-session',
      privateAlias: 'private-alias', extra: 'private-extra',
    });
    await flushMessages(audience, [principal, pending, presenter, otherAudience]);
    const status = principal.messages.find(message => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId)!;
    expect(status).toBeDefined();
    expect(Object.keys(status).sort()).toEqual(['type', 'participantId', 'role', 'speakerState', 'canSubscribe', 'canPublishAudio', 'isMuted', 'isActiveAudience', 'isMicrophoneActive', 'isKicked', 'isAliasVisibleToActiveParticipants', 'canViewActiveParticipants', 'isAliasHiddenByControl', 'microphonePermissionState', 'microphoneTrackState', 'liveAudioConnectionState', 'updatedAt'].sort());
    expect(status).toMatchObject({ role: 'audience', speakerState: 'REQUESTED', canPublishAudio: false, microphonePermissionState: 'denied', microphoneTrackState: 'mutedByUser', liveAudioConnectionState: 'reconnecting' });
    expect(presenter.messages.find(message => message.type === status.type && message.participantId === participantId)).toEqual(status);

    principal.send({ type: 'LIVE_AUDIO_SNAPSHOT_REQUEST' });
    await flushMessages(principal, [pending, presenter, audience, otherAudience]);
    const snapshot = principal.messages.find(message => message.type === 'LIVE_AUDIO_SNAPSHOT' && (message.snapshot as { participants: Array<{ participantId: string }> }).participants.some(participant => participant.participantId === participantId))!;
    const operational = (snapshot.snapshot as { participants: Array<Record<string, unknown>> }).participants.find(participant => participant.participantId === participantId)!;
    expect(Object.keys(operational).sort()).toEqual(['participantId', 'role', 'operationalRole', 'microphonePermissionState', 'microphoneTrackState', 'liveAudioConnectionState', 'speakerState', 'canSubscribe', 'canPublishAudio', 'isMuted', 'isActiveAudience', 'isMicrophoneActive', 'isKicked', 'isAliasVisibleToActiveParticipants', 'canViewActiveParticipants', 'isAliasHiddenByControl', 'connected', 'connectedAt', 'updatedAt'].sort());
    expect(operational).toMatchObject({ participantId, role: 'audience', operationalRole: 'cola', connected: true, microphonePermissionState: 'denied', microphoneTrackState: 'mutedByUser', updatedAt: status.updatedAt });
    expect(operational.connectedAt).toEqual(expect.any(Number));
    for (const client of [pending, audience, otherAudience]) expect(client.messages.filter(message => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' || message.type === 'LIVE_AUDIO_SNAPSHOT')).toEqual([]);
    expect(presenter.messages.filter(message => message.type === 'LIVE_AUDIO_SNAPSHOT')).toEqual([]);
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

  it('rejects malformed formats before participant mutation or routing, then still accepts valid status and profile', async () => {
    const principal = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();
    const profile = { type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', participantId, activeListPublicKey: Buffer.from('synthetic-key').toString('base64'), isAliasVisibleToActiveParticipants: false };
    for (const message of [
      { ...makePrivateSignal(participantId), ciphertext: Buffer.alloc(4097).toString('base64') },
      { ...makePrivateSignal(participantId), nonce: Buffer.alloc(11).toString('base64') },
      { ...makePrivateSignal(participantId), ephemeralPublicKey: 'invalid!' },
      { ...makePrivateSignal(participantId), toParticipantId: randomUUID() },
      { ...makeParticipantStatus(participantId), alias: 'must-not-be-public' },
      { ...makeParticipantStatus(participantId), role: 'control' },
      { ...makeParticipantStatus(participantId), canPublishAudio: 'true' },
      { ...profile, alias: 'must-not-be-public' },
      { ...profile, activeListPublicKey: 'invalid!' },
    ]) audience.send(message);
    await flushMessages(audience, [principal]);
    expect(getLiveAudioParticipantSnapshot().participants).toEqual([]);
    expect(principal.messages.filter(message => ['PRIVATE_CONTROL_SIGNAL', 'LIVE_AUDIO_PARTICIPANT_STATUS', 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE'].includes(message.type))).toEqual([]);
    expect(audience.messages.filter(message => message.type === 'ERROR')).toEqual([]);

    audience.send(makeParticipantStatus(participantId));
    await waitFor(principal, message => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);
    audience.send(profile);
    await waitFor(principal, message => message.type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE' && message.participantId === participantId);
    const before = getLiveAudioParticipantSnapshot();
    const count = principal.messages.filter(message => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS').length;
    principal.send({ type: 'LIVE_AUDIO_GRANT_SPEAK', participantId, excludeParticipantIds: [] });
    principal.send({ type: 'LIVE_AUDIO_MUTE_ALL', excludeParticipantIds: ['invalid'] });
    await flushMessages(principal, [audience]);
    expect(getLiveAudioParticipantSnapshot()).toEqual(before);
    expect(principal.messages.filter(message => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS')).toHaveLength(count);
    expect(audience.messages.filter(message => ['LIVE_AUDIO_GRANT_SPEAK', 'LIVE_AUDIO_MUTE_ALL'].includes(message.type))).toEqual([]);
    expect(principal.messages.filter(message => message.type === 'ERROR')).toEqual([]);

    liveKitPermissions.set(participantId, true);
    principal.send({ type: 'LIVE_AUDIO_GRANT_SPEAK', participantId });
    await waitFor(audience, message => message.type === 'LIVE_AUDIO_GRANT_SPEAK' && message.participantId === participantId);
    expect(getLiveAudioParticipantSnapshot().participants[0].canPublishAudio).toBe(true);
  });

  it('keeps exact ciphertext and nonce limits before binding and without spending the Audience rate budget on rejects', async () => {
    const principal = await connectWs('control');
    const pending = await connectWs('control');
    const presenter = await connectWs('presenter');
    const audience = await connectWs('audience');
    const participantId = randomUUID();
    for (const patch of [
      { ciphertext: Buffer.alloc(4097).toString('base64') },
      { nonce: Buffer.alloc(11).toString('base64') },
      { nonce: Buffer.alloc(13).toString('base64') },
    ]) audience.send({ ...makePrivateSignal(participantId), ...patch });
    await flushMessages(audience, [principal]);
    expect(getLiveAudioParticipantSnapshot().participants).toEqual([]);
    expect(principal.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toEqual([]);
    for (let index = 0; index < 6; index++) audience.send({ ...makePrivateSignal(participantId, String(index + 1)), ciphertext: Buffer.alloc(4096, index).toString('base64'), extra: 'allowed' });
    await flushMessages(audience, [principal, pending, presenter]);
    expect(principal.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toHaveLength(5);
    expect(principal.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL').every(message => Buffer.from(message.ciphertext as string, 'base64').length === 4096)).toBe(true);
    expect(pending.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toEqual([]);
    expect(presenter.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toEqual([]);
  });

  it('preserves Control size limits, target routing and team sender echo while rejecting Presenter signals', async () => {
    const principal = await connectWs('control');
    const presenter = await connectWs('presenter');
    const audience = await connectWs('audience');
    const otherAudience = await connectWs('audience');
    const participantId = randomUUID();
    audience.send(makeParticipantStatus(participantId));
    await waitFor(principal, message => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId);
    const signal = { ...makeControlPrivateSignal(participantId), ciphertext: Buffer.alloc(4096).toString('base64') };
    principal.send({ ...signal, ciphertext: Buffer.alloc(4097).toString('base64') });
    principal.send({ ...signal, nonce: Buffer.alloc(13).toString('base64') });
    presenter.send(signal);
    await flushMessages(principal, [audience, otherAudience]);
    await flushMessages(presenter, [audience]);
    expect(audience.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toEqual([]);
    principal.send(signal);
    await flushMessages(principal, [audience, otherAudience]);
    expect(audience.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toEqual([signal]);
    expect(otherAudience.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toEqual([]);
    const teamSignal = { ...signal, toParticipantId: undefined };
    principal.send(teamSignal);
    await flushMessages(principal, [audience]);
    expect(principal.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toEqual([JSON.parse(JSON.stringify(teamSignal))]);
    expect(audience.messages.filter(message => message.type === 'PRIVATE_CONTROL_SIGNAL')).toEqual([signal]);
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

  describe('R1 terminal connection cleanup', () => {
    const terminalPaths = [
      'close', 'sendJson overflow', 'sendJson throw', 'broadcast overflow',
      'broadcast throw', 'broadcastWs throw', 'error', 'heartbeat timeout',
      'heartbeat ping throw', 'heartbeat closing',
    ] as const;

    const trackedConnection = async (role: 'control' | 'audience', controlSessionId?: string) => {
      const accepted = new Promise<WebSocket>(resolve => wss.once('connection', resolve));
      const client = await connectWs(role, controlSessionId);
      const serverSocket = await accepted;
      const welcome = await waitFor(client, message => message.type === 'WELCOME');
      await flushMessages(client, []);
      return { client, serverSocket, welcome };
    };

    const triggerTerminal = async (
      path: typeof terminalPaths[number],
      target: Awaited<ReturnType<typeof trackedConnection>>,
      sender: WsClient,
    ) => {
      const { client, serverSocket, welcome } = target;
      if (path.includes('overflow')) {
        vi.spyOn(serverSocket, 'bufferedAmount', 'get').mockReturnValue(512 * 1024 + 1);
      }
      if (path.endsWith('throw') && path !== 'heartbeat ping throw') {
        vi.spyOn(serverSocket, 'send').mockImplementation(() => { throw new Error('Synthetic send failure'); });
      }
      switch (path) {
        case 'close': {
          const closed = new Promise(resolve => client.ws.once('close', resolve));
          client.ws.close();
          await closed;
          break;
        }
        case 'sendJson overflow':
        case 'sendJson throw':
          client.send(welcome.role === 'control'
            ? { type: 'LIVE_AUDIO_SNAPSHOT_REQUEST' }
            : { type: 'AUDIENCE_ACCESS_BIND', credential: 'synthetic-obsolete-credential' });
          break;
        case 'broadcast overflow':
        case 'broadcast throw':
          sender.send({ type: 'AUDIO_TIMELINE_ACTION', action: { type: 'PAUSE' } });
          break;
        case 'broadcastWs throw':
          broadcastWs({ type: 'R1_SYNTHETIC_MARKER' });
          break;
        case 'error':
          serverSocket.emit('error', new Error('Synthetic terminal error'));
          break;
        case 'heartbeat timeout':
          Object.assign(serverSocket, { isAlive: false });
          heartbeatTick();
          break;
        case 'heartbeat ping throw':
          vi.spyOn(serverSocket, 'ping').mockImplementation(() => { throw new Error('Synthetic ping failure'); });
          heartbeatTick();
          break;
        case 'heartbeat closing':
          serverSocket.close();
          expect(serverSocket.readyState).toBe(WebSocket.CLOSING);
          heartbeatTick();
          break;
      }
    };

    beforeEach(() => {
      vi.stubEnv('SEFER_SESSION_ACCESS_DEFAULT', 'PUBLIC');
      vi.stubEnv('SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS', '60');
      resetWsServerStateForTests();
    });

    it.each(terminalPaths)('releases phantom PRINCIPAL authority on %s', async path => {
      const principal = await trackedConnection('control');
      const id = principal.welcome.controlSessionId as string;
      expect(isLiveAudioControlAuthorized(id)).toBe(true);
      await triggerTerminal(path, principal, principal.client);
      await vi.waitFor(() => expect(getLiveAudioControlState(id)).toBeNull());
      expect(isLiveAudioControlAuthorized(id)).toBe(false);
      const fresh = await trackedConnection('control');
      expect(fresh.welcome.controlState).toBe('PRINCIPAL');
      expect(fresh.serverSocket.readyState).toBe(WebSocket.OPEN);
    });

    it.each(terminalPaths)('retains Audience identity with disconnected/grace state on %s', async path => {
      const control = await trackedConnection('control');
      const audience = await trackedConnection('audience');
      const access = bootstrapAudienceAccess(null);
      audience.client.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
      await waitFor(audience.client, message => message.type === 'AUDIENCE_ACCESS_STATE');
      audience.client.send(makeParticipantStatus(access.participantId));
      await flushMessages(audience.client, [control.client]);
      expect(getLiveAudioParticipantState(access.participantId)?.connected).toBe(true);
      await triggerTerminal(path, audience, control.client);
      await vi.waitFor(() => expect(getLiveAudioParticipantState(access.participantId)).toMatchObject({
        connected: false, disconnectedAt: expect.any(Number),
      }));
      const disconnected = getLiveAudioParticipantState(access.participantId);
      await flushMessages(control.client, []);
      control.client.messages.length = 0;
      audience.serverSocket.emit('error', new Error('Delayed duplicate error'));
      audience.serverSocket.emit('close');
      await flushMessages(control.client, []);
      expect(getLiveAudioParticipantState(access.participantId)).toEqual(disconnected);
      expect(control.client.messages.filter(message => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS')).toEqual([]);

      const rejoined = await trackedConnection('audience');
      rejoined.client.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
      await waitFor(rejoined.client, message => message.type === 'AUDIENCE_ACCESS_STATE');
      rejoined.client.send(makeParticipantStatus(access.participantId));
      await flushMessages(rejoined.client, [control.client]);
      audience.serverSocket.emit('close');
      expect(getLiveAudioParticipantState(access.participantId)).toMatchObject({ connected: true, disconnectedAt: undefined });
      await flushMessages(rejoined.client, [control.client]);
    });

    it.each([false, true])('preserves succession and PENDING restrictions with delegation=%s', async delegated => {
      vi.stubEnv('SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS', String(delegated));
      const principal = await trackedConnection('control');
      const secondary = await trackedConnection('control');
      principal.client.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: secondary.welcome.controlSessionId, decision: 'APPROVE' });
      await waitFor(secondary.client, message => message.controlState === 'AUTHORIZED');
      const pending = await trackedConnection('control');
      secondary.client.messages.length = 0;
      await triggerTerminal('sendJson overflow', principal, principal.client);
      await vi.waitFor(() => expect(getLiveAudioControlSnapshot().principalControlSessionId).toBe(secondary.welcome.controlSessionId));
      expect(getLiveAudioControlState(pending.welcome.controlSessionId)?.controlState).toBe('PENDING');
      pending.client.send({ type: 'LIVE_AUDIO_GRANT_SPEAK', participantId: randomUUID() });
      await waitFor(pending.client, message => message.code === 'CONTROL_PENDING_FORBIDDEN');
      await flushMessages(secondary.client, [pending.client]);
      const states = secondary.client.messages.filter(message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE');
      const beforeDuplicate = states.length;
      principal.serverSocket.emit('error', new Error('Delayed error after eviction'));
      principal.serverSocket.emit('close');
      await flushMessages(secondary.client, [pending.client]);
      expect(secondary.client.messages.filter(message => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE')).toHaveLength(beforeDuplicate);
      expect(getLiveAudioControlSnapshot().principalControlSessionId).toBe(secondary.welcome.controlSessionId);
      const fresh = await trackedConnection('control');
      expect(fresh.welcome.controlState).toBe('PENDING');
    });

    it.each(['AUTHORIZED', 'PENDING'])('removes a terminal %s secondary without replacing the principal', async state => {
      const principal = await trackedConnection('control');
      const secondary = await trackedConnection('control');
      if (state === 'AUTHORIZED') {
        principal.client.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION', targetControlSessionId: secondary.welcome.controlSessionId, decision: 'APPROVE' });
        await waitFor(secondary.client, message => message.controlState === state);
      }
      await triggerTerminal('error', secondary, principal.client);
      await vi.waitFor(() => expect(getLiveAudioControlState(secondary.welcome.controlSessionId)).toBeNull());
      expect(getLiveAudioControlSnapshot().principalControlSessionId).toBe(principal.welcome.controlSessionId);
    });

    it('preserves a new binding when the original socket delivers its first close late', async () => {
      const control = await trackedConnection('control');
      const original = await trackedConnection('audience');
      const access = bootstrapAudienceAccess(null);
      original.client.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
      await waitFor(original.client, message => message.type === 'AUDIENCE_ACCESS_STATE');
      original.client.send(makeParticipantStatus(access.participantId));
      await flushMessages(original.client, [control.client]);
      const nativeEmit = original.serverSocket.emit;
      let delayedClose: unknown[] | undefined;
      const emit = vi.spyOn(original.serverSocket, 'emit').mockImplementation(function (event, ...args) {
        if (event === 'close') { delayedClose = args; return false; }
        return Reflect.apply(nativeEmit, original.serverSocket, [event, ...args]);
      });
      original.serverSocket.terminate();
      await vi.waitFor(() => expect(delayedClose).toBeDefined());
      const rejoined = await trackedConnection('audience');
      rejoined.client.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
      await waitFor(rejoined.client, message => message.type === 'AUDIENCE_ACCESS_STATE');
      rejoined.client.send(makeParticipantStatus(access.participantId));
      await flushMessages(rejoined.client, [control.client]);
      emit.mockRestore();
      Reflect.apply(nativeEmit, original.serverSocket, ['close', ...delayedClose!]);
      expect(getLiveAudioParticipantState(access.participantId)).toMatchObject({ connected: true, disconnectedAt: undefined });
      await flushMessages(rejoined.client, [control.client]);
    });

    it('cancels the removed pending Control expiry timer', async () => {
      const principal = await trackedConnection('control');
      const timers = vi.spyOn(globalThis, 'setTimeout');
      const pending = await trackedConnection('control');
      const index = timers.mock.calls.findIndex(([callback]) => String(callback).includes('expirePendingControl'));
      expect(index).toBeGreaterThanOrEqual(0);
      const expiryTimer = timers.mock.results[index].value;
      const cancel = vi.spyOn(globalThis, 'clearTimeout');
      await triggerTerminal('error', pending, principal.client);
      expect(cancel).toHaveBeenCalledWith(expiryTimer);
    });

    it('does not remove a newer Control reusing an id after rotation and delayed close', async () => {
      const original = await trackedConnection('control');
      const id = original.welcome.controlSessionId as string;
      const nativeEmit = original.serverSocket.emit;
      let delayedClose: unknown[] | undefined;
      const emit = vi.spyOn(original.serverSocket, 'emit').mockImplementation(function (event, ...args) {
        if (event === 'close') { delayedClose = args; return false; }
        return Reflect.apply(nativeEmit, original.serverSocket, [event, ...args]);
      });
      (wss as WebSocketServer & { rotatePresentationSession: () => void }).rotatePresentationSession();
      await vi.waitFor(() => expect(delayedClose).toBeDefined());
      const fresh = await trackedConnection('control', id);
      expect(fresh.welcome.controlSessionId).toBe(id);
      expect(fresh.welcome.controlState).toBe('PRINCIPAL');
      emit.mockRestore();
      Reflect.apply(nativeEmit, original.serverSocket, ['close', ...delayedClose!]);
      expect(getLiveAudioControlState(id)?.clientId).toBe(fresh.welcome.clientId);
      expect(isLiveAudioControlAuthorized(id)).toBe(true);
      await flushMessages(fresh.client, []);
    });

    it('schedules grace cleanup once and cancels it on authenticated rejoin', async () => {
      const control = await trackedConnection('control');
      const original = await trackedConnection('audience');
      const access = bootstrapAudienceAccess(null);
      original.client.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
      await waitFor(original.client, message => message.type === 'AUDIENCE_ACCESS_STATE');
      original.client.send(makeParticipantStatus(access.participantId));
      await flushMessages(original.client, [control.client]);
      const timers = vi.spyOn(globalThis, 'setTimeout');
      await triggerTerminal('error', original, control.client);
      const cleanupCalls = () => timers.mock.calls.filter(([callback]) => String(callback).includes('cleanupExpiredParticipant'));
      expect(cleanupCalls()).toHaveLength(1);
      expect(cleanupCalls()[0][1]).toBe(60_000);
      const index = timers.mock.calls.findIndex(([callback]) => String(callback).includes('cleanupExpiredParticipant'));
      const cleanupTimer = timers.mock.results[index].value;
      original.serverSocket.emit('close');
      expect(cleanupCalls()).toHaveLength(1);
      const cancel = vi.spyOn(globalThis, 'clearTimeout');
      const rejoined = await trackedConnection('audience');
      rejoined.client.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
      await waitFor(rejoined.client, message => message.type === 'AUDIENCE_ACCESS_STATE');
      rejoined.client.send(makeParticipantStatus(access.participantId));
      await flushMessages(rejoined.client, [control.client]);
      expect(cancel).toHaveBeenCalledWith(cleanupTimer);
      Reflect.apply(cleanupCalls()[0][0] as () => void, undefined, []);
      expect(getLiveAudioParticipantState(access.participantId)?.connected).toBe(true);
    });

    it('keeps the 512 KiB budget across exported and internal broadcasts while isolating one overflowing recipient', async () => {
      const control = await trackedConnection('control');
      const slow = await trackedConnection('audience');
      const healthy = await trackedConnection('audience');
      const buffer = vi.spyOn(slow.serverSocket, 'bufferedAmount', 'get').mockReturnValue(512 * 1024 - 1024);
      control.client.send({ type: 'LIVE_AUDIO_REQUEST_ALIASES' });
      await waitFor(slow.client, message => message.type === 'LIVE_AUDIO_REQUEST_ALIASES');
      expect(slow.serverSocket.readyState).toBe(WebSocket.OPEN);
      buffer.mockReturnValue(512 * 1024);
      const closed = new Promise(resolve => slow.client.ws.once('close', (code, reason) => resolve([code, reason.toString()])));
      broadcastWs({ type: 'R1_POLICY_MARKER' }, meta => meta.role === 'audience');
      await expect(closed).resolves.toEqual([1013, 'Slow consumer']);
      await waitFor(healthy.client, message => message.type === 'R1_POLICY_MARKER');
      expect(control.client.messages.some(message => message.type === 'R1_POLICY_MARKER')).toBe(false);
      healthy.client.messages.length = 0;
      control.client.send({ type: 'LIVE_AUDIO_REQUEST_ALIASES' });
      await waitFor(healthy.client, message => message.type === 'LIVE_AUDIO_REQUEST_ALIASES');
      expect(healthy.serverSocket.readyState).toBe(WebSocket.OPEN);
      await vi.waitFor(() => expect(slow.serverSocket.readyState).toBe(WebSocket.CLOSED));
      const send = vi.spyOn(slow.serverSocket, 'send');
      broadcastWs({ type: 'R1_CLOSED_RECIPIENT_MARKER' });
      await waitFor(healthy.client, message => message.type === 'R1_CLOSED_RECIPIENT_MARKER');
      expect(send).not.toHaveBeenCalled();
      await flushMessages(control.client, [healthy.client]);
    });
  });
});
