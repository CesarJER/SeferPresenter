import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { AudienceInterventionModal } from './AudienceInterventionModal';
import { AudiencePrivateControlMessage } from './AudiencePrivateControlMessage';
import { isMicrophonePublicationCancelled, useLiveAudio } from '../../hooks/useLiveAudio';
import { usePrivateControlSignals } from '../../../../hooks/usePrivateControlSignals';
import type {
  LiveAudioAvailability,
  LiveAudioExternalBroadcastState,
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
  audienceSession,
  children
}: LiveAudioAudienceContainerProps) {
  useUiTranslation('liveAudio');
  const [isActive, setIsActive] = useState(false);
  const [isPendingWord, setIsPendingWord] = useState(false);
  const [isWordGranted, setIsWordGranted] = useState(false);
  const [isKicked, setIsKicked] = useState(false);
  const [keyRotationCount, setKeyRotationCount] = useState(0);
  const [canViewActiveParticipants, setCanViewActiveParticipants] = useState(false);
  const [visibleParticipants, setVisibleParticipants] = useState<string[]>([]);
  const [externalBroadcastState, setExternalBroadcastState] = useState<LiveAudioExternalBroadcastState>('off');
  const [externalBroadcastRevision, setExternalBroadcastRevision] = useState(0);
  const lastPrivateProfileSignatureRef = useRef('');
  const microphoneConsentRevisionRef = useRef(0);
  const isActivatingMicrophoneRef = useRef(false);

  const [showInterventionModal, setShowInterventionModal] = useState(false);
  const [showPrivateMessageModal, setShowPrivateMessageModal] = useState(false);
  const [receivedControlMessages, setReceivedControlMessages] = useState<
    Array<{ id: string; senderNick: string; text: string; timestamp: number }>
  >([]);

  const [volume, setVolume] = useState(1);
  const [microphoneVolume, setMicrophoneVolume] = useState(100);
  const [isMusicMode, setIsMusicMode] = useState(false);
  const isStartingAudioRef = useRef(false);
  const silenceAudioRef = useRef<HTMLAudioElement | null>(null);

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
    connectionQuality,
    remoteTracks,
    participantId,
    sessionRevision,
    isMicrophoneActive,
    microphoneTrackState,
    hasAudioStarted,
    startRemoteAudio,
    publishMicrophone,
    republishMicrophone,
    unpublishMicrophone,
    retryAudio,
    microphoneDiagnostics,
  } = useLiveAudio({
    role: 'audience',
    autoConnect: availability === 'enabled',
    microphoneVolumePercent: microphoneVolume,
  });

  useEffect(() => {
    if (!sessionRevision) return;
    // A fresh admission is a listener even when its stable participant ID is reused.
    setIsWordGranted(false);
    setIsPendingWord(false);
    microphoneConsentRevisionRef.current = -1;
  }, [sessionRevision]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const audioEl = silenceAudioRef.current;
      if (!audioEl) return;

      // Comprobar si hay alguna pista de multimedia normal reproduciéndose
      const isOtherMediaPlaying = () => {
        const mediaElements = document.querySelectorAll('audio, video');
        for (const el of Array.from(mediaElements)) {
          const media = el as HTMLMediaElement;
          if (media === audioEl) continue; // Ignorar nuestro silencio
          if (media.srcObject) continue; // Ignorar pistas de LiveKit/WebRTC

          if (!media.paused && media.currentTime > 0 && !media.ended && !media.muted) {
            return true;
          }
        }
        return false;
      };

      const hasActiveAudio = isOtherMediaPlaying();

      if (document.hidden && liveKitState === 'connected' && !hasActiveAudio) {
        audioEl.play().catch(e => console.warn("Silence loop play prevented:", e));
      } else {
        audioEl.pause();
      }
    };

    handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [liveKitState]);

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
      liveAudioConnectionState: liveKitState,
      isKicked: options.isKicked ?? false,
      microphonePermissionState: options.microphonePermissionState ?? 'unknown',
      microphoneTrackState: options.microphoneTrackState ?? (
        options.isMicrophoneActive
          ? 'published'
          : options.canPublishAudio && options.isMuted
            ? 'mutedByControl'
            : 'off'
      ),
      updatedAt: Date.now(),
    });
  }, [liveKitState, participantId, wsSend]);

  const handleMusicModeChange = useCallback((nextMusicMode: boolean) => {
    setIsMusicMode(nextMusicMode);
    if (nextMusicMode === isMusicMode || (!isMicrophoneActive && microphoneTrackState !== 'publishing')) return;
    void republishMicrophone({ musicMode: nextMusicMode })
      .catch((error) => {
        if (!isMicrophonePublicationCancelled(error)) console.warn('Microphone configuration failed');
      });
  }, [isMicrophoneActive, isMusicMode, microphoneTrackState, republishMicrophone]);

  // 2. Setup private signals
  const { sendPrivateSignal, ready: privateSignalReady, getAudiencePublicKey } = usePrivateControlSignals({
    role: 'audience',
    participantId: participantId ?? '',
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
          handleMusicModeChange(payload.musicMode);
        }
      } else if (payload.type === 'VISIBLE_ACTIVE_PARTICIPANTS' && Array.isArray(payload.participants)) {
        setVisibleParticipants(payload.participants.filter((participant): participant is string => typeof participant === 'string'));
      } else if (payload.type === 'CHAT_RESPONSE') {
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        const senderNick = typeof payload.senderNick === 'string' && payload.senderNick ? payload.senderNick : 'Control';
        const timestamp = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
        if (text) {
          setReceivedControlMessages(prev => [
            ...prev,
            { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, senderNick, text, timestamp }
          ]);
        }
      }
    }
  });

  const publishActiveProfile = useCallback(async (
    alias: string | null = audienceSession.nick || null,
    isAliasVisible: boolean = audienceSession.aliasVisible,
  ) => {
    if (!participantId || !alias) return false;
    const activeListPublicKey = await getAudiencePublicKey();
    if (!activeListPublicKey) return false;

    return wsSend('LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', {
      type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
      participantId,
      activeListPublicKey,
      isAliasVisibleToActiveParticipants: isAliasVisible,
      createdAt: Date.now(),
    });
  }, [audienceSession.aliasVisible, audienceSession.nick, getAudiencePublicKey, participantId, wsSend]);

  // Listen for grant/revoke messages
  useEffect(() => {
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE') {
        const state = payload.state;
        const revision = typeof payload.revision === 'number' && Number.isInteger(payload.revision)
          ? payload.revision
          : externalBroadcastRevision;
        if (state === 'off' || state === 'live' || state === 'recording') {
          setExternalBroadcastState(state);
          setExternalBroadcastRevision(revision);
          if (state === 'off') {
            microphoneConsentRevisionRef.current = revision;
          } else if (microphoneConsentRevisionRef.current !== revision && (isMicrophoneActive || microphoneTrackState === 'publishing')) {
            void unpublishMicrophone();
            sendParticipantStatus('GRANTED', {
              canPublishAudio: true,
              isMuted: true,
              isActiveAudience: true,
              isMicrophoneActive: false,
            });
          }
        }
      } else if (type === 'LIVE_AUDIO_REQUEST_ALIASES') {
        if (participantId && audienceSession.nick) {
          lastPrivateProfileSignatureRef.current = '';
          const speakerState = isWordGranted ? 'GRANTED' : (isPendingWord ? 'REQUESTED' : 'LISTENER');
          void publishActiveProfile(audienceSession.nick, audienceSession.aliasVisible);
          if (privateSignalReady) {
            void sendPrivateSignal({
              type: 'ACTIVE_PROFILE',
              alias: audienceSession.nick,
              isAliasVisibleToActiveParticipants: audienceSession.aliasVisible,
            });
          }
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
    publishActiveProfile,
    sendPrivateSignal,
    privateSignalReady,
    isActive,
    isPendingWord,
    isKicked,
    isMicrophoneActive,
    microphoneTrackState,
    handleMusicModeChange,
    audienceSession,
    externalBroadcastRevision,
  ]);

  // Sync session state to active state
  useEffect(() => {
    if (audienceSession.isLoggedIn && audienceSession.nick && !isActive && !isKicked) {
      setIsActive(true);
      sendParticipantStatus('LISTENER', {
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
        microphoneTrackState: 'off',
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
        microphoneTrackState,
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
  }, [isActive, isKicked, isMicrophoneActive, isPendingWord, isWordGranted, microphoneTrackState, participantId, sendParticipantStatus]);

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
    if (!audienceSession.nick) return;
    if (!isActive) return;

    void publishActiveProfile(audienceSession.nick, audienceSession.aliasVisible);
    if (!privateSignalReady) return;
    const signature = `${keyRotationCount}:${audienceSession.nick}:${audienceSession.aliasVisible}:${isPendingWord}:${isWordGranted}`;
    if (signature === lastPrivateProfileSignatureRef.current) return;
    lastPrivateProfileSignatureRef.current = signature;
    void sendPrivateSignal({
      type: isPendingWord ? 'REQUEST_WORD' : isWordGranted ? 'ACTIVE_STATE' : 'ACTIVE_PROFILE',
      alias: audienceSession.nick,
      isAliasVisibleToActiveParticipants: audienceSession.aliasVisible,
      speakerState: isWordGranted ? 'GRANTED' : isPendingWord ? 'REQUESTED' : 'LISTENER',
    });
  }, [audienceSession.aliasVisible, audienceSession.nick, isActive, isPendingWord, isWordGranted, keyRotationCount, privateSignalReady, publishActiveProfile, sendPrivateSignal]);

  const handleStartAudio = useCallback(() => {
    if (hasAudioStarted || isStartingAudioRef.current) return;
    isStartingAudioRef.current = true;
    void startRemoteAudio()
      .catch(() => undefined)
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
    setShowInterventionModal(false);
    setShowPrivateMessageModal(false);
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
    wsSend('AUDIENCE_ACCESS_LEAVE', { createdAt: Date.now() });
    void unpublishMicrophone();
  }, [sendParticipantStatus, unpublishMicrophone, audienceSession, wsSend]);

  const handleSubmitAlias = useCallback(async (alias: string, isAliasVisible: boolean) => {
    audienceSession.login(alias);
    audienceSession.setAliasVisible(isAliasVisible);
    setShowInterventionModal(false);
    setIsActive(true);
    setIsPendingWord(false);
    setIsWordGranted(false);
    setIsKicked(false);
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
    if (isActive) {
      void publishActiveProfile(audienceSession.nick, checked);
    }
  }, [audienceSession, isActive, publishActiveProfile]);

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
      alias: audienceSession.nick || undefined,
    });
  }, [audienceSession.nick, sendParticipantStatus, sendPrivateSignal]);

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
      alias: audienceSession.nick || undefined,
    });
  }, [audienceSession.nick, isKicked, sendParticipantStatus, sendPrivateSignal]);

  const handleToggleMicrophone = useCallback(() => {
    if (isActivatingMicrophoneRef.current) return;
    if (isMicrophoneActive) {
      void unpublishMicrophone();
      sendParticipantStatus('GRANTED', {
        canPublishAudio: true,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
        microphoneTrackState: 'off',
      });
    } else {
      if (
        externalBroadcastState !== 'off' &&
        microphoneConsentRevisionRef.current !== externalBroadcastRevision
      ) {
        const accepted = window.confirm(
          externalBroadcastState === 'recording'
            ? translate("liveAudio:LiveAudioAudienceContainer.theSessionIsLiveAndRecordingConfirmThatYouAuthorize", "La sesión está en directo y grabándose. Confirma que autorizas que tu voz se emita y quede grabada. Evita identificarte y comprueba que no haya voces de fondo; pueden generarse subtítulos automáticos.")
            : translate("liveAudio:LiveAudioAudienceContainer.theSessionIsLiveConfirmThatYouAuthorizePubliclyBroadcasting", "La sesión está en directo. Confirma que autorizas que tu voz se emita públicamente. Evita identificarte y comprueba que no haya voces de fondo."),
        );
        if (!accepted) return;
        microphoneConsentRevisionRef.current = externalBroadcastRevision;
      }
      isActivatingMicrophoneRef.current = true;
      sendParticipantStatus('GRANTED', {
        canPublishAudio: true,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
        microphoneTrackState: 'publishing',
      });
      void publishMicrophone({ musicMode: isMusicMode })
        .then(() => sendParticipantStatus('GRANTED', {
          canPublishAudio: true,
          isMuted: false,
          isActiveAudience: true,
          isMicrophoneActive: true,
          microphoneTrackState: 'published',
        }))
        .catch((err) => {
          if (isMicrophonePublicationCancelled(err)) return;
          console.error("Failed to publish mic:", err);
          sendParticipantStatus('GRANTED', {
            canPublishAudio: true,
            isMuted: true,
            isActiveAudience: true,
            isMicrophoneActive: false,
            microphoneTrackState: 'error',
          });
        })
        .finally(() => { isActivatingMicrophoneRef.current = false; });
    }
  }, [externalBroadcastRevision, externalBroadcastState, isMicrophoneActive, publishMicrophone, isMusicMode, sendParticipantStatus, unpublishMicrophone]);

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
      alias: audienceSession.nick || undefined,
    });
  }, [audienceSession.nick, privateSignalReady, sendPrivateSignal]);

  if (availability !== 'enabled') {
    return <>{children}</>;
  }

  const contextValue: AudienceLiveAudioContextValue = {
    state: liveKitState,
    connectionQuality,
    isActive,
    isMicrophoneActive,
    microphoneTrackState,
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
    isAliasVisibleToOthers: audienceSession.aliasVisible,
    onAliasVisibilityChange: handleAliasVisibilityChange,
    canViewActiveParticipants,
    visibleParticipants,
    availability,
    microphoneDiagnostics,
    externalBroadcastState,
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

      {/* Background silence loop to keep WebRTC alive on mobile browsers when no other media is active */}
      <audio
        ref={silenceAudioRef}
        src="/audio/sounds/silence.ogg"
        loop
        playsInline
      />

      {(isMicrophoneActive || microphoneTrackState === 'publishing' || microphoneTrackState === 'error') && (
        <div className={`fixed inset-0 z-40 pointer-events-none border-[6px] md:border-10 rounded-xl transition-all ${microphoneTrackState === 'publishing'
          ? 'border-orange-500/80 shadow-[inset_0_0_30px_rgba(249,115,22,0.6)]'
          : microphoneTrackState === 'error'
            ? 'border-red-500/80 shadow-[inset_0_0_30px_rgba(239,68,68,0.6)]'
            : 'border-blue-500/80 shadow-[inset_0_0_30px_rgba(59,130,246,0.6)]'
          }`}></div>
      )}

      {showInterventionModal && (
        <AudienceInterventionModal
          onClose={() => setShowInterventionModal(false)}
          defaultAliasVisible={audienceSession.aliasVisible}
          externalBroadcastState={externalBroadcastState}
          onSubmit={handleSubmitAlias}
        />
      )}

      {showPrivateMessageModal && (
        <AudiencePrivateControlMessage
          onClose={() => setShowPrivateMessageModal(false)}
          onSend={handleSendPrivateMessage}
        />
      )}

      {/* Control Responses floating overlay */}
      {receivedControlMessages.length > 0 && (
        <div className="fixed top-4 end-4 start-4 md:start-auto md:w-96 z-50 space-y-2 pointer-events-auto">
          {receivedControlMessages.map((msg) => (
            <div
              key={msg.id}
              className="rounded-xl border border-blue-600/50 bg-gray-900/95 p-3.5 shadow-2xl backdrop-blur-md text-white transition-all animate-in fade-in slide-in-from-top duration-200"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-300">
                  <MessageSquare className="h-4 w-4 text-blue-400 shrink-0" />
                  <span>{translate("liveAudio:LiveAudioAudienceContainer.messageFrom", "Mensaje de")} {msg.senderNick}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReceivedControlMessages((prev) => prev.filter((m) => m.id !== msg.id))}
                    className="text-gray-400 hover:text-white p-0.5 rounded-sm transition-colors"
                    title={translate("liveAudio:LiveAudioAudienceContainer.closeMessage", "Cerrar mensaje")}
                    aria-label={translate("liveAudio:LiveAudioAudienceContainer.closeMessage", "Cerrar mensaje")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-100 leading-relaxed ps-5">
                "{msg.text}"
              </p>
            </div>
          ))}
        </div>
      )}
    </AudienceLiveAudioContext.Provider>
  );
}
