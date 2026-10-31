// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PrivateControlSignalsState } from '../src/hooks/usePrivateControlSignals';
import * as crypto from '../src/utils/cryptoUtils';
import { useControlAuthorization } from '../src/hooks/useControlAuthorization';

const media = vi.hoisted(() => ({ availability: 'enabled', state: 'connected', fail: false,
  publish: vi.fn(async () => {}), unpublish: vi.fn(async () => {}), start: vi.fn(async () => {}), mount: vi.fn(), retire: vi.fn() }));
const observed = vi.hoisted(() => ({ signals: null as PrivateControlSignalsState | null }));
vi.mock('../src/hooks/usePrivateControlSignals', async original => {
  const module = await original<typeof import('../src/hooks/usePrivateControlSignals')>();
  return { ...module, usePrivateControlSignals: (options: Parameters<typeof module.usePrivateControlSignals>[0]) => {
    const signals = module.usePrivateControlSignals(options); observed.signals = signals; return signals;
  } };
});
vi.mock('../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({ useLiveAudioAvailability: () => ({ availability: media.availability }) }));
vi.mock('../src/features/liveAudio/hooks/useLiveAudio', async () => {
  const { useEffect } = await import('react');
  return { useLiveAudio: () => {
  useEffect(() => () => { media.retire(); }, []);
  media.mount(); if (media.fail) throw new Error('Synthetic RTC render failure');
  return { state: media.state, connectionQuality: 'good', participantId: '22222222-2222-4222-8222-222222222222',
    isMicrophoneActive: false, microphoneTrackState: 'off', remoteTracks: [], controlParticipants: [],
    publishMicrophone: media.publish, republishMicrophone: media.publish, unpublishMicrophone: media.unpublish, startRemoteAudio: media.start };
} };
});
vi.mock('../src/components/shared/PwaRestartButton', () => ({ PwaRestartButton: () => null }));
const subscribers = new Set<(type: string, payload: Record<string, unknown>) => void>();
const subscribe = (handler: (type: string, payload: Record<string, unknown>) => void) => {
  subscribers.add(handler); return () => { subscribers.delete(handler); };
};
const send = vi.fn(() => true);
const participantId = '11111111-1111-4111-8111-111111111111';
const emit = (type: string, value: Record<string, unknown>) => act(() => { for (const handler of [...subscribers]) handler(type, value); });

beforeEach(() => {
  vi.resetModules(); vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks();
  media.availability = 'enabled'; media.state = 'connected'; media.fail = false;
  subscribers.clear(); localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.doUnmock('../src/features/liveAudio/components/control/LiveAudioControlContainer');
});
afterEach(() => { cleanup(); expect(subscribers.size).toBe(0); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('passes the canonical presentation session through authorization and rotation without adding a second owner', () => {
  const hook = renderHook(() => useControlAuthorization({ wsStatus: 'open', sendMessage: send, subscribeToWsMessage: subscribe }));
  emit('WELCOME', { controlSessionId: 'control-a', controlState: 'PRINCIPAL', presentationSessionId: 'session-a' });
  expect(hook.result.current.presentationSessionId).toBe('session-a');
  emit('PRESENTATION_SESSION_ROTATED', { presentationSessionId: 'session-b' });
  expect(hook.result.current.presentationSessionId).toBe('session-b');
  expect(hook.result.current.controlSessionId).toBe('control-a');
  expect(hook.result.current.controlState).toBe('PRINCIPAL');
  expect(subscribers.size).toBe(1);
});

async function start(scenario: string) {
  vi.stubEnv('VITE_SEFER_LIVE_AUDIO_BUILD', scenario === 'buildFalse' ? 'false' : 'true');
  if (['disabled', 'misconfigured', 'unsupported'].includes(scenario)) media.availability = scenario;
  if (scenario === 'disconnect') media.state = 'reconnectFailed';
  if (scenario === 'renderFailure') media.fail = true;
  if (scenario === 'loadFailure') vi.doMock('../src/features/liveAudio/components/control/LiveAudioControlContainer', () => { throw new Error('Synthetic import failure'); });
  const Owner = (await import('../src/components/control/ControlParticipationOwner')).default;
  const props = { presentationSessionId: 'session-a', controlSessionId: 'control-a', controlState: 'PRINCIPAL' as const,
    isControlAuthorized: true, wsStatus: 'open' as const, wsSend: send, subscribeToWsMessage: subscribe };
  const view = render(<StrictMode><Owner {...props} /></StrictMode>);
  await waitFor(() => expect(observed.signals?.ready).toBe(true));
  const keyId = observed.signals!.keyId, publicKey = observed.signals!.controlPublicKey;
  const audienceKeys = await crypto.generateEphemeralKeyPair(), audiencePublic = await crypto.exportPublicKey(audienceKeys);
  const shared = await crypto.deriveSharedKey(audienceKeys.privateKey, await crypto.importPublicKey(publicKey!));
  emit('LIVE_AUDIO_PARTICIPANT_STATUS', { type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId, role: 'audience',
    connected: true, isActiveAudience: true, speakerState: 'REQUESTED', canPublishAudio: false,
    isMicrophoneActive: false, isMuted: true, liveAudioConnectionState: 'unavailable', updatedAt: Date.now() });
  emit('LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', { participantId, activeListPublicKey: audiencePublic, isAliasVisibleToActiveParticipants: false });
  const encrypted = await crypto.encrypt(shared, JSON.stringify({ type: 'REQUEST_WORD', alias: 'Synthetic Audience' }));
  emit('PRIVATE_CONTROL_SIGNAL', { type: 'PRIVATE_CONTROL_SIGNAL', fromParticipantId: participantId,
    keyId, ephemeralPublicKey: audiencePublic, ...encrypted });
  fireEvent.click(screen.getByTitle('Bandeja Privada'));
  await screen.findByRole('option', { name: 'Synthetic Audience' });
  const panel = screen.getByText('Notificaciones').closest('.fixed') as HTMLElement;
  fireEvent.change(within(panel).getByRole('combobox', { name: 'Destinatario' }), { target: { value: participantId } });
  fireEvent.change(within(panel).getByRole('textbox', { name: 'Mensaje' }), { target: { value: 'Secure message without RTC' } });
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', false));
  return { view, Owner, props, panel, shared, keyId, publicKey };
}

it('retires the RTC adapter on a presentation-session change even if the Control id is reused', async () => {
  const { view, Owner, props } = await start('enabled');
  const before = media.retire.mock.calls.length;
  view.rerender(<StrictMode><Owner {...props} presentationSessionId="session-b" /></StrictMode>);
  await waitFor(() => expect(media.retire.mock.calls.length).toBeGreaterThan(before));
  expect(media.publish).not.toHaveBeenCalled();
});

it.each(['enabled', 'disabled', 'misconfigured', 'unsupported', 'disconnect', 'loadFailure', 'renderFailure', 'buildFalse'])('keeps the actual owner, inbox, queue, admission and E2EE active with RTC=%s', async scenario => {
  const { panel, shared, keyId } = await start(scenario);
  expect(subscribers.size).toBe(2);
  expect(screen.getByTitle('Ver panel de usuarios')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Acceso:/ })).toBeTruthy();
  fireEvent.click(within(panel).getByRole('button', { name: 'Enviar' }));
  await within(panel).findByText('Synthetic Audience', { selector: 'bdi' });
  await within(panel).findByText('Secure message without RTC');
  await waitFor(() => {
    const frames = (send.mock.calls as unknown as Array<[string, Record<string, unknown>]>).filter(([type]) => type === 'PRIVATE_CONTROL_SIGNAL');
    expect(frames.some(([, frame]) => frame.toParticipantId === participantId)).toBe(true);
  });
  const frames = (send.mock.calls as unknown as Array<[string, Record<string, unknown>]>).filter(([type]) => type === 'PRIVATE_CONTROL_SIGNAL');
  const recipient = frames.find(([, frame]) => frame.toParticipantId === participantId)![1];
  expect(recipient.keyId).toBe(keyId);
  expect(JSON.parse(await crypto.decrypt(shared, recipient.ciphertext as string, recipient.nonce as string))).toMatchObject({
    type: 'CHAT_RESPONSE', text: 'Secure message without RTC', presentationSessionId: 'session-a', operationId: expect.any(String),
  });
  expect(JSON.stringify(frames)).not.toContain('Secure message without RTC');
  expect(media.publish).not.toHaveBeenCalled();
  if (scenario === 'buildFalse' || scenario === 'loadFailure') expect(media.mount).not.toHaveBeenCalled();
});

it('keeps the open conversation, draft and keys through a mounted RTC failure, and gates microphone capture on explicit action', async () => {
  const { view, Owner, props, panel, keyId, publicKey } = await start('enabled');
  await screen.findByTitle('Abrir tu micrófono');
  expect(media.publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('Abrir tu micrófono'));
  expect(media.publish).toHaveBeenCalledTimes(1);
  media.fail = true;
  view.rerender(<StrictMode><Owner {...props} /></StrictMode>);
  await waitFor(() => expect(screen.queryByTitle('Abrir tu micrófono')).toBeNull());
  expect(observed.signals!.keyId).toBe(keyId); expect(observed.signals!.controlPublicKey).toBe(publicKey);
  expect(within(panel).getByRole('textbox', { name: 'Mensaje' })).toHaveProperty('value', 'Secure message without RTC');
  fireEvent.click(within(panel).getByRole('button', { name: 'Enviar' }));
  await within(panel).findByText('Synthetic Audience', { selector: 'bdi' });
  await within(panel).findByText('Secure message without RTC');
  expect(subscribers.size).toBe(2);
});

it('shows a rejected oversized encrypted payload as a failure and keeps its draft', async () => {
  const { panel } = await start('buildFalse');
  const before = send.mock.calls.length;
  const draft = '漢'.repeat(1000);
  fireEvent.change(within(panel).getByRole('textbox', { name: 'Mensaje' }), { target: { value: draft } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Enviar' }));
  await within(panel).findByRole('alert');
  expect(within(panel).getByRole('textbox', { name: 'Mensaje' })).toHaveProperty('value', draft);
  expect(within(panel).getByRole('combobox', { name: 'Destinatario' })).toHaveProperty('value', participantId);
  expect(send.mock.calls.length).toBe(before);
});

it('dispatches logical moderation actions without RTC and preserves controlSessionId as issuer', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await start('buildFalse');
  fireEvent.click(screen.getByTitle('Ver panel de usuarios'));
  fireEvent.click(await screen.findByRole('button', { name: 'Restringir a Synthetic Audience' }));
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith(
      'LIVE_AUDIO_KICK_PARTICIPANT',
      expect.objectContaining({
        type: 'LIVE_AUDIO_KICK_PARTICIPANT',
        participantId,
        issuedByParticipantId: 'control-a',
      }),
    );
  });
});
