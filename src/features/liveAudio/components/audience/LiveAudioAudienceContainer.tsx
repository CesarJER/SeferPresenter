import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { AudienceInterventionModal } from './AudienceInterventionModal';
import { AudiencePrivateControlMessage } from './AudiencePrivateControlMessage';
import { useLiveAudio } from '../../hooks/useLiveAudio';
import { usePrivateControlSignals } from '../../../../hooks/usePrivateControlSignals';
import type {
  LiveAudioAvailability,
  MicrophonePermissionState,
  MicrophoneTrackState,
  SpeakerState,
} from '../../../../types/liveAudio';
import { LiveAudioTrackOutput } from '../shared/LiveAudioTrackOutput';
import type { useAudienceSession } from '../../../../hooks/useAudienceSession';
import {
  AudienceLiveAudioContext,
  type AudienceLiveAudioContextValue,
} from './AudienceLiveAudioContext';

export { AudienceLiveAudioContext, type AudienceLiveAudioContextValue };

interface LiveAudioAudienceContainerProps {
  availability: LiveAudioAvailability;
  wsSend: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
  clientId: string; // Used as fallback or session identifier if needed
  audienceSession: ReturnType<typeof useAudienceSession>;
  children?: ReactNode;
}

interface ParticipantStatusOptions {
  canPublishAudio?: boolean;
  isMuted?: boolean;
  isActiveAudience?: boolean;
  isMicrophoneActive?: boolean;
  isKicked?: boolean;
  microphonePermissionState?: MicrophonePermissionState;
  microphoneTrackState?: MicrophoneTrackState;
}

export default function LiveAudioAudienceContainer({
  availability,
  wsSend,
  subscribeToWsMessage,
  clientId,
  audienceSession,
  children
}: LiveAudioAudienceContainerProps) {
  const [isActive, setIsActive] = useState(false);
  const [isPendingWord, setIsPendingWord] = useState(false);
  const [isWordGranted, setIsWordGranted] = useState(false);
  const [isKicked, setIsKicked] = useState(false);
  const [activeAlias, setActiveAlias] = useState<string | null>(null);
  const [keyRotationCount, setKeyRotationCount] = useState(0);
  const [isAliasVisibleToOthers, setIsAliasVisibleToOthers] = useState(audienceSession.aliasVisible);
  const [canViewActiveParticipants, setCanViewActiveParticipants] = useState(false);
  const [visibleParticipants, setVisibleParticipants] = useState<string[]>([]);
  
  const [showInterventionModal, setShowInterventionModal] = useState(false);
  const [showPrivateMessageModal, setShowPrivateMessageModal] = useState(false);

  const [hasAudioStarted, setHasAudioStarted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [microphoneVolume, setMicrophoneVolume] = useState(100);
  const [isMusicMode, setIsMusicMode] = useState(false);
  const isStartingAudioRef = useRef(false);

  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useEffect(() => {
    setIsAliasVisibleToOthers(audienceSession.aliasVisible);
  }, [audienceSession.aliasVisible]);

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
    connectionQuality,
    remoteTracks,
    participantId,
    isMicrophoneActive,
    startRemoteAudio,
    publishMicrophone,
    unpublishMicrophone,
    retryAudio,
    microphoneDiagnostics,
  } = useLiveAudio({
    role: 'audience',
    autoConnect: availability === 'enabled',
    microphoneVolumePercent: microphoneVolume,
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
      microphonePermissionState: options.microphonePermissionState ?? 'unknown',
      microphoneTrackState: options.microphoneTrackState ?? (
        options.isMicrophoneActive
          ? 'publishing'
          : options.canPublishAudio && options.isMuted
            ? 'mutedByControl'
            : 'off'
      ),
      updatedAt: Date.now(),
    });
  }, [participantId, wsSend]);

  // 2. Setup private signals
  const { sendPrivateSignal, ready: privateSignalReady, getAudiencePublicKey } = usePrivateControlSignals({
    role: 'audience',
    participantId: participantId || clientId,
    sendMessage: wsSend,
    subscribeToWsMessage,
    transportReady: availability === 'enabled',
    onControlKeyRotated: () => setKeyRotationCount((current) => current + 1),
    onPrivateSignal: (signal) => {
      const payload = signal.value as Record<string, unknown>;
      if (payload.type === 'SET_MICROPHONE_CONFIG') {
        if (typeof payload.volume === 'number') {
          setMicrophoneVolume(payload.volume);
        }
        if (typeof payload.musicMode === 'boolean') {
          const nextMusicMode = payload.musicMode;
          setIsMusicMode(nextMusicMode);
        }
      } else if (payload.type === 'VISIBLE_ACTIVE_PARTICIPANTS' && Array.isArray(payload.participants)) {
        setVisibleParticipants(payload.participants.filter((participant): participant is string => typeof participant === 'string'));
      }
    }
  });

  const publishActiveProfile = useCallback(async (
    alias: string | null = activeAlias,
    isAliasVisible: boolean = isAliasVisibleToOthers,
  ) => {
    if (!participantId || !alias) return false;
    const activeListPublicKey = await getAudiencePublicKey();
    if (!activeListPublicKey) return false;

    return wsSend('LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', {
      type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
      participantId,
      alias,
      activeListPublicKey,
      isAliasVisibleToActiveParticipants: isAliasVisible,
      createdAt: Date.now(),
    });
  }, [activeAlias, getAudiencePublicKey, isAliasVisibleToOthers, participantId, wsSend]);

  // Listen for grant/revoke messages
  useEffect(() => {
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'LIVE_AUDIO_REQUEST_ALIASES') {
        if (participantId && activeAlias) {
          const speakerState = isWordGranted ? 'GRANTED' : (isPendingWord ? 'REQUESTED' : 'LISTENER');
          void publishActiveProfile(activeAlias, isAliasVisibleToOthers);
          sendParticipantStatus(
            speakerState,
            {
              canPublishAudio: isWordGranted,
              isMuted: !isMicrophoneActive,
              isActiveAudience: isActive,
              isMicrophoneActive: isMicrophoneActive,
              isKicked: isKicked
            }
          );
        }
      } else if (type === 'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION' && payload.participantId === participantId) {
        const canView = payload.canViewActiveParticipants === true;
        setCanViewActiveParticipants(canView);
        if (!canView) {
          setVisibleParticipants([]);
        }
      } else if (type === 'LIVE_AUDIO_GRANT_SPEAK' && payload.participantId === participantId) {
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
        setIsAliasVisibleToOthers(false);
        setCanViewActiveParticipants(false);
        setVisibleParticipants([]);
        audienceSession.logout();
        void unpublishMicrophone();
        sendParticipantStatus('REVOKED', {
          canPublishAudio: false,
          isMuted: true,
          isActiveAudience: false,
          isMicrophoneActive: false,
          isKicked: true,
        });
      } else if (type === 'LIVE_AUDIO_RESCUE_PARTICIPANT' && payload.participantId === participantId) {
        setIsActive(true);
        setIsPendingWord(false);
        setIsWordGranted(false);
        setIsKicked(false);
        void unpublishMicrophone();
        sendParticipantStatus('LISTENER', {
          canPublishAudio: false,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
          microphoneTrackState: 'off',
        });
      } else if (type === 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT' && payload.participantId === participantId) {
        setIsActive(false);
        setIsPendingWord(false);
        setIsWordGranted(false);
        setIsKicked(false);
        setActiveAlias(null);
        setIsAliasVisibleToOthers(false);
        setCanViewActiveParticipants(false);
        setVisibleParticipants([]);
        audienceSession.logout();
        void unpublishMicrophone();
      }
    });
    return unsubscribe;
  }, [
    isWordGranted, 
    participantId, 
    sendParticipantStatus, 
    subscribeToWsMessage, 
    unpublishMicrophone,
    activeAlias,
    publishActiveProfile,
    sendPrivateSignal,
    isActive,
    isPendingWord,
    isKicked,
    isAliasVisibleToOthers,
    isMicrophoneActive,
    audienceSession,
  ]);

  // Sync session state to active state
  useEffect(() => {
    if (audienceSession.isLoggedIn && audienceSession.nick && !isActive && !isKicked) {
      setIsActive(true);
      setActiveAlias(audienceSession.nick);
      sendParticipantStatus('LISTENER', {
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
        isKicked: false,
      });
      void publishActiveProfile(audienceSession.nick, audienceSession.aliasVisible);
    }
  }, [audienceSession.aliasVisible, audienceSession.isLoggedIn, audienceSession.nick, isActive, isKicked, publishActiveProfile, sendParticipantStatus]);

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
    if (!activeAlias) return;
    if (!isActive && !isPendingWord && !isWordGranted) return;

    void publishActiveProfile(activeAlias, isAliasVisibleToOthers);
    if (!privateSignalReady) return;
    if (isPendingWord || isWordGranted) {
      void sendPrivateSignal({
        type: isPendingWord ? 'REQUEST_WORD' : 'ACTIVE_STATE',
        alias: activeAlias,
        speakerState: isWordGranted ? 'GRANTED' : isPendingWord ? 'REQUESTED' : 'LISTENER',
      });
    }
  }, [activeAlias, isActive, isAliasVisibleToOthers, isPendingWord, isWordGranted, keyRotationCount, privateSignalReady, publishActiveProfile, sendPrivateSignal]);

  const handleStartAudio = useCallback(() => {
    if (hasAudioStarted || isStartingAudioRef.current) return;
    isStartingAudioRef.current = true;
    void startRemoteAudio()
      .then(() => setHasAudioStarted(true))
      .finally(() => {
        isStartingAudioRef.current = false;
      });
  }, [hasAudioStarted, startRemoteAudio]);

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
    setIsAliasVisibleToOthers(false);
    setCanViewActiveParticipants(false);
    setVisibleParticipants([]);
    audienceSession.logout();
    sendParticipantStatus('REVOKED', {
      canPublishAudio: false,
      isMuted: true,
      isActiveAudience: false,
      isMicrophoneActive: false,
      isKicked: false,
    });
    void unpublishMicrophone();
  }, [sendParticipantStatus, unpublishMicrophone, audienceSession]);

  const handleSubmitAlias = useCallback(async (alias: string, isAliasVisible: boolean) => {
    audienceSession.login(alias);
    audienceSession.setAliasVisible(isAliasVisible);
    setShowInterventionModal(false);
    setIsActive(true);
    setIsPendingWord(false);
    setIsWordGranted(false);
    setIsKicked(false);
    setActiveAlias(alias);
    setIsAliasVisibleToOthers(isAliasVisible);
    sendParticipantStatus('LISTENER', {
      canPublishAudio: false,
      isMuted: true,
      isActiveAudience: true,
      isMicrophoneActive: false,
      isKicked: false,
    });
    
    await publishActiveProfile(alias, isAliasVisible);
  }, [audienceSession, publishActiveProfile, sendParticipantStatus]);

  const handleAliasVisibilityChange = useCallback((checked: boolean) => {
    audienceSession.setAliasVisible(checked);
    setIsAliasVisibleToOthers(checked);
    if (isActive) {
      void publishActiveProfile(activeAlias, checked);
    }
  }, [activeAlias, audienceSession, isActive, publishActiveProfile]);

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
      void publishMicrophone({ musicMode: isMusicMode })
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
  }, [isMicrophoneActive, publishMicrophone, isMusicMode, sendParticipantStatus, unpublishMicrophone]);

  const handleRetryAudio = useCallback(() => {
    void retryAudio();
  }, [retryAudio]);

  const handleOpenMessage = useCallback(() => {
    setShowPrivateMessageModal(true);
  }, []);

  const handleSendPrivateMessage = useCallback(async (message: string) => {
    if (!privateSignalReady) return false;
    return sendPrivateSignal({
      type: 'PRIVATE_MESSAGE',
      text: message,
      alias: activeAlias ?? undefined,
    });
  }, [activeAlias, privateSignalReady, sendPrivateSignal]);

  const handleMusicModeChange = useCallback((nextMusicMode: boolean) => {
    setIsMusicMode(nextMusicMode);
    if (!isMicrophoneActive || nextMusicMode === isMusicMode) return;

    void unpublishMicrophone()
      .then(() => publishMicrophone({ musicMode: nextMusicMode }))
      .then(() => sendParticipantStatus('GRANTED', {
        canPublishAudio: true,
        isMuted: false,
        isActiveAudience: true,
        isMicrophoneActive: true,
      }))
      .catch((err) => {
        console.error('Failed to republish microphone with music mode:', err);
      });
  }, [isMicrophoneActive, isMusicMode, publishMicrophone, sendParticipantStatus, unpublishMicrophone]);

  if (availability !== 'enabled') {
    return <>{children}</>;
  }

  const contextValue: AudienceLiveAudioContextValue = {
    state: liveKitState,
    connectionQuality,
    isActive,
    isMicrophoneActive,
    hasAudioStarted,
    isPendingWord,
    isWordGranted,
    isParticipationBlocked: isKicked,
    volume,
    onVolumeChange: setVolume,
    microphoneVolume,
    isMusicMode,
    onMicrophoneVolumeChange: setMicrophoneVolume,
    onMusicModeChange: handleMusicModeChange,
    onStartAudio: handleStartAudio,
    onRetryAudio: handleRetryAudio,
    onJoinActive: handleJoinActive,
    onLeaveActive: handleLeaveActive,
    onRequestWord: handleRequestWord,
    onCancelRequest: handleCancelRequest,
    onToggleMicrophone: handleToggleMicrophone,
    onOpenMessage: handleOpenMessage,
    isAliasVisibleToOthers,
    onAliasVisibilityChange: handleAliasVisibilityChange,
    canViewActiveParticipants,
    visibleParticipants,
    availability,
    microphoneDiagnostics,
  };

  return (
    <AudienceLiveAudioContext.Provider value={contextValue}>
      {children}

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

      {showInterventionModal && (
        <AudienceInterventionModal
          onClose={() => setShowInterventionModal(false)}
          defaultAliasVisible={isAliasVisibleToOthers}
          onSubmit={handleSubmitAlias}
        />
      )}

      {showPrivateMessageModal && (
        <AudiencePrivateControlMessage
          onClose={() => setShowPrivateMessageModal(false)}
          onSend={handleSendPrivateMessage}
        />
      )}
    </AudienceLiveAudioContext.Provider>
  );
}
