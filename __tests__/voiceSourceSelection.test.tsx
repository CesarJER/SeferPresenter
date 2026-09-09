// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signal: null as null | ((value: unknown) => void), mounts: 0, send: vi.fn(), ws: null as null | ((type: string, value: unknown) => void) }));
const localTrack = { readyState: 'live' } as MediaStreamTrack;
vi.mock('../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({ useLiveAudioAvailability: () => ({ availability: 'enabled' }) }));
vi.mock('../src/features/liveAudio/hooks/useLiveAudio', () => ({ useLiveAudio: () => ({
  state: 'connected', connectionQuality: 'excellent', participantId: 'local',
  isMicrophoneActive: true, localMicrophoneTrack: localTrack,
  controlParticipants: [{ participantId: 'remote', isMicrophoneActive: true }],
  remoteTracks: [{ id: 'remote-track', participantId: 'remote', track: localTrack }],
  publishMicrophone: vi.fn(), unpublishMicrophone: vi.fn(), startRemoteAudio: vi.fn(),
}) }));
vi.mock('../src/hooks/usePrivateControlSignals', () => ({ usePrivateControlSignals: (props) => {
  mocks.signal = props.onPrivateSignal;
  return { ready: false, sendPrivateSignalToControls: mocks.send, requestAliases: vi.fn() };
} }));
vi.mock('../src/features/liveAudio/components/shared/LiveAudioTrackOutput', () => ({ LiveAudioTrackOutput: () => null }));
vi.mock('../src/components/shared/PwaRestartButton', () => ({ PwaRestartButton: () => null }));
vi.mock('../src/features/voiceScripture/VoiceScriptureControl', () => ({ default: function VoiceRuntime({ onAvailabilityChange, selectedId }) {
  useEffect(() => { mocks.mounts++; onAvailabilityChange(true); }, [onAvailabilityChange]);
  return <div data-testid="runtime" data-selected={selectedId} />;
} }));
let Container: typeof import('../src/features/liveAudio/components/control/LiveAudioControlContainer').default;
beforeAll(async () => {
  vi.stubEnv('VITE_SEFER_VOICE_SCRIPTURE_BUILD', 'true');
  Container = (await import('../src/features/liveAudio/components/control/LiveAudioControlContainer')).default;
});
beforeEach(() => {
  mocks.mounts = 0; mocks.send.mockReset(); mocks.send.mockResolvedValue(true);
  localStorage.setItem('sefer_control_operator_nick', 'Operador local');
});
afterEach(() => { cleanup(); document.getElementById('live-audio-inbox-portal-target')?.remove(); localStorage.clear(); });
const setup = async () => {
  const host = document.createElement('div'); host.id = 'live-audio-inbox-portal-target'; document.body.append(host);
  render(<Container isControlAuthorized controlState="PRINCIPAL" controlSessionId="session"
    subscribeToWsMessage={(handler) => { mocks.ws = handler; return () => undefined; }} />);
  await screen.findByTestId('runtime');
  await act(async () => mocks.signal?.({ fromParticipantId: 'remote', value: { type: 'CONTROL_PROFILE', alias: 'Operador remoto', volume: 100 } }));
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
  fireEvent.click(screen.getByTitle('Bandeja Privada'));
  fireEvent.click(screen.getByTitle('Bandeja Privada'));
  fireEvent.click(screen.getByTitle('Ver panel de usuarios'));
  fireEvent.click(screen.getByTitle('Ver panel de usuarios'));
  expect(mocks.mounts).toBe(1);
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe('local-mic');
  fireEvent.click(remote);
  expect(screen.getByTestId('runtime').getAttribute('data-selected')).toBe('remote');
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
  expect(mocks.send).toHaveBeenCalledWith({ type: 'CONTROL_MICROPHONE_CONFIG', targetParticipantId: 'remote', volume: 125 });
});

it('does not accept controller configuration from an audience sender', async () => {
  await setup();
  await act(async () => mocks.signal?.({ fromParticipantId: 'audience', value: { type: 'CONTROL_MICROPHONE_CONFIG', targetParticipantId: 'local', volume: 0 } }));
  const group = screen.getByText('Controles (2)').closest('details')!;
  expect(within(group).getAllByText('100%')).toHaveLength(2);
});
