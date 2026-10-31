// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signal: null as null | ((value: unknown) => void), mounts: 0, send: vi.fn(),
  ws: null as null | ((type: string, value: unknown) => void),
  localId: '11111111-1111-4111-8111-111111111111',
  remoteId: '22222222-2222-4222-8222-222222222222',
  lateId: '33333333-3333-4333-8333-333333333333',
  ready: false,
  controlParticipants: [] as Array<{ participantId: string; isMicrophoneActive: boolean }>,
  remoteTracks: [] as Array<{ id: string; participantId: string; track: MediaStreamTrack }>,
}));
const localTrack = { readyState: 'live' } as MediaStreamTrack;
vi.mock('../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({ useLiveAudioAvailability: () => ({ availability: 'enabled' }) }));
vi.mock('../src/features/liveAudio/hooks/useLiveAudio', () => ({ useLiveAudio: () => ({
  state: 'connected', connectionQuality: 'excellent', participantId: mocks.localId,
  isMicrophoneActive: true, microphoneTrackState: 'published', localMicrophoneTrack: localTrack,
  controlParticipants: mocks.controlParticipants,
  remoteTracks: mocks.remoteTracks,
  publishMicrophone: vi.fn(), unpublishMicrophone: vi.fn(), startRemoteAudio: vi.fn(),
}) }));
vi.mock('../src/hooks/usePrivateControlSignals', () => ({ usePrivateControlSignals: (props) => {
  mocks.signal = props.onPrivateSignal;
  return { ready: mocks.ready, keyId: mocks.ready ? 'control-key' : null, sendPrivateSignalToControls: mocks.send, requestAliases: vi.fn() };
} }));
vi.mock('../src/features/liveAudio/components/shared/LiveAudioTrackOutput', () => ({ LiveAudioTrackOutput: () => null }));
vi.mock('../src/components/shared/PwaRestartButton', () => ({ PwaRestartButton: () => null }));
vi.mock('../src/features/voiceScripture/VoiceScriptureControl', () => ({ default: function VoiceRuntime({ onAvailabilityChange, selectedId, canTranscribe }) {
  useEffect(() => { mocks.mounts++; onAvailabilityChange(true); }, [onAvailabilityChange]);
  return <div data-testid="runtime" data-selected={selectedId} data-transcribes={String(canTranscribe)} />;
} }));
let Container: typeof import('../src/components/control/ControlParticipationOwner').default;
beforeAll(async () => {
  vi.stubEnv('VITE_SEFER_VOICE_SCRIPTURE_BUILD', 'true');
  Container = (await import('../src/components/control/ControlParticipationOwner')).default;
});
beforeEach(() => {
  mocks.mounts = 0; mocks.send.mockReset(); mocks.send.mockResolvedValue(true);
  mocks.ready = false;
  mocks.controlParticipants = [{ participantId: mocks.remoteId, isMicrophoneActive: true }];
  mocks.remoteTracks = [{ id: 'remote-track', participantId: mocks.remoteId, track: localTrack }];
  localStorage.setItem('sefer_control_operator_nick', 'Operador local');
});
afterEach(() => { cleanup(); document.getElementById('live-audio-inbox-portal-target')?.remove(); localStorage.clear(); });
const setup = async () => {
  const host = document.createElement('div'); host.id = 'live-audio-inbox-portal-target'; document.body.append(host);
  const view = render(<Container wsStatus="open" isControlAuthorized controlState="PRINCIPAL" controlSessionId="session"
    subscribeToWsMessage={(handler) => { mocks.ws = handler; return () => undefined; }} />);
  await screen.findByTestId('runtime');
  await act(async () => mocks.signal?.({ isControlSignal: true, fromParticipantId: mocks.remoteId, value: { type: 'CONTROL_PROFILE', alias: 'Operador remoto', volume: 100 } }));
  return view;
};

it('selects, switches and deselects microphones; closing panels preserves the runtime', async () => {
  await setup();
  const local = screen.getByRole('button', { name: 'Comandos de voz: Operador local' });
  const remote = screen.getByRole('button', { name: 'Comandos de voz: Operador remoto' });
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe('');
  fireEvent.click(local);
  expect(local.getAttribute('aria-pressed')).toBe('true');
  expect(local.className).toContain('ring-yellow-400');
  expect(screen.getByTitle('Silenciar tu micrófono').className).toContain('ring-yellow-400');
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
    type: 'VOICE_SOURCE_SELECTION', participantId: mocks.localId, version: 1,
  }));
  expect(Object.keys(mocks.send.mock.calls.find(([value]) => value.type === 'VOICE_SOURCE_SELECTION')![0]).sort())
    .toEqual(['participantId', 'type', 'updatedAt', 'version']);
  fireEvent.click(screen.getByTitle('Bandeja Privada'));
  fireEvent.click(screen.getByTitle('Bandeja Privada'));
  fireEvent.click(screen.getByTitle('Ver panel de usuarios'));
  fireEvent.click(screen.getByTitle('Ver panel de usuarios'));
  expect(mocks.mounts).toBe(1);
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe(mocks.localId);
  fireEvent.click(remote);
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe(mocks.remoteId);
  expect(local.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(remote);
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe('');
});

it('shows controller nicknames in a collapsible group without moderation actions', async () => {
  await setup();
  const group = screen.getByText('Controles (2)').closest('details')!;
  expect(group).toBeTruthy();
  expect(within(group).getAllByTitle('Ajustar micro remoto')).toHaveLength(2);
  expect(within(group).queryByTitle('Revocar palabra')).toBeNull();
  expect(within(group).queryByTitle('Restringir participación')).toBeNull();
  expect(within(group).queryByTitle('Silenciar track')).toBeNull();
  fireEvent.click(within(group).getAllByTitle('Ajustar micro remoto')[1]);
  fireEvent.change(within(group).getByRole('slider'), { target: { value: '125' } });
  expect(mocks.send).toHaveBeenCalledWith({ type: 'CONTROL_MICROPHONE_CONFIG', targetParticipantId: mocks.remoteId, volume: 125 });
});

it('shows remote Control publication in blue and its publishing transition in orange', async () => {
  await setup();
  const remote = screen.getByRole('button', { name: 'Comandos de voz: Operador remoto' });
  expect(remote.className).toContain('text-blue-400');
  await act(async () => mocks.ws?.('LIVE_AUDIO_PARTICIPANT_STATUS', {
    type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: mocks.remoteId, role: 'control',
    speakerState: 'GRANTED', canPublishAudio: true, canSubscribe: true, isMuted: true,
    isMicrophoneActive: false, microphoneTrackState: 'publishing', connected: true, updatedAt: 1,
  }));
  expect(remote.className).toContain('text-orange-400');
  await act(async () => mocks.ws?.('LIVE_AUDIO_PARTICIPANT_STATUS', {
    type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: mocks.remoteId, role: 'control',
    speakerState: 'GRANTED', canPublishAudio: true, canSubscribe: true, isMuted: false,
    isMicrophoneActive: true, microphoneTrackState: 'published', connected: true, updatedAt: 2,
  }));
  expect(remote.className).toContain('text-blue-400');
});

it('does not accept controller configuration from an audience sender', async () => {
  await setup();
  await act(async () => mocks.signal?.({ fromParticipantId: '33333333-3333-4333-8333-333333333333', value: { type: 'CONTROL_MICROPHONE_CONFIG', targetParticipantId: mocks.localId, volume: 0 } }));
  const group = screen.getByText('Controles (2)').closest('details')!;
  expect(within(group).getAllByText('100%')).toHaveLength(2);
});

it('applies encrypted shared selection without echo and rejects malformed payloads', async () => {
  await setup();
  mocks.send.mockClear();
  await act(async () => mocks.signal?.({
    isControlSignal: true, fromParticipantId: mocks.remoteId,
    value: { type: 'VOICE_SOURCE_SELECTION', participantId: mocks.remoteId, version: 1, updatedAt: 10 },
  }));
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe(mocks.remoteId);
  expect(screen.getByText(/Operador remoto · Disponible/)).toBeTruthy();
  expect(mocks.send).not.toHaveBeenCalled();

  await act(async () => mocks.signal?.({
    isControlSignal: true, fromParticipantId: mocks.remoteId,
    value: { type: 'VOICE_SOURCE_SELECTION', participantId: 'not-a-participant', version: 1, updatedAt: 11 },
  }));
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe(mocks.remoteId);
});

it('keeps participant selection when its temporary track disappears', async () => {
  const view = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Comandos de voz: Operador remoto' }));
  mocks.remoteTracks = [];
  mocks.controlParticipants = [];
  view.rerender(<Container wsStatus="open" isControlAuthorized controlState="PRINCIPAL" controlSessionId="session"
    subscribeToWsMessage={(handler) => { mocks.ws = handler; return () => undefined; }} />);
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe(mocks.remoteId);
  expect(screen.getByText(/Operador remoto · Micrófono no disponible/)).toBeTruthy();
  const replacementTrack = { readyState: 'live' } as MediaStreamTrack;
  mocks.controlParticipants = [{ participantId: mocks.remoteId, isMicrophoneActive: true }];
  mocks.remoteTracks = [{ id: 'replacement-track', participantId: mocks.remoteId, track: replacementTrack }];
  view.rerender(<Container wsStatus="open" isControlAuthorized controlState="PRINCIPAL" controlSessionId="session"
    subscribeToWsMessage={(handler) => { mocks.ws = handler; return () => undefined; }} />);
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe(mocks.remoteId);
  expect(screen.getByText(/Operador remoto · Disponible/)).toBeTruthy();
});

it('marks secondary controls as passive Voice Scripture observers', async () => {
  const host = document.createElement('div'); host.id = 'live-audio-inbox-portal-target'; document.body.append(host);
  render(<Container wsStatus="open" isControlAuthorized controlState="AUTHORIZED" controlSessionId="secondary"
    subscribeToWsMessage={(handler) => { mocks.ws = handler; return () => undefined; }} />);
  expect((await screen.findByTestId('runtime')).getAttribute('data-transcribes')).toBe('false');
});

it('replays the current encrypted selection when a Control joins late', async () => {
  mocks.ready = true;
  const view = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Comandos de voz: Operador local' }));
  mocks.send.mockClear();
  mocks.controlParticipants = [
    { participantId: mocks.remoteId, isMicrophoneActive: true },
    { participantId: mocks.lateId, isMicrophoneActive: false },
  ];
  view.rerender(<Container wsStatus="open" isControlAuthorized controlState="PRINCIPAL" controlSessionId="session"
    subscribeToWsMessage={(handler) => { mocks.ws = handler; return () => undefined; }} />);
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
    type: 'VOICE_SOURCE_SELECTION', participantId: mocks.localId, version: 1,
  }));
});

it('clears the transient selection when the presentation session rotates', async () => {
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Comandos de voz: Operador local' }));
  await act(async () => mocks.ws?.('PRESENTATION_SESSION_ROTATED', {}));
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe('');
  expect(screen.getByTitle('Origen de voz: Sin origen de voz')).toBeTruthy();
});
