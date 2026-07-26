// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudienceLiveAudioPanel } from '../../src/features/liveAudio/components/audience/AudienceLiveAudioPanel';
import { AudiencePrivateControlMessage } from '../../src/features/liveAudio/components/audience/AudiencePrivateControlMessage';
import { LiveAudioControlPanel } from '../../src/features/liveAudio/components/control/LiveAudioControlPanel';
import { LiveAudioParticipantRow } from '../../src/features/liveAudio/components/control/LiveAudioParticipantRow';
import {
  PrivateControlInbox,
  PrivateInboxNotificationStatus,
} from '../../src/features/liveAudio/components/control/PrivateControlInbox';
import { AudienceAccessGate } from '../../src/components/audience/AudienceAccessGate';

const accessibilityMocks = vi.hoisted(() => ({ availability: 'enabled' }));

vi.mock('../../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({
  useLiveAudioAvailability: () => ({ availability: accessibilityMocks.availability }),
}));
vi.mock('../../src/hooks/usePrivateControlSignals', () => ({
  usePrivateControlSignals: () => ({
    ready: true,
    sendPrivateSignal: vi.fn(() => Promise.resolve(true)),
  }),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
  accessibilityMocks.availability = 'enabled';
});

const audiencePanelProps = {
  state: 'connected' as const,
  isActive: true,
  isMicrophoneActive: false,
  hasAudioStarted: true,
  isPendingWord: false,
  isWordGranted: true,
  isParticipationBlocked: false,
  volume: 0.5,
  onVolumeChange: vi.fn(),
  microphoneVolume: 100,
  isMusicMode: false,
  onMicrophoneVolumeChange: vi.fn(),
  onMusicModeChange: vi.fn(),
  onStartAudio: vi.fn(),
  onRetryAudio: vi.fn(),
  onJoinActive: vi.fn(),
  onLeaveActive: vi.fn(),
  onRequestWord: vi.fn(),
  onCancelRequest: vi.fn(),
  onToggleMicrophone: vi.fn(),
  onOpenMessage: vi.fn(),
  isAliasVisibleToOthers: false,
  onAliasVisibilityChange: vi.fn(),
  canViewActiveParticipants: true,
  visibleParticipants: ['Ana'],
  recordingState: 'NOT_RECORDING' as const,
  recordingEpoch: 0,
  recordingConfirmed: true,
  variant: 'inline' as const,
};

const controlPanelProps = {
  totalAudience: 2,
  activeUsers: 1,
  isModeratorMuted: true,
  onStartListening: vi.fn(),
  onToggleModeratorMic: vi.fn(),
  listenVolume: 50,
  onListenVolumeChange: vi.fn(),
  microphoneVolume: 100,
  recordingState: 'NOT_RECORDING' as const,
  recordingEpoch: 0,
  recordingMutable: true,
  onRecordingStateChange: vi.fn(),
  onMicrophoneVolumeChange: vi.fn(),
  participants: [],
  isControlAuthorized: true,
  onMuteAll: vi.fn(),
  onGrantAllQueue: vi.fn(),
  onGrant: vi.fn(),
  onRevoke: vi.fn(),
  onMute: vi.fn(),
  onKick: vi.fn(),
  onRescue: vi.fn(),
  pendingWordCount: 0,
};

describe('Live Audio accessible disclosures', () => {
  it('exposes Audience participant and volume disclosures as named buttons', () => {
    render(<AudienceLiveAudioPanel {...audiencePanelProps} />);

    const participants = screen.getByRole('button', { name: 'Mostrar participantes' });
    expect(participants.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(participants);
    expect(participants.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(participants.getAttribute('aria-controls') || '')).toBeTruthy();

    const volume = screen.getByRole('button', { name: /Ajustar volumen/ });
    fireEvent.click(volume);
    expect(volume.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('slider', { name: 'Volumen del audio en vivo' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Volumen del micrófono' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Modo música del micrófono' })).toBeTruthy();
  });

  it('removes collapsed Control drawer actions from the accessibility tree', () => {
    render(<LiveAudioControlPanel {...controlPanelProps} />);

    expect(screen.queryByRole('button', { name: 'Declarar grabación' })).toBeNull();
    const drawer = screen.getByRole('button', { name: 'Abrir panel de usuarios' });
    expect(drawer.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(drawer);

    expect(screen.getByRole('button', { name: 'Declarar grabación' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar panel de usuarios' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('labels Control volume disclosures and values', () => {
    render(<LiveAudioControlPanel {...controlPanelProps} />);

    const listen = screen.getByRole('button', { name: /Ajustar volumen de escucha/ });
    fireEvent.click(listen);
    expect(screen.getByRole('slider', { name: 'Volumen de escucha' }).getAttribute('aria-valuetext')).toBe('50 por ciento');

    const microphone = screen.getByRole('button', { name: /Ajustar volumen de salida/ });
    fireEvent.click(microphone);
    expect(screen.getByRole('slider', { name: 'Volumen de salida del micrófono de Control' })).toBeTruthy();
  });
});

describe('Live Audio accessible dynamic state', () => {
  it('announces reconnection and exposes failure as a named retry action', () => {
    const view = render(<AudienceLiveAudioPanel {...audiencePanelProps} state="reconnecting" />);
    expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('Reconectando'))).toBe(true);

    view.rerender(<AudienceLiveAudioPanel {...audiencePanelProps} state="reconnectFailed" />);
    expect(screen.getByRole('button', { name: /reconexión de audio falló/i })).toBeTruthy();
  });

  it('announces blocking and restores focus after a remote phase change', async () => {
    const view = render(<AudienceLiveAudioPanel {...audiencePanelProps} />);
    screen.getByRole('button', { name: 'Activar micrófono' }).focus();

    view.rerender(
      <AudienceLiveAudioPanel
        {...audiencePanelProps}
        isActive={false}
        isWordGranted={false}
        isParticipationBlocked
      />,
    );

    const blocked = screen.getByRole('alert');
    expect(blocked.textContent).toContain('Participación bloqueada por Control');
    await waitFor(() => expect(document.activeElement).toBe(blocked));
  });

  it('announces only a neutral private inbox count and supports closing', () => {
    const onClose = vi.fn();
    render(
      <>
        <PrivateInboxNotificationStatus count={1} />
        <PrivateControlInbox
          isOpen
          isControlAuthorized
          messages={[{ id: 'm1', fromAlias: 'Alias privado', content: 'Contenido privado', timestamp: 1 }]}
          authorizationRequests={[]}
          onApproveRequest={vi.fn()}
          onRejectRequest={vi.fn()}
          onDismissMessage={vi.fn()}
          onClose={onClose}
        />
      </>,
    );

    expect(screen.getByRole('status').textContent).toBe('1 notificaciones privadas pendientes');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar bandeja privada' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('announces a neutral private count while the inbox remains closed', () => {
    const view = render(<PrivateInboxNotificationStatus count={0} />);
    view.rerender(<PrivateInboxNotificationStatus count={2} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('2 notificaciones privadas pendientes');
    expect(status.textContent).not.toContain('alias');
  });

  it('uniquely names inbox decisions and restores focus when a request disappears', async () => {
    const commonProps = {
      isOpen: true,
      isControlAuthorized: true,
      messages: [],
      authorizationRequests: [],
      onApproveRequest: vi.fn(),
      onRejectRequest: vi.fn(),
      onDismissMessage: vi.fn(),
      onClose: vi.fn(),
      onAudienceAccessDecision: vi.fn(),
    };
    const view = render(
      <PrivateControlInbox
        {...commonProps}
        audienceAccessRequests={[
          { participantId: 'a', alias: 'Ana', requestedAt: 1 },
          { participantId: 'b', alias: 'Berta', requestedAt: 2 },
        ]}
      />,
    );
    const admitAna = screen.getByRole('button', { name: 'Admitir a Ana' });
    expect(screen.getByRole('button', { name: 'Admitir a Berta' })).toBeTruthy();
    admitAna.focus();

    view.rerender(
      <PrivateControlInbox
        {...commonProps}
        audienceAccessRequests={[{ participantId: 'b', alias: 'Berta', requestedAt: 2 }]}
      />,
    );
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cerrar bandeja privada' }),
    ));
  });

  it('announces Live Audio availability failures in the private inbox', () => {
    accessibilityMocks.availability = 'unsupported';
    render(
      <PrivateControlInbox
        isOpen
        isControlAuthorized
        messages={[]}
        authorizationRequests={[]}
        onApproveRequest={vi.fn()}
        onRejectRequest={vi.fn()}
        onDismissMessage={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Audio no compatible');
  });

  it('announces message sending and reports success before closing', async () => {
    let resolveSend: ((value: boolean) => void) | undefined;
    const onSend = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveSend = resolve;
    }));
    const onSent = vi.fn();
    const onClose = vi.fn();
    render(<AudiencePrivateControlMessage onClose={onClose} onSend={onSend} onSent={onSent} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(screen.getByRole('status').textContent).toContain('Enviando');

    resolveSend?.(true);
    await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the rejected-access countdown outside the live region', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T10:00:00Z'));
    render(
      <AudienceAccessGate
        accessState="REJECTED"
        participantId="participant-1"
        retryAt={Date.now() + 2_000}
        wsStatus="open"
        wsSend={vi.fn(() => true)}
        subscribeToWsMessage={() => () => {}}
        onAliasAccepted={vi.fn()}
      />,
    );

    const rejection = screen.getByRole('status');
    expect(rejection.textContent).not.toMatch(/\d+ segundos/);
    expect(screen.getByText(/Disponible en 2 segundos/).getAttribute('aria-hidden')).toBe('true');

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('status').textContent).toBe(rejection.textContent);
  });
});

describe('participant row accessible state', () => {
  it('names participant controls, exposes toggle state, and reveals actions on focus', () => {
    render(
      <LiveAudioParticipantRow
        participant={{
          participantId: 'participant-1',
          alias: 'Ana',
          speakerState: 'LISTENER',
          isMuted: true,
          isMicrophoneActive: false,
          isActiveAudience: true,
          isKicked: false,
          isAliasVisibleToActiveParticipants: true,
          isAliasHiddenByControl: true,
          canViewActiveParticipants: false,
          microphoneVolume: 90,
          isMusicMode: false,
        }}
        isControlAuthorized
        onGrant={vi.fn()}
        onSetAliasSharedVisibility={vi.fn()}
        onSetActiveListViewPermission={vi.fn()}
        onMicrophoneConfigChange={vi.fn()}
      />,
    );

    const grant = screen.getByRole('button', { name: 'Permitir micrófono a Ana' });
    grant.focus();
    expect(grant.parentElement?.className).toContain('group-focus-within:opacity-100');

    const aliasToggle = screen.getByRole('button', { name: 'Mostrar alias de Ana a otros participantes' });
    expect(aliasToggle.getAttribute('aria-pressed')).toBe('false');
    const listToggle = screen.getByRole('button', { name: 'Conceder a Ana permiso para ver participantes' });
    expect(listToggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /Ajustar micrófono de Ana/ }));
    expect(screen.getByRole('slider', { name: 'Volumen del micrófono de Ana' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Modo música del micrófono de Ana' })).toBeTruthy();
  });
});
