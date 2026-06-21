import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AudienceLiveAudioPanel } from './AudienceLiveAudioPanel';
import { AudienceInterventionModal } from './AudienceInterventionModal';
import { AudiencePrivateControlMessage } from './AudiencePrivateControlMessage';
import { useLiveAudio } from '../../hooks/useLiveAudio';
import { usePrivateControlSignals } from '../../../../hooks/usePrivateControlSignals';
import type { LiveAudioAvailability, SpeakerState } from '../../../../types/liveAudio';
import { LiveAudioTrackOutput } from '../shared/LiveAudioTrackOutput';

interface LiveAudioAudienceContainerProps {
  availability: LiveAudioAvailability;
  wsSend: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
  clientId: string; // Used as fallback or session identifier if needed
}

interface ParticipantStatusOptions {
  canPublishAudio?: boolean;
  isMuted?: boolean;
  isActiveAudience?: boolean;
  isMicrophoneActive?: boolean;
  isKicked?: boolean;
}

export default function LiveAudioAudienceContainer({
  availability,
  wsSend,
  subscribeToWsMessage,
  clientId
}: LiveAudioAudienceContainerProps) {
  const [isActive, setIsActive] = useState(false);
  const [isPendingWord, setIsPendingWord] = useState(false);
  const [isWordGranted, setIsWordGranted] = useState(false);
  const [isKicked, setIsKicked] = useState(false);
  const [activeAlias, setActiveAlias] = useState<string | null>(null);
  const [keyRotationCount, setKeyRotationCount] = useState(0);
  
  const [showInterventionModal, setShowInterventionModal] = useState(false);
  const [showPrivateMessageModal, setShowPrivateMessageModal] = useState(false);

  const [hasAudioStarted, setHasAudioStarted] = useState(false);
  const [volume, setVolume] = useState(1);

  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useEffect(() => {
    const checkPortal = () => {
      const el = document.getElementById('audience-audio-portal');
      if (el && el !== portalTarget) setPortalTarget(el);
    };
    checkPortal();
    const interval = setInterval(checkPortal, 500);
    return () => clearInterval(interval);
  }, [portalTarget]);

  // 1. Connect to LiveKit as a passive listener
  const {
    state: liveKitState,
    remoteTracks,
    participantId,
    isMicrophoneActive,
    startRemoteAudio,
    publishMicrophone,
    unpublishMicrophone,
    retryAudio,
  } = useLiveAudio({
    role: 'audience',
    autoConnect: availability === 'enabled',
  });

  // 2. Setup private signals
  const { sendPrivateSignal, ready: privateSignalReady } = usePrivateControlSignals({
    role: 'audience',
    participantId: participantId || clientId,
    sendMessage: wsSend,
    subscribeToWsMessage,
    transportReady: availability === 'enabled',
    onControlKeyRotated: () => setKeyRotationCount((current) => current + 1),
  });

  const sendParticipantStatus = useCallback((speakerState: SpeakerState, options: ParticipantStatusOptions = {}) => {
    if (!participantId) return false;
    return wsSend('LIVE_AUDIO_PARTICIPANT_STATUS', {
      type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
      participantId,
      role: 'audience',
      speakerState,
      canSubscribe: true,
      canPublishAudio: options.canPublishAudio ?? false,
      isMuted: options.isMuted ?? true,
      isActiveAudience: options.isActiveAudience ?? false,
      isMicrophoneActive: options.isMicrophoneActive ?? false,
      isKicked: options.isKicked ?? false,
      updatedAt: Date.now(),
    });
  }, [participantId, wsSend]);

  // Listen for grant/revoke messages
  useEffect(() => {
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'LIVE_AUDIO_GRANT_SPEAK' && payload.participantId === participantId) {
        setIsActive(true);
        setIsWordGranted(true);
        setIsPendingWord(false);
        setIsKicked(false);
        sendParticipantStatus('GRANTED', {
          canPublishAudio: true,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
        });
      } else if (type === 'LIVE_AUDIO_REVOKE_SPEAK' && payload.participantId === participantId) {
        setIsWordGranted(false);
        setIsPendingWord(false);
        setIsActive(true);
        void unpublishMicrophone();
        sendParticipantStatus('LISTENER', {
          canPublishAudio: false,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
        });
      } else if (type === 'LIVE_AUDIO_MUTE_PARTICIPANT' && payload.participantId === participantId) {
        setIsActive(true);
        setIsWordGranted(true);
        setIsPendingWord(false);
        void unpublishMicrophone();
        sendParticipantStatus('GRANTED', {
          canPublishAudio: true,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
        });
      } else if (type === 'LIVE_AUDIO_MUTE_ALL') {
        const excluded = Array.isArray(payload.excludeParticipantIds) ? payload.excludeParticipantIds : [];
        if (!participantId || excluded.includes(participantId)) return;
        if (!isWordGranted) return;
        setIsActive(true);
        setIsWordGranted(true);
        setIsPendingWord(false);
        void unpublishMicrophone();
        sendParticipantStatus('GRANTED', {
          canPublishAudio: true,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
        });
      } else if (type === 'LIVE_AUDIO_KICK_PARTICIPANT' && payload.participantId === participantId) {
        setIsActive(false);
        setIsPendingWord(false);
        setIsWordGranted(false);
        setIsKicked(true);
        setActiveAlias(null);
        void unpublishMicrophone();
        sendParticipantStatus('REVOKED', {
          canPublishAudio: false,
          isMuted: true,
          isActiveAudience: false,
          isMicrophoneActive: false,
          isKicked: true,
        });
      }
    });
    return unsubscribe;
  }, [isWordGranted, participantId, sendParticipantStatus, subscribeToWsMessage, unpublishMicrophone]);

  useEffect(() => {
    if (!participantId) return;
    if (!isActive) {
      sendParticipantStatus('REVOKED', {
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: false,
        isMicrophoneActive: false,
        isKicked,
      });
    } else if (isWordGranted) {
      sendParticipantStatus('GRANTED', {
        canPublishAudio: true,
        isMuted: !isMicrophoneActive,
        isActiveAudience: true,
        isMicrophoneActive,
      });
    } else if (isPendingWord) {
      sendParticipantStatus('REQUESTED', {
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
      });
    } else {
      sendParticipantStatus('LISTENER', {
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
      });
    }
  }, [isActive, isKicked, isMicrophoneActive, isPendingWord, isWordGranted, participantId, sendParticipantStatus]);

  useEffect(() => {
    if (liveKitState !== 'reconnectFailed') return;
    if (!isActive && !isPendingWord && !isWordGranted) return;

    void sendPrivateSignal({
      type: 'AUDIO_FALLBACK',
      state: isWordGranted ? 'GRANTED' : isPendingWord ? 'REQUESTED' : 'ACTIVE',
      note: 'Audio no pudo reconectar; usar mensaje privado como respaldo.',
    });
  }, [isActive, isPendingWord, isWordGranted, liveKitState, sendPrivateSignal]);

  useEffect(() => {
    if (!privateSignalReady || !activeAlias) return;
    if (!isActive && !isPendingWord && !isWordGranted) return;

    void sendPrivateSignal({
      type: isPendingWord ? 'REQUEST_WORD' : 'ACTIVE_STATE',
      alias: activeAlias,
      speakerState: isWordGranted ? 'GRANTED' : isPendingWord ? 'REQUESTED' : 'LISTENER',
    });
  }, [activeAlias, isActive, isPendingWord, isWordGranted, keyRotationCount, privateSignalReady, sendPrivateSignal]);

  const handleStartAudio = useCallback(() => {
    void startRemoteAudio().then(() => setHasAudioStarted(true));
  }, [startRemoteAudio]);

  const handleJoinActive = useCallback(() => {
    if (isKicked) return;
    setShowInterventionModal(true);
  }, [isKicked]);

  const handleLeaveActive = useCallback(() => {
    setIsActive(false);
    setIsPendingWord(false);
    setIsWordGranted(false);
    setIsKicked(false);
    setActiveAlias(null);
    setShowInterventionModal(false);
    setShowPrivateMessageModal(false);
    sendParticipantStatus('REVOKED', {
      canPublishAudio: false,
      isMuted: true,
      isActiveAudience: false,
      isMicrophoneActive: false,
      isKicked: false,
    });
    void unpublishMicrophone();
  }, [sendParticipantStatus, unpublishMicrophone]);

  const handleSubmitAlias = useCallback(async (alias: string) => {
    setShowInterventionModal(false);
    setIsActive(true);
    setIsPendingWord(false);
    setIsWordGranted(false);
    setIsKicked(false);
    setActiveAlias(alias);
    sendParticipantStatus('LISTENER', {
      canPublishAudio: false,
      isMuted: true,
      isActiveAudience: true,
      isMicrophoneActive: false,
      isKicked: false,
    });
    
    await sendPrivateSignal({
      type: 'ACTIVE_STATE',
      alias,
      speakerState: 'LISTENER',
    });
  }, [sendParticipantStatus, sendPrivateSignal]);

  const handleCancelRequest = useCallback(() => {
    setIsPendingWord(false);
    sendParticipantStatus('LISTENER', {
      canPublishAudio: false,
      isMuted: true,
      isActiveAudience: true,
      isMicrophoneActive: false,
    });
    void sendPrivateSignal({
      type: 'CANCEL_REQUEST_WORD',
      alias: activeAlias ?? undefined,
    });
  }, [activeAlias, sendParticipantStatus, sendPrivateSignal]);

  const handleRequestWord = useCallback(() => {
    if (isKicked) return;
    setIsPendingWord(true);
    sendParticipantStatus('REQUESTED', {
      canPublishAudio: false,
      isMuted: true,
      isActiveAudience: true,
      isMicrophoneActive: false,
    });
    void sendPrivateSignal({
      type: 'REQUEST_WORD',
      alias: activeAlias ?? undefined,
    });
  }, [activeAlias, isKicked, sendParticipantStatus, sendPrivateSignal]);

  const handleToggleMicrophone = useCallback(() => {
    if (isMicrophoneActive) {
      void unpublishMicrophone();
      sendParticipantStatus('GRANTED', {
        canPublishAudio: true,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
      });
    } else {
      void publishMicrophone()
        .then(() => sendParticipantStatus('GRANTED', {
          canPublishAudio: true,
          isMuted: false,
          isActiveAudience: true,
          isMicrophoneActive: true,
        }))
        .catch((err) => {
          console.error("Failed to publish mic:", err);
        });
    }
  }, [isMicrophoneActive, publishMicrophone, sendParticipantStatus, unpublishMicrophone]);

  const handleRetryAudio = useCallback(() => {
    void retryAudio();
  }, [retryAudio]);

  const handleOpenMessage = useCallback(() => {
    setShowPrivateMessageModal(true);
  }, []);

  const handleSendPrivateMessage = useCallback(async (message: string) => {
    await sendPrivateSignal({
      type: 'PRIVATE_MESSAGE',
      text: message,
      alias: activeAlias ?? undefined,
    });
  }, [activeAlias, sendPrivateSignal]);

  if (availability !== 'enabled') {
    return null;
  }

  return (
    <>
      {remoteTracks.map((remoteTrack) => (
        <LiveAudioTrackOutput
          key={remoteTrack.id}
          remoteTrack={remoteTrack}
          volumePercent={volume * 100}
        />
      ))}

      {isMicrophoneActive && (
        <div className="fixed inset-0 z-40 pointer-events-none border-[6px] md:border-[10px] border-blue-500/80 rounded-xl transition-all shadow-[inset_0_0_30px_rgba(59,130,246,0.6)]"></div>
      )}

      {portalTarget ? createPortal(
        <AudienceLiveAudioPanel
          state={liveKitState}
          isActive={isActive}
          isMicrophoneActive={isMicrophoneActive}
          hasAudioStarted={hasAudioStarted}
          isPendingWord={isPendingWord}
          isWordGranted={isWordGranted}
          isParticipationBlocked={isKicked}
          volume={volume}
          onVolumeChange={setVolume}
          onStartAudio={handleStartAudio}
          onRetryAudio={handleRetryAudio}
          onJoinActive={handleJoinActive}
          onLeaveActive={handleLeaveActive}
          onRequestWord={handleRequestWord}
          onCancelRequest={handleCancelRequest}
          onToggleMicrophone={handleToggleMicrophone}
          onOpenMessage={handleOpenMessage}
        />,
        portalTarget
      ) : (
        <div className="pointer-events-auto">
          <AudienceLiveAudioPanel
            state={liveKitState}
            isActive={isActive}
            isMicrophoneActive={isMicrophoneActive}
            hasAudioStarted={hasAudioStarted}
            isPendingWord={isPendingWord}
            isWordGranted={isWordGranted}
            isParticipationBlocked={isKicked}
            volume={volume}
            onVolumeChange={setVolume}
            onStartAudio={handleStartAudio}
            onRetryAudio={handleRetryAudio}
            onJoinActive={handleJoinActive}
            onLeaveActive={handleLeaveActive}
            onRequestWord={handleRequestWord}
            onCancelRequest={handleCancelRequest}
            onToggleMicrophone={handleToggleMicrophone}
            onOpenMessage={handleOpenMessage}
          />
        </div>
      )}

      {showInterventionModal && (
        <AudienceInterventionModal
          onClose={() => setShowInterventionModal(false)}
          onSubmit={handleSubmitAlias}
        />
      )}

      {showPrivateMessageModal && (
        <AudiencePrivateControlMessage
          onClose={() => setShowPrivateMessageModal(false)}
          onSend={handleSendPrivateMessage}
        />
      )}
    </>
  );
}
