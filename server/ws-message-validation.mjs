import { validatePresentationsPayload } from './content-validation.mjs'
import { validateProjectionCommandPayload } from './projection-state-reducer.mjs'

const WS_ORDINARY_PAYLOAD_BYTES = 64 * 1024

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

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isNullableString = (value) => value === null || typeof value === 'string'
const optional = (value, validate) => value === undefined || validate(value)
const isNonNegative = (value) => Number.isFinite(value) && value >= 0
const hasSafeNesting = (value) => {
  const pending = [[value, 0]]
  while (pending.length) {
    const [current, depth] = pending.pop()
    if (!current || typeof current !== 'object') continue
    // Keep later recursive JSON serialization and projection cloning within their stack limits.
    if (depth > 128) return false
    for (const child of Object.values(current)) {
      if (child && typeof child === 'object') pending.push([child, depth + 1])
    }
  }
  return true
}
const isVideoState = (video) => video === null || (isRecord(video) &&
  typeof video.isPlaying === 'boolean' && Number.isFinite(video.currentTime) && Number.isFinite(video.duration) &&
  Number.isFinite(video.volume) && video.volume >= 0 && video.volume <= 1 && Number.isFinite(video.speed) &&
  optional(video.mediaSrc, isNullableString) && optional(video.videoSrc, isNullableString) &&
  ['controller', 'projection'].includes(video.lastUpdatedBy) && Number.isFinite(video.timestamp) &&
  optional(video.loop, (value) => typeof value === 'boolean') &&
  ['startTime', 'endTime', 'seekId'].every((field) => optional(video[field], Number.isFinite)))
const isScriptureState = (state) => state === null || (isRecord(state) &&
  ['bookEs', 'bookHeb', 'bookAbbrevEs', 'chapter', 'verseStart', 'verse', 'verseNikud', 'transliteration', 'translation']
    .every((field) => typeof state[field] === 'string') &&
  Number.isFinite(state.verseIdx) && Number.isFinite(state.totalVerses) &&
  optional(state.verseEnd, (value) => typeof value === 'string') &&
  optional(state.scriptureKind, (value) => ['tanaj', 'sefer'].includes(value)) &&
  optional(state.command, (value) => ['navigate', 'next', 'previous'].includes(value)) &&
  ['commandId', 'hebrewFontSize', 'combinedTextBaseSize'].every((field) => optional(state[field], Number.isFinite)))
const isQuizState = (quiz) => quiz === null || (isRecord(quiz) &&
  optional(quiz.presentationId, (value) => typeof value === 'string') &&
  Number.isInteger(quiz.currentSubslideIndex) && quiz.currentSubslideIndex >= 0 && isRecord(quiz.timerState) &&
  ['idle', 'running', 'paused', 'expired', 'completed'].includes(quiz.timerState.status) &&
  (quiz.timerState.timerStartedAt === null || isNonNegative(quiz.timerState.timerStartedAt)) &&
  isNonNegative(quiz.timerState.timerDurationMs) &&
  (quiz.timerState.pausedRemainingMs === null || isNonNegative(quiz.timerState.pausedRemainingMs)) &&
  isRecord(quiz.presenterDemoSelection) && Object.entries(quiz.presenterDemoSelection).every(([id, value]) =>
    id.trim() !== '' && (value === null || ['A', 'B', 'C', 'D'].includes(value))) &&
  optional(quiz.maxBaseCentipunts, isNonNegative) &&
  optional(quiz.scoreRequestId, (value) => Number.isInteger(value) && value >= 0) &&
  ['completedQuizSlideIds', 'resultQuizSlideIds'].every((field) => optional(quiz[field], (value) =>
    Array.isArray(value) && value.every((id) => typeof id === 'string'))) &&
  optional(quiz.feedbackSound, (sound) => sound === null || (isRecord(sound) &&
    ['applause', 'mal', 'bip'].includes(sound.type) && isNonNegative(sound.timestamp))))
const isAudioState = (audio) => isRecord(audio) && typeof audio.isPlaying === 'boolean' &&
  Number.isFinite(audio.currentTime) && Number.isFinite(audio.duration) && Number.isFinite(audio.volume) &&
  audio.volume >= 0 && audio.volume <= 1 && isNullableString(audio.audioSrc) && isNullableString(audio.activeSyncMapId) &&
  ['none', 'unilateral', 'bilateral'].includes(audio.syncMode) &&
  ['controller', 'projection'].includes(audio.lastUpdatedBy) && Number.isFinite(audio.timestamp) &&
  (audio.changeType === undefined || ['track', 'volume', 'playState', 'seek', 'syncMode'].includes(audio.changeType))

const validateLargePresentationMessage = (msg, role, bytes) => {
  if (!isRecord(msg) || typeof msg.clientId !== 'string') return false
  if (!optional(msg.protocolVersion, (value) => value === 1) || !optional(msg.timestamp, Number.isFinite) ||
      !optional(msg.messageId, (value) => typeof value === 'string')) return false
  let presentation
  if (role === 'control' && msg.type === 'REMOTE_COMMAND' &&
      msg.payload?.command === 'SELECT_PRESENTATION_AND_SLIDE' && validateProjectionCommandPayload(msg.payload).ok) {
    presentation = msg.payload.presentation
  } else if ((role === 'control' || role === 'presenter') && msg.type === 'SYNC_STATE' &&
      (msg.origin === 'control' || msg.origin === 'presenter') &&
      Number.isFinite(msg.slideIndex) && typeof msg.backgroundLock === 'boolean' &&
      isNullableString(msg.lockedBackgroundValue) && isNullableString(msg.userSelectedBackground) &&
      isVideoState(msg.videoState) && ['slides', 'scripture', 'seferManual'].includes(msg.appMode) &&
      isScriptureState(msg.scriptureState) && isAudioState(msg.audioState) && optional(msg.quizState, isQuizState) &&
      optional(msg.stepIndex, Number.isFinite) && optional(msg.autoduckState, (state) => isRecord(state) &&
        typeof state.enabled === 'boolean' && Number.isFinite(state.factor) && state.factor >= 0 && state.factor <= 1)) {
    presentation = msg.presentation
  } else return false
  if (!isRecord(presentation) || !hasSafeNesting(msg) || !validatePresentationsPayload([presentation]).ok) return false
  // Large messages must derive their size from the presentation, not unrelated metadata.
  return bytes - Buffer.byteLength(JSON.stringify(presentation)) <= WS_ORDINARY_PAYLOAD_BYTES
}

export {
  validateLargePresentationMessage,
  WS_ORDINARY_PAYLOAD_BYTES,
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
  isAudioState,
  isVideoState,
  hasSafeNesting,
}
