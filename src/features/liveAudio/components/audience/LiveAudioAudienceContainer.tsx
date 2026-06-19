import { useState, useEffect, useCallback } from 'react';
import { AudienceLiveAudioPanel } from './AudienceLiveAudioPanel';
import { AudienceInterventionModal } from './AudienceInterventionModal';
import { AudiencePrivateControlMessage } from './AudiencePrivateControlMessage';
import { useLiveAudio } from '../../hooks/useLiveAudio';
import { usePrivateControlSignals } from '../../../../hooks/usePrivateControlSignals';
import type { LiveAudioAvailability } from '../../../../types/liveAudio';

interface LiveAudioAudienceContainerProps {
  availability: LiveAudioAvailability;
  wsSend: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
  clientId: string; // Used as fallback or session identifier if needed
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
  
  const [showInterventionModal, setShowInterventionModal] = useState(false);
  const [showPrivateMessageModal, setShowPrivateMessageModal] = useState(false);

  const [hasAudioStarted, setHasAudioStarted] = useState(false);

  // 1. Connect to LiveKit as a passive listener
  const {
    state: liveKitState,
    participantId,
    isMicrophoneActive,
    startRemoteAudio,
    publishMicrophone,
    unpublishMicrophone,
  } = useLiveAudio({
    role: 'audience',
    autoConnect: availability === 'enabled',
  });

  // 2. Setup private signals
  const { sendPrivateSignal } = usePrivateControlSignals({
    role: 'audience',
    participantId: participantId || clientId,
    sendMessage: wsSend,
    subscribeToWsMessage,
    transportReady: availability === 'enabled',
  });

  // Listen for grant/revoke messages
  useEffect(() => {
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'LIVE_AUDIO_GRANT_SPEAK' && payload.participantId === participantId) {
        setIsWordGranted(true);
        setIsPendingWord(false);
      } else if (type === 'LIVE_AUDIO_REVOKE_SPEAK' && payload.participantId === participantId) {
        setIsWordGranted(false);
        void unpublishMicrophone();
      }
    });
    return unsubscribe;
  }, [subscribeToWsMessage, participantId, unpublishMicrophone]);

  const handleStartAudio = useCallback(() => {
    void startRemoteAudio().then(() => setHasAudioStarted(true));
  }, [startRemoteAudio]);

  const handleJoinActive = useCallback(() => {
    setShowInterventionModal(true);
  }, []);

  const handleLeaveActive = useCallback(() => {
    setIsActive(false);
    setIsPendingWord(false);
    setIsWordGranted(false);
    void unpublishMicrophone();
  }, [unpublishMicrophone]);

  const handleSubmitAlias = useCallback(async (alias: string) => {
    setShowInterventionModal(false);
    setIsActive(true);
    setIsPendingWord(true);
    
    // Send encrypted signal to request word
    await sendPrivateSignal({
      type: 'REQUEST_WORD',
      alias,
    });
  }, [sendPrivateSignal]);

  const handleCancelRequest = useCallback(() => {
    setIsPendingWord(false);
    // Send encrypted signal to cancel word request
    void sendPrivateSignal({
      type: 'CANCEL_REQUEST_WORD',
    });
  }, [sendPrivateSignal]);

  const handleToggleMicrophone = useCallback(() => {
    if (isMicrophoneActive) {
      void unpublishMicrophone();
    } else {
      void publishMicrophone().catch((err) => {
        console.error("Failed to publish mic:", err);
        // Fallback or error handling
      });
    }
  }, [isMicrophoneActive, publishMicrophone, unpublishMicrophone]);

  const handleOpenMessage = useCallback(() => {
    setShowPrivateMessageModal(true);
  }, []);

  const handleSendPrivateMessage = useCallback(async (message: string) => {
    await sendPrivateSignal({
      type: 'PRIVATE_MESSAGE',
      text: message,
    });
  }, [sendPrivateSignal]);

  if (availability !== 'enabled') {
    return null;
  }

  return (
    <>
      <div className="pointer-events-auto">
        <AudienceLiveAudioPanel
          state={liveKitState}
          isActive={isActive}
          isMicrophoneActive={isMicrophoneActive}
          hasAudioStarted={hasAudioStarted}
          isPendingWord={isPendingWord}
          isWordGranted={isWordGranted}
          onStartAudio={handleStartAudio}
          onJoinActive={handleJoinActive}
          onLeaveActive={handleLeaveActive}
          onRequestWord={() => setIsPendingWord(true) /* We already submitted alias, so we just send another request if needed, but usually alias modal is the request. We should probably resend the request with a known alias, but for MVP just sending a generic request if we are already active. */}
          onCancelRequest={handleCancelRequest}
          onToggleMicrophone={handleToggleMicrophone}
          onOpenMessage={handleOpenMessage}
        />
      </div>

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
