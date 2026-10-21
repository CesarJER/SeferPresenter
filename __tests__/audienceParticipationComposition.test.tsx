// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { StrictMode, useEffect } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudienceParticipationProvider } from '../src/components/audience/AudienceParticipationProvider';
import { AudienceAccessGate } from '../src/components/audience/AudienceAccessGate';
import { AudienceParticipationSurface } from '../src/components/audience/AudienceParticipationSurface';
import { AudienceParticipationPanel } from '../src/components/audience/AudienceParticipationPanel';
import { useAudienceParticipation } from '../src/hooks/useAudienceParticipation';
import { useAudienceAccess } from '../src/hooks/useAudienceAccess';
import { useAudienceSession } from '../src/hooks/useAudienceSession';
import type { WebSocketConnectionStatus } from '../src/hooks/useWebSocket';
import * as cryptoUtils from '../src/utils/cryptoUtils';
import { useAudienceLiveAudio } from '../src/features/liveAudio/components/audience/AudienceLiveAudioContext';

const media = vi.hoisted(() => ({ publish: vi.fn(), unpublish: vi.fn(), connect: vi.fn() }));
vi.mock('../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({ useLiveAudioAvailability: () => ({ availability: 'enabled' }) }));
vi.mock('../src/features/liveAudio/hooks/useLiveAudio', () => ({
  isMicrophonePublicationCancelled: () => false,
  useLiveAudio: () => ({ state: 'connected', connectionQuality: 'good', remoteTracks: [], participantId: 'rtc-must-not-authorize',
    sessionRevision: 0, isMicrophoneActive: false, microphoneTrackState: 'off', hasAudioStarted: false,
    startRemoteAudio: media.connect, publishMicrophone: media.publish, republishMicrophone: media.publish,
    unpublishMicrophone: media.unpublish, retryAudio: media.connect }),
}));
vi.mock('../src/components/shared/BrandingWelcome', () => ({ BrandingWelcome: () => null }));

type Handler = (type: string, payload: Record<string, unknown>) => void;
const participantId = '11111111-1111-4111-8111-111111111111';
const subscribers = new Set<Handler>();
let peakSubscriptions = 0;
const subscribe = (handler: Handler) => {
  subscribers.add(handler); peakSubscriptions = Math.max(peakSubscriptions, subscribers.size);
  return () => { subscribers.delete(handler); };
};
const wsSend = vi.fn(() => true);
let owner: ReturnType<typeof useAudienceParticipation>;
let access: ReturnType<typeof useAudienceAccess>;
let session: ReturnType<typeof useAudienceSession>;
let mode: 'PUBLIC' | 'CONTROLLED';
let bootstrapId = participantId;
let bootstrapCredential = 'synthetic-credential';
let keyPair: CryptoKeyPair;
let audio: ReturnType<typeof useAudienceLiveAudio>;

function MediaProbe() {
  const value = useAudienceLiveAudio();
  useEffect(() => { audio = value; });
  return null;
}

function Probe() {
  const value = useAudienceParticipation();
  useEffect(() => { owner = value; });
  return <div data-testid="probe" data-active={value.isActive} data-requested={value.isPendingWord} />;
}

function Harness({ hidden = false, relocated = false, status = 'open' }: {
  hidden?: boolean; relocated?: boolean; status?: WebSocketConnectionStatus;
}) {
  const currentAccess = useAudienceAccess();
  const currentSession = useAudienceSession();
  useEffect(() => { access = currentAccess; session = currentSession; });
  const admitted = currentAccess.authorized && currentAccess.stateSseTicket && currentAccess.quizSseTicket;
  return <AudienceParticipationProvider
    key={JSON.stringify([currentAccess.presentationSessionId, currentAccess.participantId, currentAccess.credential, currentAccess.sessionGeneration])}
    access={currentAccess} audienceSession={currentSession} wsStatus={status} wsSend={wsSend} subscribeToWsMessage={subscribe}
  >
    <Probe />
    {hidden ? null : admitted
      ? <AudienceParticipationSurface subscribeToWsMessage={subscribe}><div key={relocated ? 'other-slot' : 'original-slot'}>
        <p>Admitted view</p>
        <AudienceParticipationPanel />
        <MediaProbe />
      </div></AudienceParticipationSurface>
      : <AudienceAccessGate accessState={currentAccess.accessState} retryAt={currentAccess.retryAt} onAliasAccepted={(alias, visible) => {
        currentSession.login(alias); currentSession.setAliasVisible(visible);
      }} />}
  </AudienceParticipationProvider>;
}

const emit = (type: string, payload: Record<string, unknown>) => {
  access.handleWsMessage(type, payload);
  for (const handler of subscribers) handler(type, payload);
};
const bind = async (state: 'WAITING' | 'ADMITTED' = 'WAITING') => {
  act(() => {
    access.handleWsConnectionChange('open');
    emit('AUDIENCE_ACCESS_STATE', { participantId: access.participantId, presentationSessionId: 'session-a', accessMode: mode, accessState: state });
  });
  await announce();
};
const announce = async (keyId = 'key-a') => {
  const publicKey = await cryptoUtils.exportPublicKey(keyPair);
  act(() => emit('LIVE_AUDIO_CONTROL_PUBLIC_KEY', { keyId, publicKey }));
  await waitFor(() => expect(owner.privateSignals.ready).toBe(true));
};
const response = async (text: string, keyId = 'key-a') => {
  const publicKey = await owner.privateSignals.getAudiencePublicKey();
  const shared = await cryptoUtils.deriveSharedKey(keyPair.privateKey, await cryptoUtils.importPublicKey(publicKey!));
  const encrypted = await cryptoUtils.encrypt(shared, JSON.stringify({ type: 'CHAT_RESPONSE', text, senderNick: 'Synthetic Control' }));
  const frame = { fromParticipantId: 'control-a', toParticipantId: access.participantId,
    keyId, ephemeralPublicKey: await cryptoUtils.exportPublicKey(keyPair), ...encrypted };
  await act(async () => emit('PRIVATE_CONTROL_SIGNAL', frame));
  return frame;
};
const start = async (strict = false) => {
  const view = render(strict ? <StrictMode><Harness /></StrictMode> : <Harness />);
  await waitFor(() => expect(access.participantId).toBe(participantId));
  await bind(mode === 'PUBLIC' ? 'ADMITTED' : 'WAITING');
  return view;
};

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear(); sessionStorage.clear(); subscribers.clear(); peakSubscriptions = 0;
  wsSend.mockClear(); vi.clearAllMocks();
  mode = 'CONTROLLED'; bootstrapId = participantId; bootstrapCredential = 'synthetic-credential';
  keyPair = await cryptoUtils.generateSessionKeyPair();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('sse-ticket')
    ? { ticket: 'synthetic-ticket' }
    : { presentationSessionId: 'session-a', participantId: bootstrapId, credential: bootstrapCredential,
      accessMode: mode, accessState: mode === 'PUBLIC' ? 'ADMITTED' : 'WAITING' },
  } as Response)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('preserves the actual E2EE session and waiting-room messages through admission and widget relocation', async () => {
  const view = await start();
  const audienceKey = await owner.privateSignals.getAudiencePublicKey();
  await response('Reply received while waiting');
  await waitFor(() => expect(screen.getByText('"Reply received while waiting"')).toBeTruthy());
  const before = subscribers.size;
  act(() => {
    session.login('Synthetic Alias'); session.setAliasVisible(true);
    emit('AUDIENCE_ACCESS_STATE', { participantId, presentationSessionId: 'session-a', accessMode: mode, accessState: 'ADMITTED' });
  });
  await screen.findByText('Admitted view');
  expect(screen.getByText('"Reply received while waiting"')).toBeTruthy();
  expect(await owner.privateSignals.getAudiencePublicKey()).toBe(audienceKey);
  await waitFor(() => expect(subscribers.size).toBe(before + 1)); // The optional media adapter adds only its RTC moderation subscription.
  act(() => owner.setIsPendingWord(true));
  view.rerender(<Harness relocated />);
  expect(owner.isPendingWord).toBe(true);
  expect(session.nick).toBe('Synthetic Alias'); expect(session.aliasVisible).toBe(true);
  expect(screen.getByText('"Reply received while waiting"')).toBeTruthy();
  await response('Reply after admission');
  await waitFor(() => expect(screen.getByText('"Reply after admission"')).toBeTruthy());
  expect(media.publish).not.toHaveBeenCalled();
  const statusFrames = (wsSend.mock.calls as unknown as Array<[string, Record<string, unknown>]>)
    .filter(([type]) => type === 'LIVE_AUDIO_PARTICIPANT_STATUS' || type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE');
  expect(statusFrames.length).toBeGreaterThan(0);
  expect(statusFrames.every(([, payload]) => payload.participantId === participantId)).toBe(true);
});

it.each(['PUBLIC', 'CONTROLLED'] as const)('uses canonical %s access only after the current WS bind', async accessMode => {
  mode = accessMode;
  render(<Harness />);
  await waitFor(() => expect(access.participantId).toBe(participantId));
  expect(access.isCurrentWsBinding()).toBe(false);
  expect(await owner.privateSignals.sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text: 'not bound' })).toBe(false);
  await bind(mode === 'PUBLIC' ? 'ADMITTED' : 'WAITING');
  await act(async () => expect(await owner.privateSignals.sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text: 'Synthetic private text' })).toBe(true));
  const frames = wsSend.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
  const privateFrame = frames.find(([type]) => type === 'PRIVATE_CONTROL_SIGNAL')![1];
  expect(privateFrame.fromParticipantId).toBe(participantId);
  expect(JSON.stringify(privateFrame)).not.toContain('Synthetic private text');
  expect(JSON.stringify(privateFrame)).not.toContain('rtc-must-not-authorize');
  expect(media.publish).not.toHaveBeenCalled();
});

it('cleans StrictMode subscriptions, preserves state while hidden, and leaves no listeners after unmount', async () => {
  const view = await start(true);
  const steady = subscribers.size;
  await response('Keep this private response');
  await waitFor(() => expect(owner.receivedControlMessages).toHaveLength(1));
  view.rerender(<StrictMode><Harness hidden /></StrictMode>);
  expect(owner.receivedControlMessages).toHaveLength(1);
  expect(subscribers.size).toBe(steady);
  view.rerender(<StrictMode><Harness /></StrictMode>);
  expect(screen.getByText('"Keep this private response"')).toBeTruthy();
  expect(peakSubscriptions).toBe(steady);
  view.unmount();
  expect(subscribers.size).toBe(0);
});

it('preserves the key and messages after same-identity reconnection but rejects sends until rebinding', async () => {
  const view = await start();
  const publicKey = await owner.privateSignals.getAudiencePublicKey();
  await response('Before reconnect');
  await waitFor(() => expect(owner.receivedControlMessages).toHaveLength(1));
  act(() => access.handleWsConnectionChange('closed'));
  view.rerender(<Harness status="closed" />);
  expect(await owner.privateSignals.sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text: 'blocked' })).toBe(false);
  view.rerender(<Harness />);
  await bind();
  expect(await owner.privateSignals.getAudiencePublicKey()).toBe(publicKey);
  expect(owner.receivedControlMessages).toHaveLength(1);
});

it('rotates cryptographic keys without losing current-session messages', async () => {
  await start();
  await response('Before rotation');
  const oldPublicKey = await owner.privateSignals.getAudiencePublicKey();
  keyPair = await cryptoUtils.generateSessionKeyPair();
  const publicKey = await cryptoUtils.exportPublicKey(keyPair);
  act(() => emit('CONTROL_KEY_ROTATED', { keyId: 'key-b', publicKey }));
  await waitFor(() => expect(owner.privateSignals.keyId).toBe('key-b'));
  expect(await owner.privateSignals.getAudiencePublicKey()).not.toBe(oldPublicKey);
  await response('After rotation', 'key-b');
  await waitFor(() => expect(owner.receivedControlMessages).toHaveLength(2));
});

it.each(['disconnect', 'rebind', 'obsolete', 'unmount'] as const)('drops an Audience encryption completed after %s', async invalidation => {
  const view = await start();
  const original = cryptoUtils.encrypt;
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (...args) => { const value = await original(...args); await pause; return value; });
  let pending!: Promise<boolean>;
  act(() => { pending = owner.privateSignals.sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text: 'Obsolete synthetic message' }); });
  if (invalidation === 'disconnect') act(() => access.handleWsConnectionChange('closed'));
  else if (invalidation === 'rebind') {
    act(() => access.handleWsConnectionChange('closed'));
    await bind();
  }
  else if (invalidation === 'obsolete') act(() => emit('AUDIENCE_ACCESS_STATE', { accessState: 'CREDENTIAL_OBSOLETE' }));
  else view.unmount();
  await act(async () => { release(); expect(await pending).toBe(false); });
  expect(wsSend.mock.calls.some(([type]) => type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
});

it('clears private state and rejects an in-flight decryption on credential and identity replacement', async () => {
  await start();
  await response('Previous identity');
  await waitFor(() => expect(owner.receivedControlMessages).toHaveLength(1));
  const original = cryptoUtils.decryptWithNonceReplayProtection;
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'decryptWithNonceReplayProtection').mockImplementation(async (...args) => {
    const value = await original(...args); await pause; return value;
  });
  await response('Late old response');
  bootstrapId = '22222222-2222-4222-8222-222222222222'; bootstrapCredential = 'new-synthetic-credential';
  act(() => emit('PRESENTATION_SESSION_ROTATED', {}));
  await waitFor(() => expect(access.participantId).toBe(bootstrapId));
  await act(async () => { release(); await pause; });
  expect(owner.receivedControlMessages).toHaveLength(0);
  expect(owner.privateSignals.ready).toBe(false);
  expect(access.isCurrentWsBinding()).toBe(false);
});

it('coalesces Audience key creation and repeated Control key announcements', async () => {
  render(<Harness />);
  await waitFor(() => expect(access.participantId).toBe(participantId));
  act(() => {
    access.handleWsConnectionChange('open');
    emit('AUDIENCE_ACCESS_STATE', { participantId, presentationSessionId: 'session-a', accessState: 'WAITING' });
  });
  const generate = vi.spyOn(cryptoUtils, 'generateEphemeralKeyPair');
  const keys = await Promise.all([owner.privateSignals.getAudiencePublicKey(), owner.privateSignals.getAudiencePublicKey()]);
  expect(keys[0]).toBe(keys[1]); expect(generate).toHaveBeenCalledTimes(1);
  await announce(); await announce();
  expect(await owner.privateSignals.getAudiencePublicKey()).toBe(keys[0]);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('keeps grant confirmation and microphone configuration separate from explicit capture', async () => {
  mode = 'PUBLIC';
  await start();
  await screen.findByText('Admitted view');
  await waitFor(() => expect(audio?.state).toBe('connected'));
  act(() => owner.activate('Synthetic Alias', false));
  act(() => owner.requestWord());
  expect(owner.isPendingWord).toBe(true);
  act(() => owner.cancelRequest());
  expect(owner.isPendingWord).toBe(false);
  act(() => emit('LIVE_AUDIO_GRANT_SPEAK', { participantId }));
  await waitFor(() => expect(owner.isWordGranted).toBe(true));
  expect(media.publish).not.toHaveBeenCalled();
  expect(media.publish).not.toHaveBeenCalled();
  act(() => emit('LIVE_AUDIO_REVOKE_SPEAK', { participantId }));
  expect(owner.isWordGranted).toBe(false);
  expect(media.unpublish).toHaveBeenCalled();
});

it('does not let a slow negotiation replace a newer Control key', async () => {
  await start();
  const derive = cryptoUtils.deriveSharedKey;
  let release!: () => void;
  let entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'deriveSharedKey').mockImplementationOnce(async (...args) => {
    const value = await derive(...args); entered = true; await pause; return value;
  });
  const slowPublicKey = await cryptoUtils.exportPublicKey(await cryptoUtils.generateSessionKeyPair());
  act(() => emit('LIVE_AUDIO_CONTROL_PUBLIC_KEY', { keyId: 'slow-key', publicKey: slowPublicKey }));
  await waitFor(() => expect(entered).toBe(true));
  keyPair = await cryptoUtils.generateSessionKeyPair();
  await announce('newest-key');
  await act(async () => { release(); await pause; });
  expect(owner.privateSignals.keyId).toBe('newest-key');
});

it('rejects a repeated encrypted nonce after a repeated public key announcement', async () => {
  await start();
  const frame = await response('Synthetic replay test');
  await waitFor(() => expect(owner.receivedControlMessages).toHaveLength(1));
  await announce();
  const decrypt = vi.spyOn(cryptoUtils, 'decryptWithNonceReplayProtection');
  act(() => emit('PRIVATE_CONTROL_SIGNAL', frame));
  await expect(decrypt.mock.results[0].value).rejects.toThrow();
  expect(owner.receivedControlMessages).toHaveLength(1);
});

it('can retry Audience key generation after a rejected WebCrypto operation', async () => {
  render(<Harness />);
  await waitFor(() => expect(access.participantId).toBe(participantId));
  act(() => {
    access.handleWsConnectionChange('open');
    emit('AUDIENCE_ACCESS_STATE', { participantId, presentationSessionId: 'session-a', accessState: 'WAITING' });
  });
  vi.spyOn(cryptoUtils, 'generateEphemeralKeyPair').mockRejectedValueOnce(new Error('Synthetic key generation failure'));
  await expect(owner.privateSignals.getAudiencePublicKey()).rejects.toThrow('Synthetic key generation failure');
  expect(await owner.privateSignals.getAudiencePublicKey()).toEqual(expect.any(String));
  await announce();
  expect(owner.privateSignals.ready).toBe(true);
});

it('does not publish an Audience key whose creation finishes in a different connection epoch', async () => {
  render(<Harness />);
  await waitFor(() => expect(access.participantId).toBe(participantId));
  act(() => {
    access.handleWsConnectionChange('open');
    emit('AUDIENCE_ACCESS_STATE', { participantId, presentationSessionId: 'session-a', accessState: 'WAITING' });
  });
  const generate = cryptoUtils.generateEphemeralKeyPair;
  let release!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'generateEphemeralKeyPair').mockImplementationOnce(async () => { await pause; return generate(); });
  const pending = owner.privateSignals.getAudiencePublicKey();
  act(() => {
    access.handleWsConnectionChange('closed');
    access.handleWsConnectionChange('open');
    emit('AUDIENCE_ACCESS_STATE', { participantId, presentationSessionId: 'session-a', accessState: 'WAITING' });
  });
  await act(async () => { release(); expect(await pending).toBeNull(); });
  expect(wsSend).not.toHaveBeenCalled();
  expect(await owner.privateSignals.getAudiencePublicKey()).toEqual(expect.any(String));
});

it('clears the owner on obsolete credentials even if bootstrap returns the same identifiers', async () => {
  await start();
  await response('Invalidated private session');
  await waitFor(() => expect(owner.receivedControlMessages).toHaveLength(1));
  const generation = access.sessionGeneration;
  act(() => emit('AUDIENCE_ACCESS_STATE', { accessState: 'CREDENTIAL_OBSOLETE' }));
  await waitFor(() => expect(access.sessionGeneration).toBeGreaterThan(generation));
  await waitFor(() => expect(access.credential).toBe('synthetic-credential'));
  expect(owner.receivedControlMessages).toHaveLength(0);
  expect(owner.privateSignals.ready).toBe(false);
});

it.each(['encryption', 'decryption', 'negotiation'] as const)('invalidates pending %s across WELCOME and rebind on the same connection', async operation => {
  await start();
  await response('History before WELCOME');
  await waitFor(() => expect(owner.receivedControlMessages).toHaveLength(1));
  const identity = [access.participantId, access.credential, access.presentationSessionId, access.sessionGeneration];
  const epoch = access.getWsBindingEpoch();
  const history = owner.receivedControlMessages[0];
  let release!: () => void;
  let entered!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let pending: Promise<unknown>;

  if (operation === 'encryption') {
    const encrypt = cryptoUtils.encrypt;
    vi.spyOn(cryptoUtils, 'encrypt').mockImplementationOnce(async (...args) => {
      const result = await encrypt(...args); entered(); await pause; return result;
    });
    pending = owner.privateSignals.sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text: 'Stale before WELCOME' });
  } else if (operation === 'decryption') {
    const decrypt = cryptoUtils.decryptWithNonceReplayProtection;
    const spy = vi.spyOn(cryptoUtils, 'decryptWithNonceReplayProtection').mockImplementationOnce(async (...args) => {
      const result = await decrypt(...args); entered(); await pause; return result;
    });
    await response('Stale before WELCOME');
    pending = spy.mock.results[0].value;
  } else {
    const derive = cryptoUtils.deriveSharedKey;
    const spy = vi.spyOn(cryptoUtils, 'deriveSharedKey').mockImplementationOnce(async (...args) => {
      const result = await derive(...args); entered(); await pause; return result;
    });
    const publicKey = await cryptoUtils.exportPublicKey(await cryptoUtils.generateSessionKeyPair());
    act(() => emit('LIVE_AUDIO_CONTROL_PUBLIC_KEY', { keyId: 'pending-before-welcome', publicKey }));
    await started;
    pending = spy.mock.results[0].value;
  }

  await started;
  act(() => {
    emit('WELCOME', { role: 'audience', presentationSessionId: 'session-a' });
    expect(access.isCurrentWsBinding()).toBe(false);
    // Do not use bind(): it simulates a connection-status change and would mask this regression.
    emit('AUDIENCE_ACCESS_STATE', { participantId, presentationSessionId: 'session-a', accessMode: mode, accessState: 'WAITING' });
    expect(access.isCurrentWsBinding()).toBe(true);
  });
  await act(async () => {
    release();
    const result = await pending;
    if (operation === 'encryption') expect(result).toBe(false);
  });
  expect(wsSend.mock.calls.some(([type]) => type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
  expect(owner.receivedControlMessages).toEqual([history]);
  if (operation === 'negotiation') {
    expect(owner.privateSignals.keyId).toBeNull();
    await announce('after-welcome');
  }
  expect(access.getWsBindingEpoch()).not.toBe(epoch);
  expect([access.participantId, access.credential, access.presentationSessionId, access.sessionGeneration]).toEqual(identity);

  await act(async () => expect(await owner.privateSignals.sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text: 'Current after WELCOME' })).toBe(true));
  await response('Current reply after WELCOME', operation === 'negotiation' ? 'after-welcome' : 'key-a');
  await waitFor(() => expect(owner.receivedControlMessages.map(message => message.text))
    .toEqual(['History before WELCOME', 'Current reply after WELCOME']));
  expect(owner.receivedControlMessages[0]).toEqual(history);
  expect(media.publish).not.toHaveBeenCalled();
});
