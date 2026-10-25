const PRIVATE_CONTROL_SIGNAL_MAX_CIPHERTEXT_BYTES = 4096

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const speakerStates = new Set(['LISTENER', 'REQUESTED', 'GRANTED', 'MUTED', 'REVOKED'])
const microphonePermissionStates = new Set(['unknown', 'prompt', 'denied', 'granted', 'unavailable'])
const liveAudioConnectionStates = new Set(['connected', 'connecting', 'reconnecting', 'reconnected', 'reconnectFailed', 'disconnected', 'permissionDenied', 'unavailable'])
const microphoneTrackStates = new Set(['notRequested', 'off', 'publishing', 'published', 'mutedByUser', 'mutedByControl', 'error'])
const liveAudioModerationTypes = new Set([
  'LIVE_AUDIO_GRANT_SPEAK',
  'LIVE_AUDIO_REVOKE_SPEAK',
  'LIVE_AUDIO_MUTE_PARTICIPANT',
  'LIVE_AUDIO_MUTE_ALL',
  'LIVE_AUDIO_KICK_PARTICIPANT',
  'LIVE_AUDIO_RESCUE_PARTICIPANT',
])

const isValidParticipantId = (value) => typeof value === 'string' && uuidV4Pattern.test(value)

const isValidControlIssuerId = (value) => typeof value === 'string' && value.trim() !== ''

const isValidBase64 = (value) =>
  typeof value === 'string' && value.length > 0 && base64Pattern.test(value)

const getBase64ByteLength = (value) => {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor((value.length * 3) / 4) - padding
}

const validatePrivateControlSignal = (msg, senderRole = 'audience') => {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false
  if (msg.type !== 'PRIVATE_CONTROL_SIGNAL') return false
  if (senderRole === 'control') {
    if (typeof msg.fromParticipantId !== 'string' || msg.fromParticipantId.trim() === '') return false
  } else if (!isValidParticipantId(msg.fromParticipantId)) {
    return false
  }
  if (msg.toControlSessionId !== undefined && typeof msg.toControlSessionId !== 'string') return false
  if (msg.toParticipantId !== undefined && !isValidParticipantId(msg.toParticipantId)) return false
  if (senderRole === 'audience' && msg.toParticipantId !== undefined) return false
  if (senderRole === 'control' && msg.toParticipantId !== undefined && !isValidParticipantId(msg.toParticipantId)) return false
  if (typeof msg.keyId !== 'string' || msg.keyId.trim() === '') return false
  if (!isValidBase64(msg.ephemeralPublicKey)) return false
  if (!isValidBase64(msg.ciphertext)) return false
  if (getBase64ByteLength(msg.ciphertext) > PRIVATE_CONTROL_SIGNAL_MAX_CIPHERTEXT_BYTES) return false
  if (!isValidBase64(msg.nonce) || getBase64ByteLength(msg.nonce) !== 12) return false
  if (msg.createdAt !== undefined && (typeof msg.createdAt !== 'number' || !Number.isFinite(msg.createdAt))) return false
  return true
}

const validateParticipantStatus = (msg, expectedRole) => {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false
  if (msg.type !== 'LIVE_AUDIO_PARTICIPANT_STATUS') return false
  if (!isValidParticipantId(msg.participantId)) return false
  if (msg.role !== expectedRole) return false
  if (typeof msg.speakerState !== 'string' || !speakerStates.has(msg.speakerState)) return false
  if (typeof msg.canSubscribe !== 'boolean') return false
  if (typeof msg.canPublishAudio !== 'boolean') return false
  if (msg.isMuted !== undefined && typeof msg.isMuted !== 'boolean') return false
  if (msg.isActiveAudience !== undefined && typeof msg.isActiveAudience !== 'boolean') return false
  if (msg.isMicrophoneActive !== undefined && typeof msg.isMicrophoneActive !== 'boolean') return false
  if (msg.isKicked !== undefined && typeof msg.isKicked !== 'boolean') return false
  if (msg.microphonePermissionState !== undefined && !microphonePermissionStates.has(msg.microphonePermissionState)) return false
  if (msg.microphoneTrackState !== undefined && !microphoneTrackStates.has(msg.microphoneTrackState)) return false
  if (msg.liveAudioConnectionState !== undefined && !liveAudioConnectionStates.has(msg.liveAudioConnectionState)) return false
  if (msg.updatedAt !== undefined && (typeof msg.updatedAt !== 'number' || !Number.isFinite(msg.updatedAt))) return false
  return msg.alias === undefined
}

const validateActiveParticipantProfile = (msg) => {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false
  if (msg.type !== 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE') return false
  if (!isValidParticipantId(msg.participantId)) return false
  if (msg.alias !== undefined) return false
  if (!isValidBase64(msg.activeListPublicKey)) return false
  if (typeof msg.isAliasVisibleToActiveParticipants !== 'boolean') return false
  if (msg.createdAt !== undefined && (typeof msg.createdAt !== 'number' || !Number.isFinite(msg.createdAt))) return false
  return true
}

const validateModerationMessage = (msg) => {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false
  if (!liveAudioModerationTypes.has(msg.type)) return false
  if (msg.type !== 'LIVE_AUDIO_MUTE_ALL' && !isValidParticipantId(msg.participantId)) return false
  if (msg.excludeParticipantIds !== undefined) {
    if (msg.type !== 'LIVE_AUDIO_MUTE_ALL' || !Array.isArray(msg.excludeParticipantIds)) return false
    if (!msg.excludeParticipantIds.every(isValidParticipantId)) return false
  }
  if (msg.issuedByParticipantId !== undefined && !isValidControlIssuerId(msg.issuedByParticipantId)) return false
  if (msg.createdAt !== undefined && (typeof msg.createdAt !== 'number' || !Number.isFinite(msg.createdAt))) return false
  return true
}

export {
  isValidParticipantId,
  isValidBase64,
  getBase64ByteLength,
  validatePrivateControlSignal,
  validateParticipantStatus,
  validateActiveParticipantProfile,
  validateModerationMessage,
  microphonePermissionStates,
  microphoneTrackStates,
  liveAudioConnectionStates,
}
