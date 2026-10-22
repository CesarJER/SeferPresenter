import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { useLiveAudio } from '../../hooks/useLiveAudio';
import { useLiveAudioAvailability } from '../../hooks/useLiveAudioAvailability';
import { useAudioDevices } from '../../../../hooks/useAudioDevices';
import { LiveAudioTrackOutput } from '../shared/LiveAudioTrackOutput';
import type { ControlMediaState, ControlRtcModel } from './ControlMedia';
import type { LiveAudioParticipant } from './LiveAudioParticipantRow';
const VoiceScriptureControl = import.meta.env.VITE_SEFER_VOICE_SCRIPTURE_BUILD === 'true'
  ? lazy(() => import('../../../voiceScripture/VoiceScriptureControl')) : null;
const clampVolume = (volume: number) => Math.max(0, Math.min(volume, 300));

export default function LiveAudioControlContainer({ model, onMediaChange }: {
  model: ControlRtcModel; onMediaChange: (state: ControlMediaState | null) => void;
}) {
  useUiTranslation('liveAudio');
  const { isControlAuthorized, controlSessionId, controlState, operatorNick, externalBroadcastState,
    externalBroadcastRevision, participantsMap, participantAliases, participantMicrophoneConfigs,
    selectedVoiceParticipantId, onSharedVoiceSource: setSharedVoiceSource, remoteVoiceState,
    onLocalVoiceOptions: handleLocalVoiceOptions, scriptureState, voiceSuggestionsTarget, onProjectScripture } = model;
  const [isModeratorMuted, setIsModeratorMuted] = useState(true);
  const [listenVolume, setListenVolume] = useState(100);
  const [microphoneVolume, setMicrophoneVolume] = useState(100);
  const [isModeratorMusicMode, setIsModeratorMusicMode] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const moderatorConsentRevisionRef = useRef(0);
  const previouslyAvailableVoiceSourcesRef = useRef(new Set<string>());
  const { availability } = useLiveAudioAvailability();
  const { liveMicrophoneId, liveOutputId } = useAudioDevices();

  const {
    state,
    connectionQuality,
    publishMicrophone,
    republishMicrophone,
    unpublishMicrophone,
    isMicrophoneActive,
    participantId,
    remoteTracks,
    controlParticipants,
    localMicrophoneTrack,
    microphoneTrackState,
    startRemoteAudio,
  } = useLiveAudio({
    role: 'control',
    controlSessionId: controlSessionId || undefined,
    autoConnect: availability === 'enabled' && isControlAuthorized,
    microphoneVolumePercent: microphoneVolume,
    microphoneDeviceId: liveMicrophoneId,
  });

  useEffect(() => {
    setIsModeratorMuted(!isMicrophoneActive);
  }, [isMicrophoneActive]);

  useEffect(() => {
    if (externalBroadcastState === 'off') {
      moderatorConsentRevisionRef.current = externalBroadcastRevision;
      return;
    }
    if (moderatorConsentRevisionRef.current === externalBroadcastRevision) return;
    if (isMicrophoneActive) void unpublishMicrophone();
  }, [externalBroadcastRevision, externalBroadcastState, isMicrophoneActive, unpublishMicrophone]);

  const handleStartListening = useCallback(() => {
    void startRemoteAudio().catch((err) => {
      console.warn('LiveAudioControl: Failed to start remote audio:', err);
    });
  }, [startRemoteAudio]);

  const handleToggleModeratorMic = useCallback(async () => {
    if (isModeratorMuted) {
      if (
        externalBroadcastState !== 'off' &&
        moderatorConsentRevisionRef.current !== externalBroadcastRevision
      ) {
        const accepted = window.confirm(
          externalBroadcastState === 'recording'
            ? translate("liveAudio:LiveAudioControlContainer.theSessionIsDeclaredLiveAndRecordingConfirmThatYour", "La sesión está declarada en directo y grabándose. Confirma que tu voz puede emitirse y quedar grabada. Evita identificarte y comprueba que no haya voces de fondo; pueden generarse subtítulos automáticos.")
            : translate("liveAudio:LiveAudioControlContainer.theSessionIsDeclaredLiveConfirmThatYourVoiceMay", "La sesión está declarada en directo. Confirma que tu voz puede emitirse públicamente. Evita identificarte y comprueba que no haya voces de fondo."),
        );
        if (!accepted) return;
        moderatorConsentRevisionRef.current = externalBroadcastRevision;
      }
      await publishMicrophone({ musicMode: isModeratorMusicMode });
    } else {
      await unpublishMicrophone();
    }
  }, [externalBroadcastRevision, externalBroadcastState, isModeratorMuted, isModeratorMusicMode, publishMicrophone, unpublishMicrophone]);

  const handleModeratorMusicModeChange = useCallback((nextMusicMode: boolean) => {
    setIsModeratorMusicMode(nextMusicMode);
    if (!isMicrophoneActive || nextMusicMode === isModeratorMusicMode) return;

    void republishMicrophone({ musicMode: nextMusicMode })
      .catch((err) => {
        console.error('Failed to republish moderator microphone with music mode:', err);
      });
  }, [isMicrophoneActive, isModeratorMusicMode, republishMicrophone]);

  const applyConfig = useCallback((data: Record<string, unknown>) => {
    if (data.targetParticipantId !== participantId) return;
    if (typeof data.volume === 'number' && Number.isFinite(data.volume)) setMicrophoneVolume(clampVolume(data.volume));
    if (typeof data.musicMode === 'boolean') handleModeratorMusicModeChange(data.musicMode);
  }, [handleModeratorMusicModeChange, participantId]);
  const voiceTracks = [
    ...(participantId && localMicrophoneTrack && !isModeratorMuted ? [{ id: participantId, track: localMicrophoneTrack, label: operatorNick || translate("liveAudio:LiveAudioControlContainer.myMicrophone", "Mi micrófono") }] : []),
    ...remoteTracks.filter(remote => {
      const participant = participantsMap[remote.participantId || ''];
      const control = controlParticipants.find(p => p.participantId === remote.participantId);
      return control ? control.isMicrophoneActive : participant?.role === 'audience' && participant.isMuted !== true && participant.connected !== false;
    }).flatMap(remote => remote.participantId
      ? [{ id: remote.participantId, track: remote.track, label: participantAliases[remote.participantId] || 'Sin nick' }]
      : []),
  ];
  voiceTracks.forEach(({ id }) => previouslyAvailableVoiceSourcesRef.current.add(id));
  const selectedVoiceTrack = voiceTracks.find(track => track.id === selectedVoiceParticipantId)?.track;
  const selectedAudience = participantsMap[selectedVoiceParticipantId];
  const selectedControl = controlParticipants.find(control => control.participantId === selectedVoiceParticipantId);
  const selectedVoiceConnected = selectedVoiceParticipantId === participantId
    ? state === 'connected' || state === 'reconnected'
    : Boolean(selectedControl || (selectedAudience && selectedAudience.connected !== false));
  const selectedTrackState = selectedVoiceParticipantId === participantId
    ? microphoneTrackState
    : selectedAudience?.microphoneTrackState;
  const voiceSourceAvailability = !selectedVoiceParticipantId ? 'none'
    : selectedVoiceTrack?.readyState === 'live' ? 'available'
      : selectedVoiceConnected
        && (selectedTrackState === 'notRequested' || selectedTrackState === 'publishing'
          || (!selectedTrackState && !previouslyAvailableVoiceSourcesRef.current.has(selectedVoiceParticipantId)))
        ? 'waiting'
        : 'unavailable';
  const voiceSourceLabel = !selectedVoiceParticipantId ? ''
    : selectedVoiceParticipantId === participantId ? operatorNick.trim() || translate("liveAudio:LiveAudioControlContainer.myMicrophone", "Mi micrófono")
      : participantAliases[selectedVoiceParticipantId] || translate("liveAudio:LiveAudioControlContainer.selectedParticipant", "Participante seleccionado");
  const controllerIds = new Set([
    ...controlParticipants.map(p => p.participantId),
    ...Object.values(participantsMap).filter(p => p.role === 'control' && p.connected !== false).map(p => p.participantId),
  ]);
  if (participantId) controllerIds.delete(participantId);
  const controllers: LiveAudioParticipant[] = Array.from(controllerIds).map(id => {
    const reported = participantsMap[id];
    const remote = controlParticipants.find(p => p.participantId === id);
    const active = reported?.isMicrophoneActive ?? remote?.isMicrophoneActive ?? false;
    return { participantId: id, alias: participantAliases[id] || 'Sin nick',
      speakerState: 'GRANTED', isMuted: reported?.isMuted ?? !active, isMicrophoneActive: active,
      microphoneTrackState: reported?.microphoneTrackState ?? (active ? 'published' : 'off'),
      liveAudioConnectionState: reported?.liveAudioConnectionState,
      isActiveAudience: false, isKicked: false,
      microphoneVolume: participantMicrophoneConfigs[id]?.volume,
      isMusicMode: participantMicrophoneConfigs[id]?.musicMode };
  });
  if (participantId) controllers.unshift({ participantId, alias: operatorNick.trim() || 'Sin nick', speakerState: 'GRANTED',
    isMuted: isModeratorMuted, isMicrophoneActive, microphoneTrackState, isActiveAudience: false, isKicked: false,
    microphoneVolume, isMusicMode: isModeratorMusicMode });
  const voiceRuntime = VoiceScriptureControl && isControlAuthorized && availability === 'enabled' ? <Suspense fallback={null}>
    <VoiceScriptureControl tracks={voiceTracks} selectedId={selectedVoiceParticipantId} onSelectionChange={() => undefined}
      canTranscribe={controlState === 'PRINCIPAL'}
      onAvailabilityChange={setVoiceReady} suggestionsTarget={voiceSuggestionsTarget}
      scriptureState={scriptureState} onProject={onProjectScripture}
      remoteState={remoteVoiceState} onLocalState={handleLocalVoiceOptions} />
  </Suspense> : null;

  const controllersJson = JSON.stringify(controllers);
  const selectableJson = JSON.stringify(voiceReady ? voiceTracks.map(track => track.id) : []);
  const stableControllers = useMemo(() => JSON.parse(controllersJson) as LiveAudioParticipant[], [controllersJson]);
  const stableSelectable = useMemo(() => JSON.parse(selectableJson) as string[], [selectableJson]);
  const voiceTracksRef = useRef(voiceTracks);
  voiceTracksRef.current = voiceTracks;
  const onSelectVoice = useCallback((id: string) => {
    if (id === selectedVoiceParticipantId) { setSharedVoiceSource(null); return; }
    if (voiceReady && voiceTracksRef.current.some(track => track.id === id)) setSharedVoiceSource(id);
  }, [selectedVoiceParticipantId, setSharedVoiceSource, voiceReady]);
  const changeListenVolume = useCallback((volume: number) => setListenVolume(Math.max(0, Math.min(volume, 100))), []);
  const changeMicrophoneVolume = useCallback((volume: number) => setMicrophoneVolume(clampVolume(volume)), []);
  const actionsRef = useRef({ onSelectVoice, handleStartListening, handleToggleModeratorMic, handleModeratorMusicModeChange, applyConfig });
  actionsRef.current = { onSelectVoice, handleStartListening, handleToggleModeratorMic, handleModeratorMusicModeChange, applyConfig };
  const actions = useMemo(() => ({
    onSelectVoice: (id: string) => actionsRef.current.onSelectVoice(id),
    onStartListening: () => actionsRef.current.handleStartListening(),
    onToggleMicrophone: () => actionsRef.current.handleToggleModeratorMic(),
    onMusicModeChange: (enabled: boolean) => actionsRef.current.handleModeratorMusicModeChange(enabled),
    applyConfig: (data: Record<string, unknown>) => actionsRef.current.applyConfig(data),
  }), []);
  const port = useMemo<ControlMediaState>(() => ({ state, connectionQuality, participantId,
    isMicrophoneActive, microphoneTrackState, microphoneVolume, isMusicMode: isModeratorMusicMode, listenVolume,
    controllers: stableControllers, voiceSelectableIds: stableSelectable, voiceSourceLabel, voiceSourceAvailability,
    ...actions,
    onListenVolumeChange: changeListenVolume, onMicrophoneVolumeChange: changeMicrophoneVolume,
  }), [state, connectionQuality, participantId, isMicrophoneActive, microphoneTrackState, microphoneVolume,
    isModeratorMusicMode, listenVolume, stableControllers, stableSelectable, voiceSourceLabel, voiceSourceAvailability,
    actions, changeListenVolume, changeMicrophoneVolume]);
  useEffect(() => { onMediaChange(availability === 'enabled' ? port : null); }, [availability, onMediaChange, port]);
  useEffect(() => () => onMediaChange(null), [onMediaChange]);
  return <>
    {remoteTracks.map(remoteTrack => <LiveAudioTrackOutput key={remoteTrack.id} remoteTrack={remoteTrack} volumePercent={listenVolume} sinkId={liveOutputId} />)}
    {voiceRuntime}
  </>;
}
