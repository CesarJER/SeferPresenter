import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { isMicrophonePublicationCancelled, useLiveAudio } from '../../hooks/useLiveAudio';
import { useAudienceParticipation } from '../../../../hooks/useAudienceParticipation';
import { LiveAudioTrackOutput } from '../shared/LiveAudioTrackOutput';
import { useLiveAudioAvailability } from '../../hooks/useLiveAudioAvailability';
import {
  type AudienceLiveAudioContextValue,
} from './AudienceLiveAudioContext';

interface LiveAudioAudienceContainerProps {
  subscribeToWsMessage: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
  onMediaChange: (value: AudienceLiveAudioContextValue | null) => void;
}

export default function LiveAudioAudienceContainer({ subscribeToWsMessage, onMediaChange }: LiveAudioAudienceContainerProps) {
  useUiTranslation('liveAudio');
  const { availability } = useLiveAudioAvailability();
  const {
    participantId, privateSignals, canParticipate,
    isActive, isPendingWord, isWordGranted, setIsWordGranted, setIsPendingWord,
    externalBroadcastState, externalBroadcastRevision, microphoneConfig, setMediaStatus,
  } = useAudienceParticipation();
  const microphoneConsentRevisionRef = useRef(0);
  const isActivatingMicrophoneRef = useRef(false);

  const [volume, setVolume] = useState(1);
  const [microphoneVolume, setMicrophoneVolume] = useState(100);
  const [isMusicMode, setIsMusicMode] = useState(false);
  const isStartingAudioRef = useRef(false);
  const silenceAudioRef = useRef<HTMLAudioElement | null>(null);

  // 1. Connect to LiveKit as a passive listener
  const {
    state: liveKitState,
    connectionQuality,
    remoteTracks,
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
  }, [sessionRevision, setIsPendingWord, setIsWordGranted]);

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

  const handleMusicModeChange = useCallback((nextMusicMode: boolean) => {
    setIsMusicMode(nextMusicMode);
    if (nextMusicMode === isMusicMode || (!isMicrophoneActive && microphoneTrackState !== 'publishing')) return;
    void republishMicrophone({ musicMode: nextMusicMode })
      .catch((error) => {
        if (!isMicrophonePublicationCancelled(error)) console.warn('Microphone configuration failed');
      });
  }, [isMicrophoneActive, isMusicMode, microphoneTrackState, republishMicrophone]);

  const { sendPrivateSignal } = privateSignals;
  const appliedMicrophoneConfigRef = useRef<typeof microphoneConfig>(null);

  useEffect(() => {
    if (appliedMicrophoneConfigRef.current === microphoneConfig) return;
    appliedMicrophoneConfigRef.current = microphoneConfig;
    if (typeof microphoneConfig?.volume === 'number') setMicrophoneVolume(microphoneConfig.volume);
    if (typeof microphoneConfig?.musicMode === 'boolean') handleMusicModeChange(microphoneConfig.musicMode);
  }, [microphoneConfig, handleMusicModeChange]);

  useEffect(() => {
    setMediaStatus({ liveAudioConnectionState: liveKitState, isMicrophoneActive, microphoneTrackState });
  }, [isMicrophoneActive, liveKitState, microphoneTrackState, setMediaStatus]);

  useEffect(() => () => {
    setMediaStatus({ liveAudioConnectionState: 'unavailable', isMicrophoneActive: false, microphoneTrackState: 'off' });
    onMediaChange(null);
  }, [onMediaChange, setMediaStatus]);

  useEffect(() => {
    if (!isActive || !isWordGranted) void unpublishMicrophone();
  }, [isActive, isWordGranted, unpublishMicrophone]);

  useEffect(() => subscribeToWsMessage((type, payload) => {
    if (type === 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE') {
      const revision = typeof payload.revision === 'number' ? payload.revision : externalBroadcastRevision;
      if (payload.state === 'off') microphoneConsentRevisionRef.current = revision;
      else if (microphoneConsentRevisionRef.current !== revision) void unpublishMicrophone();
    } else if ((payload.participantId === participantId && [
      'LIVE_AUDIO_REVOKE_SPEAK', 'LIVE_AUDIO_MUTE_PARTICIPANT', 'LIVE_AUDIO_KICK_PARTICIPANT',
      'LIVE_AUDIO_RESCUE_PARTICIPANT', 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
    ].includes(type)) || (type === 'LIVE_AUDIO_MUTE_ALL' && isWordGranted &&
      !(Array.isArray(payload.excludeParticipantIds) && payload.excludeParticipantIds.includes(participantId)))) {
      void unpublishMicrophone();
    }
  }), [externalBroadcastRevision, isWordGranted, participantId, subscribeToWsMessage, unpublishMicrophone]);

  useEffect(() => {
    if (liveKitState !== 'reconnectFailed') return;
    if (!isActive && !isPendingWord && !isWordGranted) return;

    void sendPrivateSignal({
      type: 'AUDIO_FALLBACK',
      state: isWordGranted ? 'GRANTED' : isPendingWord ? 'REQUESTED' : 'ACTIVE',
      note: 'Audio no pudo reconectar; usar mensaje privado como respaldo.',
    });
  }, [isActive, isPendingWord, isWordGranted, liveKitState, sendPrivateSignal]);

  const handleStartAudio = useCallback(() => {
    if (availability !== 'enabled' || hasAudioStarted || isStartingAudioRef.current) return;
    isStartingAudioRef.current = true;
    void startRemoteAudio()
      .catch(() => undefined)
      .finally(() => {
        isStartingAudioRef.current = false;
      });
  }, [availability, hasAudioStarted, startRemoteAudio]);

  const handleToggleMicrophone = useCallback(() => {
    if (!canParticipate() || !isActive || !isWordGranted || !privateSignals.ready || (liveKitState !== 'connected' && liveKitState !== 'reconnected')) return;
    if (isActivatingMicrophoneRef.current) return;
    if (isMicrophoneActive) {
      void unpublishMicrophone();

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

      void publishMicrophone({ musicMode: isMusicMode })
        .catch((err) => {
          if (isMicrophonePublicationCancelled(err)) return;
          console.error("Failed to publish mic:", err);

        })
        .finally(() => { isActivatingMicrophoneRef.current = false; });
    }
  }, [canParticipate, externalBroadcastRevision, externalBroadcastState, isMicrophoneActive, publishMicrophone, isMusicMode, unpublishMicrophone, isActive, isWordGranted, privateSignals.ready, liveKitState]);

  const handleRetryAudio = useCallback(() => {
    void retryAudio();
  }, [retryAudio]);

  useEffect(() => {
    if (availability !== 'enabled') return;
    const start = () => { if (!hasAudioStarted) handleStartAudio(); };
    window.addEventListener('click', start, true);
    window.addEventListener('touchstart', start, true);
    return () => { window.removeEventListener('click', start, true); window.removeEventListener('touchstart', start, true); };
  }, [availability, handleStartAudio, hasAudioStarted]);

  const contextValue = useMemo<AudienceLiveAudioContextValue>(() => ({
    state: liveKitState, connectionQuality, isMicrophoneActive, microphoneTrackState, hasAudioStarted,
    volume, onVolumeChange: setVolume, microphoneVolume, isMusicMode,
    onMicrophoneVolumeChange: setMicrophoneVolume, onMusicModeChange: handleMusicModeChange,
    onStartAudio: handleStartAudio, onRetryAudio: handleRetryAudio, onToggleMicrophone: handleToggleMicrophone,
    availability, microphoneDiagnostics,
  }), [liveKitState, connectionQuality, isMicrophoneActive, microphoneTrackState, hasAudioStarted, volume,
    microphoneVolume, isMusicMode, handleMusicModeChange, handleStartAudio, handleRetryAudio,
    handleToggleMicrophone, availability, microphoneDiagnostics]);
  useEffect(() => { onMediaChange(contextValue); }, [contextValue, onMediaChange]);

  return <>
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

    </>;
}
