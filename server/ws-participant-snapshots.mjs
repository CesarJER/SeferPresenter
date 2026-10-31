import { WebSocket } from 'ws'

const inferOperationalRole = (participant) => {
  if (participant.role === 'control') return 'control'
  if (participant.role === 'presenter') return 'presenter'
  if (participant.isKicked || participant.speakerState === 'REVOKED' || participant.isActiveAudience === false) return 'pasivo'
  if (participant.speakerState === 'REQUESTED') return 'cola'
  if (participant.speakerState === 'GRANTED' || participant.isMicrophoneActive) return 'orador'
  return 'activo'
}

const inferMicrophoneTrackState = (participant) => {
  if (participant.microphoneTrackState) return participant.microphoneTrackState
  if (participant.isKicked || participant.speakerState === 'REVOKED') return 'off'
  if (participant.isMicrophoneActive) return 'published'
  if (participant.speakerState === 'GRANTED' && participant.isMuted) return 'mutedByControl'
  if (participant.canPublishAudio) return 'off'
  return 'notRequested'
}

const makeOperationalParticipantSnapshot = (participant) => {
  const participantId = participant.participantId
  return {
    participantId,
    role: participant.role,
    operationalRole: inferOperationalRole(participant),
    microphonePermissionState: participant.microphonePermissionState || 'unknown',
    microphoneTrackState: participant.microphoneTrackState || inferMicrophoneTrackState(participant),
    liveAudioConnectionState: participant.liveAudioConnectionState,
    speakerState: participant.speakerState,
    canSubscribe: participant.canSubscribe,
    canPublishAudio: participant.canPublishAudio,
    isMuted: participant.isMuted,
    isActiveAudience: participant.isActiveAudience,
    isMicrophoneActive: participant.isMicrophoneActive,
    isKicked: participant.isKicked,
    isAliasVisibleToActiveParticipants: participant.isAliasVisibleToActiveParticipants ?? false,
    canViewActiveParticipants: participant.canViewActiveParticipants ?? false,
    isAliasHiddenByControl: participant.isAliasHiddenByControl ?? false,
    activeListPublicKey: participant.activeListPublicKey,
    connected: Boolean(participant.ws && participant.ws.readyState === WebSocket.OPEN),
    connectedAt: participant.connectedAt,
    disconnectedAt: participant.disconnectedAt,
    updatedAt: participant.updatedAt,
  }
}

const makeReducedParticipantStatus = (msg) => ({
  type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
  participantId: msg.participantId,
  role: msg.role,
  speakerState: msg.speakerState,
  canSubscribe: msg.canSubscribe,
  canPublishAudio: msg.canPublishAudio,
  isMuted: msg.isMuted,
  isActiveAudience: msg.isActiveAudience,
  isMicrophoneActive: msg.isMicrophoneActive,
  isKicked: msg.isKicked,
  isAliasVisibleToActiveParticipants: msg.isAliasVisibleToActiveParticipants ?? false,
  canViewActiveParticipants: msg.canViewActiveParticipants ?? false,
  isAliasHiddenByControl: msg.isAliasHiddenByControl ?? false,
  activeListPublicKey: msg.activeListPublicKey,
  microphonePermissionState: msg.microphonePermissionState,
  microphoneTrackState: msg.microphoneTrackState,
  liveAudioConnectionState: msg.liveAudioConnectionState,
  updatedAt: msg.updatedAt || Date.now(),
})

export {
  inferOperationalRole,
  inferMicrophoneTrackState,
  makeOperationalParticipantSnapshot,
  makeReducedParticipantStatus,
}
