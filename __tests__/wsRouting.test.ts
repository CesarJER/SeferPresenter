import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
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
let recordingRevocations = 0;
let recordingRevocationShouldFail = false;

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
      reject(new Error(`Timed out waiting for WebSocket message; received: ${client.messages.map((message) => `${message.type}:${message.result ?? message.controlState ?? message.code ?? ''}`).join(', ')}`));
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
  signalClass: 'PRIVATE_MESSAGE',
  messageId: `audience-message-${suffix || 'one'}`,
  fromParticipantId: participantId,
  keyId: `key-${suffix || 'one'}`,
  ephemeralPublicKey: Buffer.from(`ephemeral-${suffix || 'one'}`).toString('base64'),
  ciphertext: Buffer.from(`ciphertext-${suffix || 'one'}`).toString('base64'),
  nonce: Buffer.alloc(12, suffix.charCodeAt(0) || 1).toString('base64'),
  createdAt: Date.now(),
});

const makeControlPrivateSignal = (participantId: string, suffix = ''): WsMessage => ({
  type: 'PRIVATE_CONTROL_SIGNAL',
  signalClass: 'CONTROL_STATE',
  messageId: `control-message-${suffix || 'one'}`,
  fromParticipantId: `control-session-${suffix || 'one'}`,
  toParticipantId: participantId,
  keyId: `key-${suffix || 'one'}`,
  ephemeralPublicKey: Buffer.from(`control-public-${suffix || 'one'}`).toString('base64'),
  ciphertext: Buffer.from(`control-ciphertext-${suffix || 'one'}`).toString('base64'),
  nonce: Buffer.alloc(12, suffix.charCodeAt(0) || 2).toString('base64'),
  createdAt: Date.now(),
});

const authorizeSecondary = async (
  principal: WsClient,
  secondary: WsClient,
  targetControlSessionId: string,
) => {
  const transferId = `transfer-${randomUUID()}`;
  const keyId = `key-${randomUUID()}`;
  const principalControlSessionId = String(
    principal.messages.find((message) => message.type === 'WELCOME')?.controlSessionId,
  );
  principal.send({
    type: 'LIVE_AUDIO_CONTROL_PUBLIC_KEY',
    controlSessionId: principalControlSessionId,
    keyId,
    publicKey: Buffer.from('session-public').toString('base64'),
    createdAt: Date.now(),
  });
  principal.send({
    type: 'LIVE_AUDIO_PRIVATE_OVERLAY_PUBLISH',
    messageId: `overlay-${randomUUID()}`,
    keyId,
    privateStateRevision: 1,
    basedOnStateRevision: 0,
    ciphertext: Buffer.from('encrypted-overlay').toString('base64'),
    nonce: Buffer.alloc(12, 9).toString('base64'),
  });
  await waitFor(principal, (message) => (
    message.type === 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT' && message.result === 'ACK'
  ));
  principal.send({
    type: 'LIVE_AUDIO_CONTROL_AUTHORIZED',
    controlSessionId: targetControlSessionId,
    authorizedByControlSessionId: 'ignored-by-server',
    transferId,
    keyId,
    sessionPublicKey: Buffer.from('session-public').toString('base64'),
    transferPublicKey: Buffer.from('transfer-public').toString('base64'),
    encryptedSessionPrivateKey: Buffer.from('encrypted-private').toString('base64'),
    nonce: Buffer.alloc(12, 7).toString('base64'),
    createdAt: Date.now(),
  });
  await waitFor(
    secondary,
    (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZED' && message.transferId === transferId,
  );

  secondary.send({
    type: 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT',
    controlSessionId: targetControlSessionId,
    transferId,
    keyId,
    result: 'ACK',
    createdAt: Date.now(),
  });
  await waitFor(
    principal,
    (message) => message.type === 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT' && message.transferId === transferId,
  );

  principal.send({
    type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION',
    targetControlSessionId,
    decision: 'APPROVE',
    createdAt: Date.now(),
  });
  const overlay = await waitFor(
    secondary,
    (message) => message.type === 'LIVE_AUDIO_PRIVATE_OVERLAY_SNAPSHOT',
  );
  secondary.send({
    type: 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT',
    result: 'ACK',
    keyId: overlay.keyId,
    privateStateRevision: overlay.privateStateRevision,
  });
  await waitFor(
    secondary,
    (message) => (
      message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' &&
      message.controlState === 'AUTHORIZED'
    ),
  );
};

describe('Live Audio WebSocket routing', () => {
  beforeEach(async () => {
    process.env.SEFER_REQUIRE_AUTH = 'false';
    process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS = '1';
    resetWsServerStateForTests();
    recordingRevocations = 0;
    recordingRevocationShouldFail = false;

    httpServer = createServer();
    wss = createWsServer(httpServer, undefined, {
      recordingPolicy: {
        recordingAvailable: true,
        recordingMutable: true,
        recordingDefault: 'NOT_RECORDING',
      },
      revokeLiveAudioPublishingForRecording: async () => {
        recordingRevocations += 1;
        if (recordingRevocationShouldFail) {
          throw new Error('LiveKit unavailable');
        }
      },
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

  it('keeps controlled Audience content gated until a ready Control admits the bound credential', async () => {
    process.env.SEFER_SESSION_ACCESS_DEFAULT = 'CONTROLLED';
    resetWsServerStateForTests();
    const principal = await connectWs('control');
    const audience = await connectWs('audience');
    const access = bootstrapAudienceAccess() as {
      credential: string;
      participantId: string;
      accessState: string;
    };
    expect(access.accessState).toBe('REQUEST_REQUIRED');

    audience.send({
      type: 'AUDIENCE_ACCESS_BIND',
      credential: access.credential,
    });
    await waitFor(audience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' &&
      message.accessState === 'REQUEST_REQUIRED'
    ));

    audience.send(makePrivateSignal(access.participantId, 'access-alias'));
    audience.send({
      type: 'AUDIENCE_ACCESS_REQUEST',
      participantId: access.participantId,
      createdAt: Date.now(),
    });
    await waitFor(principal, (message) => (
      message.type === 'AUDIENCE_ACCESS_REQUEST' &&
      message.participantId === access.participantId
    ));

    principal.send({
      type: 'AUDIENCE_ACCESS_DECISION',
      participantId: access.participantId,
      decision: 'ADMIT',
      createdAt: Date.now(),
    });
    const admitted = await waitFor(audience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' &&
      message.accessState === 'ADMITTED'
    ));
    expect(admitted.accessMode).toBe('CONTROLLED');
    delete process.env.SEFER_SESSION_ACCESS_DEFAULT;
  });

  it('moves anonymous public credentials to request-required when the principal enables controlled access', async () => {
    const access = bootstrapAudienceAccess() as {
      credential: string;
      participantId: string;
      accessState: string;
    };
    expect(access.accessState).toBe('ADMITTED');
    const principal = await connectWs('control');
    const audience = await connectWs('audience');
    audience.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
    await waitFor(audience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' && message.accessState === 'ADMITTED'
    ));

    principal.send({
      type: 'SESSION_ACCESS_POLICY_UPDATE',
      accessMode: 'CONTROLLED',
      createdAt: Date.now(),
    });
    const waiting = await waitFor(audience, (message) => (
      message.type === 'AUDIENCE_ACCESS_STATE' &&
      message.accessState === 'REQUEST_REQUIRED'
    ));
    expect(waiting.accessMode).toBe('CONTROLLED');
  });

  it('rejects clear alias data in operational snapshot patches', async () => {
    const control = await connectWs('control');

    control.send({
      type: 'LIVE_AUDIO_SNAPSHOT_PATCH',
      snapshot: {
        participants: [{
          participantId: randomUUID(),
          role: 'audience',
          alias: 'Alias en claro',
        }],
      },
      createdAt: Date.now(),
    });

    const error = await waitFor(
      control,
      (message) => message.type === 'ERROR' && message.code === 'CLEAR_ALIAS_FORBIDDEN',
    );
    expect(String(error.message)).toContain('end-to-end encrypted');
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

    await authorizeSecondary(principal, secondary, String(pending.controlSessionId));

    const snapshot = await waitFor(secondary, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
    const participants = snapshot.snapshot as {
      participants?: Array<{ participantId: string; speakerState: string }>;
      presentationSessionId?: string;
      serverEpoch?: string;
      stateRevision?: number;
    };
    expect(participants.participants?.some((participant) => (
      participant.participantId === participantId && participant.speakerState === 'REQUESTED'
    ))).toBe(true);
    expect(participants.presentationSessionId).toEqual(expect.any(String));
    expect(participants.serverEpoch).toEqual(expect.any(String));
    expect(participants.stateRevision).toEqual(expect.any(Number));
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
    await wait(1_100);
    const nextControl = await connectWs('control');
    const snapshot = await waitFor(nextControl, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
    const body = snapshot.snapshot as { participants?: Array<{ participantId: string }> };
    expect(body.participants?.some((participant) => participant.participantId === participantId)).toBe(true);
  });

  it('versions recording policy changes exactly once and keeps the epoch monotonic', async () => {
    const control = await connectWs('control');
    const snapshotMessage = await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_SNAPSHOT',
    );
    const snapshot = snapshotMessage.snapshot as { presentationSessionId: string; stateRevision: number };

    control.send({
      type: 'SESSION_RECORDING_POLICY_UPDATE',
      commandId: randomUUID(),
      presentationSessionId: snapshot.presentationSessionId,
      expectedStateRevision: snapshot.stateRevision,
      recordingState: 'RECORDING',
    });
    const started = await waitFor(
      control,
      (message) => message.type === 'SESSION_RECORDING_POLICY' && message.recordingState === 'RECORDING',
    );

    expect(started.recordingEpoch).toBe(1);
    expect(started.stateRevision).toBe(snapshot.stateRevision + 1);
    expect(recordingRevocations).toBe(1);
    const startedResult = await waitFor(
      control,
      (message) => message.type === 'SESSION_RECORDING_POLICY_RESULT' && message.result === 'ACK',
    );
    expect(startedResult.commandId).toBeTruthy();

    control.send({
      type: 'SESSION_RECORDING_POLICY_UPDATE',
      commandId: randomUUID(),
      presentationSessionId: snapshot.presentationSessionId,
      expectedStateRevision: started.stateRevision,
      recordingState: 'NOT_RECORDING',
    });
    const stopped = await waitFor(
      control,
      (message) => message.type === 'SESSION_RECORDING_POLICY' && message.recordingState === 'NOT_RECORDING' && message.stateRevision === Number(started.stateRevision) + 1,
    );
    expect(stopped.recordingEpoch).toBe(1);
  });

  it('NACKs recording activation without changing revision when LiveKit revocation fails', async () => {
    recordingRevocationShouldFail = true;
    const control = await connectWs('control');
    const snapshotMessage = await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_SNAPSHOT',
    );
    const snapshot = snapshotMessage.snapshot as { presentationSessionId: string; stateRevision: number };
    const commandId = randomUUID();

    control.send({
      type: 'SESSION_RECORDING_POLICY_UPDATE',
      commandId,
      presentationSessionId: snapshot.presentationSessionId,
      expectedStateRevision: snapshot.stateRevision,
      recordingState: 'RECORDING',
    });

    const result = await waitFor(
      control,
      (message) => message.type === 'SESSION_RECORDING_POLICY_RESULT' && message.commandId === commandId,
    );
    expect(result).toMatchObject({
      result: 'NACK',
      reason: 'LIVEKIT_REVOCATION_FAILED',
      recordingState: 'NOT_RECORDING',
      recordingEpoch: 0,
      stateRevision: snapshot.stateRevision,
    });
    expect(recordingRevocations).toBe(1);
  });

  it('rejects microphone grants until the bound Audience confirms the active epoch', async () => {
    const access = bootstrapAudienceAccess();
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    audience.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
    await waitFor(audience, (message) => message.type === 'AUDIENCE_ACCESS_STATE');
    audience.send(makeParticipantStatus(access.participantId));
    const participantStatus = await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === access.participantId,
    );

    control.send({
      type: 'SESSION_RECORDING_POLICY_UPDATE',
      commandId: randomUUID(),
      presentationSessionId: access.presentationSessionId,
      expectedStateRevision: participantStatus.stateRevision,
      recordingState: 'RECORDING',
    });
    const recording = await waitFor(
      control,
      (message) => message.type === 'SESSION_RECORDING_POLICY' && message.recordingState === 'RECORDING',
    );

    control.send({
      type: 'LIVE_AUDIO_GRANT_SPEAK',
      participantId: access.participantId,
      createdAt: Date.now(),
    });
    await waitFor(
      control,
      (message) => message.type === 'ERROR' && message.code === 'RECORDING_CONFIRMATION_REQUIRED',
    );
    expect(getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === access.participantId)?.speakerState)
      .toBe('LISTENER');

    audience.send({
      type: 'AUDIENCE_RECORDING_CONFIRMATION',
      requestId: randomUUID(),
      participantId: access.participantId,
      presentationSessionId: access.presentationSessionId,
      recordingEpoch: recording.recordingEpoch,
    });
    const confirmation = await waitFor(
      audience,
      (message) => message.type === 'AUDIENCE_RECORDING_CONFIRMATION_RESULT' && message.result === 'ACK',
    );
    expect(confirmation.stateRevision).toBe(Number(recording.stateRevision) + 1);

    control.send({
      type: 'LIVE_AUDIO_GRANT_SPEAK',
      participantId: access.participantId,
      createdAt: Date.now(),
    });
    await waitFor(
      audience,
      (message) => message.type === 'LIVE_AUDIO_GRANT_SPEAK' && message.participantId === access.participantId,
    );
    expect(getLiveAudioParticipantSnapshot().participants.find((item) => item.participantId === access.participantId))
      .toMatchObject({ speakerState: 'GRANTED', canPublishAudio: true });
  });

  it('rejects obsolete recording confirmation and client-forged publishing state', async () => {
    const access = bootstrapAudienceAccess();
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    audience.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
    await waitFor(audience, (message) => message.type === 'AUDIENCE_ACCESS_STATE');
    audience.send({
      ...makeParticipantStatus(access.participantId),
      speakerState: 'GRANTED',
      canPublishAudio: true,
      isMicrophoneActive: true,
    });
    const status = await waitFor(
      control,
      (message) => message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === access.participantId,
    );
    expect(status).toMatchObject({
      speakerState: 'LISTENER',
      canPublishAudio: false,
      isMicrophoneActive: false,
    });

    control.send({
      type: 'SESSION_RECORDING_POLICY_UPDATE',
      commandId: randomUUID(),
      presentationSessionId: access.presentationSessionId,
      expectedStateRevision: status.stateRevision,
      recordingState: 'RECORDING',
    });
    const recording = await waitFor(
      control,
      (message) => message.type === 'SESSION_RECORDING_POLICY' && message.recordingState === 'RECORDING',
    );
    audience.send({
      type: 'AUDIENCE_RECORDING_CONFIRMATION',
      requestId: randomUUID(),
      participantId: access.participantId,
      presentationSessionId: access.presentationSessionId,
      recordingEpoch: Number(recording.recordingEpoch) - 1,
    });
    const rejected = await waitFor(
      audience,
      (message) => message.type === 'AUDIENCE_RECORDING_CONFIRMATION_RESULT' && message.result === 'NACK',
    );
    expect(rejected.stateRevision).toBe(recording.stateRevision);
  });

  it('resumes the same Control identity during the grace period and rotates its credential', async () => {
    const first = await connectWs('control');
    const welcome = await waitFor(first, (message) => message.type === 'WELCOME');
    const originalSessionId = String(welcome.controlSessionId);
    const originalCredential = String(welcome.controlResumeCredential);

    first.ws.close();
    await wait(50);

    const reconnecting = await connectWs('control');
    const temporaryWelcome = await waitFor(reconnecting, (message) => message.type === 'WELCOME');
    expect(temporaryWelcome.controlSessionId).not.toBe(originalSessionId);

    reconnecting.send({
      type: 'LIVE_AUDIO_CONTROL_RESUME',
      controlSessionId: originalSessionId,
      credential: originalCredential,
    });
    const resumed = await waitFor(
      reconnecting,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_RESUME_RESULT',
    );

    expect(resumed.accepted).toBe(true);
    expect(resumed.controlSessionId).toBe(originalSessionId);
    expect(resumed.credential).not.toBe(originalCredential);
    expect(resumed.connectionEpoch).toEqual(expect.any(String));
    await waitFor(reconnecting, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
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

  it('does not authorize a secondary Control before a correlated E2E ACK', async () => {
    const principal = await connectWs('control');
    const secondary = await connectWs('control');
    const pending = await waitFor(
      secondary,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING',
    );

    principal.send({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION',
      targetControlSessionId: pending.controlSessionId,
      decision: 'APPROVE',
      createdAt: Date.now(),
    });

    const error = await waitFor(
      principal,
      (message) => message.type === 'ERROR' && message.code === 'CONTROL_E2E_NOT_READY',
    );
    await wait(100);

    expect(String(error.message)).toContain('acknowledged');
    expect(secondary.messages.some((message) => (
      message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' &&
      message.controlState === 'AUTHORIZED'
    ))).toBe(false);
    expect(secondary.messages.some((message) => message.type === 'LIVE_AUDIO_SNAPSHOT')).toBe(false);
  });

  it('keeps an E2E NACKed secondary Control pending and unable to receive private messages', async () => {
    const principal = await connectWs('control');
    const secondary = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();
    const pending = await waitFor(
      secondary,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING',
    );
    const transferId = `transfer-${randomUUID()}`;
    const keyId = `key-${randomUUID()}`;

    principal.send({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZED',
      controlSessionId: pending.controlSessionId,
      authorizedByControlSessionId: 'ignored',
      transferId,
      keyId,
      sessionPublicKey: Buffer.from('session-public').toString('base64'),
      transferPublicKey: Buffer.from('transfer-public').toString('base64'),
      encryptedSessionPrivateKey: Buffer.from('encrypted-private').toString('base64'),
      nonce: Buffer.alloc(12, 8).toString('base64'),
      createdAt: Date.now(),
    });
    await waitFor(
      secondary,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'AUTHORIZED_SYNCING',
    );

    audience.send(makeParticipantStatus(participantId));
    audience.send(makePrivateSignal(participantId, 'during-sync'));
    await waitFor(principal, (message) => (
      message.type === 'PRIVATE_CONTROL_SIGNAL' && message.messageId === 'audience-message-during-sync'
    ));

    secondary.send({
      type: 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT',
      controlSessionId: pending.controlSessionId,
      transferId,
      keyId,
      result: 'NACK',
      reason: 'IMPORT_FAILED',
      createdAt: Date.now(),
    });
    await waitFor(
      secondary,
      (message) => message.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && message.controlState === 'PENDING',
    );
    await wait(100);

    expect(secondary.messages.some((message) => message.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
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
    const rateLimit = audience.messages.find((message) => (
      message.type === 'PRIVATE_CONTROL_SIGNAL_RESULT' &&
      message.result === 'NACK' &&
      message.reason === 'RATE_LIMIT'
    ));
    expect(rateLimit?.retryAfterMs).toEqual(expect.any(Number));
  });

  it('deduplicates private signals and returns idempotent ACKs', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();
    const signal = makePrivateSignal(participantId, 'dedupe');

    audience.send(makeParticipantStatus(participantId));
    audience.send(signal);
    await waitFor(control, (message) => (
      message.type === 'PRIVATE_CONTROL_SIGNAL' && message.messageId === signal.messageId
    ));
    await waitFor(audience, (message) => (
      message.type === 'PRIVATE_CONTROL_SIGNAL_RESULT' &&
      message.messageId === signal.messageId &&
      message.result === 'ACK'
    ));

    audience.send(signal);
    await wait(100);

    expect(control.messages.filter((message) => (
      message.type === 'PRIVATE_CONTROL_SIGNAL' && message.messageId === signal.messageId
    ))).toHaveLength(1);
    expect(audience.messages.filter((message) => (
      message.type === 'PRIVATE_CONTROL_SIGNAL_RESULT' &&
      message.messageId === signal.messageId &&
      message.result === 'ACK'
    ))).toHaveLength(2);
  });

  it('does not let profile recovery traffic consume the human message quota', async () => {
    const control = await connectWs('control');
    const audience = await connectWs('audience');
    const participantId = randomUUID();

    audience.send(makeParticipantStatus(participantId));
    for (let index = 0; index < 6; index += 1) {
      audience.send({
        ...makePrivateSignal(participantId, `profile-${index}`),
        signalClass: 'PROFILE_STATE',
      });
    }
    const humanMessage = makePrivateSignal(participantId, 'human-after-profiles');
    audience.send(humanMessage);

    const received = await waitFor(control, (message) => (
      message.type === 'PRIVATE_CONTROL_SIGNAL' &&
      message.messageId === humanMessage.messageId
    ));
    expect(received.signalClass).toBe('PRIVATE_MESSAGE');
  });

  it('increments stateRevision for mutations but not for snapshot reads', async () => {
    const control = await connectWs('control');
    await waitFor(control, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
    control.messages = [];

    control.send({
      type: 'LIVE_AUDIO_SNAPSHOT_REQUEST',
      lastAppliedStateRevision: 0,
      reason: 'CONNECT',
      createdAt: Date.now(),
    });
    const first = await waitFor(control, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
    const firstRevision = Number((first.snapshot as { stateRevision: number }).stateRevision);
    control.messages = [];

    control.send({
      type: 'LIVE_AUDIO_SNAPSHOT_REQUEST',
      lastAppliedStateRevision: firstRevision,
      reason: 'RECONNECT',
      createdAt: Date.now(),
    });
    const second = await waitFor(control, (message) => message.type === 'LIVE_AUDIO_SNAPSHOT');
    expect((second.snapshot as { stateRevision: number }).stateRevision).toBe(firstRevision);

    const audience = await connectWs('audience');
    const participantId = randomUUID();
    audience.send(makeParticipantStatus(participantId));
    const delta = await waitFor(control, (message) => (
      message.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' && message.participantId === participantId
    ));
    expect(Number(delta.stateRevision)).toBeGreaterThan(firstRevision);
    expect(delta.eventId).toEqual(expect.any(String));
    expect(delta.presentationSessionId).toEqual(expect.any(String));
    expect(delta.serverEpoch).toEqual(expect.any(String));
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
