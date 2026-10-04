// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudienceLiveAudioPanel } from '../src/features/liveAudio/components/audience/AudienceLiveAudioPanel';
import { LiveAudioParticipantRow, type LiveAudioParticipant } from '../src/features/liveAudio/components/control/LiveAudioParticipantRow';
import { LiveAudioControlPanel } from '../src/features/liveAudio/components/control/LiveAudioControlPanel';

afterEach(cleanup);

const participant = (overrides: Partial<LiveAudioParticipant> = {}): LiveAudioParticipant => ({
  participantId: 'participant-1',
  alias: 'Participante',
  speakerState: 'GRANTED',
  isMuted: true,
  isMicrophoneActive: false,
  microphoneTrackState: 'off',
  isActiveAudience: true,
  isKicked: false,
  ...overrides,
});

describe('Live Audio microphone state UI', () => {
  it('waits for an audio connection before allowing a Control grant', () => {
    const onGrant = vi.fn();
    const view = render(<LiveAudioParticipantRow participant={participant({ speakerState: 'LISTENER', liveAudioConnectionState: 'reconnectFailed' })} isControlAuthorized onGrant={onGrant} />);
    const button = screen.getByRole('button', { name: 'Permitir' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onGrant).not.toHaveBeenCalled();
    view.rerender(<LiveAudioParticipantRow participant={participant({ speakerState: 'LISTENER', liveAudioConnectionState: 'connected' })} isControlAuthorized onGrant={onGrant} />);
    fireEvent.click(screen.getByRole('button', { name: 'Permitir' }));
    expect(onGrant).toHaveBeenCalledExactlyOnceWith('participant-1');
  });
  it.each([
    ['permission granted without a track', participant(), 'Micrófono apagado'],
    ['publishing', participant({ microphoneTrackState: 'publishing' }), 'Publicando micrófono'],
    ['published', participant({ microphoneTrackState: 'published', isMicrophoneActive: true, isMuted: false }), 'Micrófono publicado'],
    ['error', participant({ microphoneTrackState: 'error' }), 'Error al publicar el micrófono'],
  ])('shows %s distinctly in Control', (_label, value, title) => {
    const { unmount } = render(<LiveAudioParticipantRow participant={value} isControlAuthorized />);
    expect(screen.getByTitle(title)).toBeTruthy();
    unmount();
  });

  it('shows orange while Audience publishes and red with an explicit retry after failure', () => {
    const props = {
      state: 'connected' as const,
      isActive: true,
      isMicrophoneActive: false,
      microphoneTrackState: 'publishing' as const,
      hasAudioStarted: true,
      isPendingWord: false,
      isWordGranted: true,
      isParticipationBlocked: false,
      volume: 1,
      onVolumeChange: vi.fn(), onStartAudio: vi.fn(), onRetryAudio: vi.fn(), onJoinActive: vi.fn(),
      onLeaveActive: vi.fn(), onRequestWord: vi.fn(), onCancelRequest: vi.fn(), onToggleMicrophone: vi.fn(),
      onOpenMessage: vi.fn(), isAliasVisibleToOthers: false, onAliasVisibilityChange: vi.fn(),
      canViewActiveParticipants: false, visibleParticipants: [], externalBroadcastState: 'off' as const,
      variant: 'inline' as const,
    };
    const view = render(<AudienceLiveAudioPanel {...props} />);
    expect(screen.getByTitle('Activando micrófono').className).toContain('bg-orange-600');

    view.rerender(<AudienceLiveAudioPanel {...props} microphoneTrackState="error" />);
    expect(screen.getByRole('alert').textContent).toContain('Pulsa de nuevo para reintentar');
    expect(screen.getByTitle('Error de micrófono; pulsar para reintentar').className).toContain('bg-red-700');
  });

  it('shows moderation failures visibly in Control', () => {
    render(<LiveAudioControlPanel
      totalAudience={1} activeUsers={1} isModeratorMuted onStartListening={vi.fn()}
      onToggleModeratorMic={vi.fn()} listenVolume={100} onListenVolumeChange={vi.fn()}
      microphoneVolume={100} onMicrophoneVolumeChange={vi.fn()} participants={[]}
      isControlAuthorized onMuteAll={vi.fn()} onGrantAllQueue={vi.fn()} onGrant={vi.fn()}
      onRevoke={vi.fn()} onMute={vi.fn()} onKick={vi.fn()} onRescue={vi.fn()}
      pendingWordCount={0} externalBroadcastState="off" onExternalBroadcastStateChange={vi.fn()}
      moderationError="LiveKit rechazó la actualización"
    />);

    expect(screen.getByText(/LiveKit rechazó la actualización/).textContent).toContain('LiveKit rechazó la actualización');
    const volumeButton = screen.getByRole('button', { name: 'Regular volumen de salida de tu micro' });
    expect(volumeButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(volumeButton);
    expect(volumeButton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('slider', { name: 'Volumen de salida de tu micro' })).toBeTruthy();
  });
});
