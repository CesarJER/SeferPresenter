import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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

const AudioRenderer = ({ track, volume }: { track: MediaStreamTrack, volume: number }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audioRef.current && !audioRef.current.srcObject) {
      audioRef.current.srcObject = new MediaStream([track]);
    }
  }, [track]);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);
  return <audio ref={audioRef} autoPlay playsInline />;
};

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
      {remoteTracks.map(t => <AudioRenderer key={t.id} track={t} volume={volume} />)}

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
          volume={volume}
          onVolumeChange={setVolume}
          onStartAudio={handleStartAudio}
          onJoinActive={handleJoinActive}
          onLeaveActive={handleLeaveActive}
          onRequestWord={() => setIsPendingWord(true)}
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
            volume={volume}
            onVolumeChange={setVolume}
            onStartAudio={handleStartAudio}
            onJoinActive={handleJoinActive}
            onLeaveActive={handleLeaveActive}
            onRequestWord={() => setIsPendingWord(true)}
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
