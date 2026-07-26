import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { applyAction, getTimeline } from './timelineManager.mjs'
import { hasAllowedRequestOrigin, isAuthRequired, hasValidBasicAuth } from './authUtils.mjs'

const wsClients = new Map()
const roles = new Set(['presenter', 'control', 'audience', 'unknown'])
const liveAudioControls = new Map()
const liveAudioParticipants = new Map()
const audienceAccessRecords = new Map()
const audienceCredentialIndex = new Map()
const audienceSseTickets = new Map()
let presentationSessionId = randomUUID()
let serverEpoch = randomUUID()
let stateRevision = 0
let recordingAvailable = false
let recordingMutable = false
let recordingState = 'NOT_RECORDING'
let recordingEpoch = 0
let recordingPolicyTransitionInProgress = false
let liveAudioControlPublicKeyMessage = null
let privateControlOverlayEnvelope = null
const PRIVATE_CONTROL_SIGNAL_MAX_CIPHERTEXT_BYTES = 4096
const PRIVATE_CONTROL_OVERLAY_MAX_CIPHERTEXT_BYTES = 256 * 1024
const PRIVATE_CONTROL_SIGNAL_RATE_LIMIT = 5
const PRIVATE_CONTROL_TECHNICAL_SIGNAL_RATE_LIMIT = 60
const PRIVATE_CONTROL_SIGNAL_RATE_WINDOW_MS = 60_000
const WS_MAX_PAYLOAD_BYTES = 64 * 1024
const WS_MAX_BUFFERED_BYTES = 512 * 1024
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const speakerStates = new Set(['LISTENER', 'REQUESTED', 'GRANTED', 'MUTED', 'REVOKED'])
const microphonePermissionStates = new Set(['unknown', 'prompt', 'denied', 'granted', 'unavailable'])
const microphoneTrackStates = new Set(['notRequested', 'off', 'publishing', 'mutedByUser', 'mutedByControl', 'error'])
const audienceAccessStates = new Set(['REQUEST_REQUIRED', 'WAITING', 'ADMITTED', 'REJECTED', 'BLOCKED'])
const liveAudioModerationTypes = new Set([
  'LIVE_AUDIO_GRANT_SPEAK',
  'LIVE_AUDIO_REVOKE_SPEAK',
  'LIVE_AUDIO_MUTE_PARTICIPANT',
  'LIVE_AUDIO_MUTE_ALL',
  'LIVE_AUDIO_KICK_PARTICIPANT',
  'LIVE_AUDIO_RESCUE_PARTICIPANT',
])
const audienceAllowedTypes = new Set([
  'SERVER_TIME_PING',
  'AUDIENCE_ACCESS_BIND',
  'AUDIENCE_ACCESS_REQUEST',
  'LIVE_AUDIO_PARTICIPANT_STATUS',
  'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
  'PRIVATE_CONTROL_SIGNAL',
  'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
  'AUDIENCE_RECORDING_CONFIRMATION',
])
const recordingTransitionSafeTypes = new Set([
  'SERVER_TIME_PING',
  'LIVE_AUDIO_SNAPSHOT_REQUEST',
])
const admittedAudienceOnlyTypes = new Set([
  'LIVE_AUDIO_PARTICIPANT_STATUS',
  'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
  'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
  'AUDIENCE_RECORDING_CONFIRMATION',
])

const makeRevisionEnvelope = (revision = stateRevision) => ({
  presentationSessionId,
  serverEpoch,
  stateRevision: revision,
  eventId: randomUUID(),
})

const commitStateMutation = () => {
  stateRevision += 1
  return makeRevisionEnvelope(stateRevision)
}

const makeRole = (value) => roles.has(value) ? value : 'unknown'

const getControlCodeTtlMs = () => {
  const raw = Number.parseInt(process.env.SEFER_LIVE_AUDIO_CONTROL_CODE_TTL_SECONDS || '90', 10)
  const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120) : 90
  return seconds * 1000
}

const getControlRejoinGraceMs = () => {
  const raw = Number.parseInt(process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS || '30', 10)
  const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 300) : 30
  return seconds * 1000
}

const getDefaultAccessMode = () =>
  String(process.env.SEFER_SESSION_ACCESS_DEFAULT || 'PUBLIC').toUpperCase() === 'CONTROLLED'
    ? 'CONTROLLED'
    : 'PUBLIC'

let accessMode = getDefaultAccessMode()

const configureRecordingPolicy = (policy = {}) => {
  recordingAvailable = policy.recordingAvailable === true
  recordingMutable = policy.recordingMutable === true
  recordingState = recordingAvailable && policy.recordingDefault === 'RECORDING'
    ? 'RECORDING'
    : 'NOT_RECORDING'
  recordingEpoch = recordingState === 'RECORDING' ? 1 : 0
}

const getRecordingPolicy = () => ({
  recordingAvailable,
  recordingMutable,
  recordingState,
  recordingEpoch,
})

const hasCurrentRecordingConfirmation = (participantId) => {
  if (recordingState !== 'RECORDING') return true
  const record = audienceAccessRecords.get(participantId)
  return Boolean(
    record?.accessState === 'ADMITTED' &&
    record.recordingConfirmation?.presentationSessionId === presentationSessionId &&
    record.recordingConfirmation?.recordingEpoch === recordingEpoch
  )
}

const getAudienceResumeTtlMs = () => {
  const raw = Number.parseInt(process.env.SEFER_AUDIENCE_RESUME_TTL_HOURS || '24', 10)
  const hours = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 168) : 24
  return hours * 60 * 60 * 1000
}

const createAudienceCredential = () => randomBytes(32).toString('base64url')
const hashAudienceCredential = (credential) =>
  createHash('sha256').update(credential, 'utf8').digest()

const audienceCredentialKey = (hash) => hash.toString('hex')

const deleteAudienceAccessRecord = (participantId) => {
  const record = audienceAccessRecords.get(participantId)
  if (!record) return false
  audienceAccessRecords.delete(participantId)
  audienceCredentialIndex.delete(audienceCredentialKey(record.credentialHash))
  return true
}

const clearAudienceAccessRecords = () => {
  audienceAccessRecords.clear()
  audienceCredentialIndex.clear()
}

const getAudienceAccessCapacity = () => {
  const raw = Number.parseInt(process.env.SEFER_AUDIENCE_ACCESS_CAPACITY || '500', 10)
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 5_000) : 500
}

const findAudienceAccessByCredential = (credential) => {
  if (typeof credential !== 'string' || credential.length < 32) return null
  const candidate = hashAudienceCredential(credential)
  const participantId = audienceCredentialIndex.get(audienceCredentialKey(candidate))
  const record = participantId ? audienceAccessRecords.get(participantId) : null
  if (!record) return null
  if (
    record.credentialHash.length !== candidate.length ||
    !timingSafeEqual(record.credentialHash, candidate)
  ) return null
  if (record.expiresAt <= Date.now()) {
    deleteAudienceAccessRecord(record.participantId)
    return null
  }
  return record
}

const makeAudienceAccessState = (record) => ({
  presentationSessionId,
  accessMode,
  participantId: record.participantId,
  accessState: record.accessState,
  retryAt: record.retryAt,
  expiresAt: record.expiresAt,
  recordingConfirmedEpoch: record.recordingConfirmation?.presentationSessionId === presentationSessionId
    ? record.recordingConfirmation.recordingEpoch
    : undefined,
  stateRevision,
})

const bootstrapAudienceAccess = (credential) => {
  const existing = findAudienceAccessByCredential(credential)
  if (existing) return { ...makeAudienceAccessState(existing), credential: undefined }
  if (audienceAccessRecords.size >= getAudienceAccessCapacity()) {
    const error = new Error('Audience access capacity reached')
    error.code = 'AUDIENCE_CAPACITY_REACHED'
    throw error
  }
  const nextCredential = createAudienceCredential()
  const participantId = randomUUID()
  const record = {
    participantId,
    credentialHash: hashAudienceCredential(nextCredential),
    accessState: accessMode === 'PUBLIC' ? 'ADMITTED' : 'REQUEST_REQUIRED',
    hasAlias: false,
    retryAt: undefined,
    createdAt: Date.now(),
    expiresAt: Date.now() + getAudienceResumeTtlMs(),
  }
  audienceAccessRecords.set(participantId, record)
  audienceCredentialIndex.set(audienceCredentialKey(record.credentialHash), participantId)
  return { ...makeAudienceAccessState(record), credential: nextCredential }
}

const authorizeAudienceCredential = (credential, { requireAdmitted = true } = {}) => {
  const record = findAudienceAccessByCredential(credential)
  if (!record) return null
  if (requireAdmitted && accessMode === 'CONTROLLED' && record.accessState !== 'ADMITTED') return null
  return record
}

const logoutAudienceCredential = (credential) => {
  const record = findAudienceAccessByCredential(credential)
  if (!record) return false
  deleteAudienceAccessRecord(record.participantId)
  return true
}

const issueAudienceSseTicket = (credential, purpose = 'STATE') => {
  const record = authorizeAudienceCredential(credential)
  if (!record) return null
  const ticket = randomBytes(24).toString('base64url')
  audienceSseTickets.set(ticket, {
    participantId: record.participantId,
    purpose,
    expiresAt: Date.now() + 30_000,
  })
  return ticket
}

const consumeAudienceSseTicket = (ticket, purpose = 'STATE') => {
  if (typeof ticket !== 'string') return null
  const record = audienceSseTickets.get(ticket)
  audienceSseTickets.delete(ticket)
  if (!record || record.purpose !== purpose || record.expiresAt <= Date.now()) return null
  const access = audienceAccessRecords.get(record.participantId)
  if (!access || (accessMode === 'CONTROLLED' && access.accessState !== 'ADMITTED')) return null
  return access
}

const getSessionAccessMode = () => accessMode
const getPresentationSessionId = () => presentationSessionId
const getServerEpoch = () => serverEpoch
const isAudienceParticipantAdmitted = (participantId) => {
  const record = audienceAccessRecords.get(participantId)
  return accessMode === 'PUBLIC' || record?.accessState === 'ADMITTED'
}

const canReceiveAudienceSessionContent = (meta) => {
  if (meta?.role !== 'audience') return true
  const record = meta.audienceAccessId
    ? audienceAccessRecords.get(meta.audienceAccessId)
    : null
  return Boolean(record && record.accessState === 'ADMITTED')
}

const createResumeCredential = () => randomBytes(32).toString('base64url')
const hashResumeCredential = (credential) =>
  createHash('sha256').update(credential, 'utf8').digest()

const resumeCredentialMatches = (control, credential) => {
  if (!control?.resumeCredentialHash || typeof credential !== 'string' || credential.length < 32) {
    return false
  }
  const candidateHash = hashResumeCredential(credential)
  return candidateHash.length === control.resumeCredentialHash.length &&
    timingSafeEqual(candidateHash, control.resumeCredentialHash)
}

const allowDelegatedModerators = () =>
  String(process.env.SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS || 'true').toLowerCase() !== 'false'

const getDefaultModerationVisible = () =>
  String(process.env.SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE || 'true').toLowerCase() !== 'false'

const mergeOperationalSnapshotPatch = (patch) => {
  if (!patch || typeof patch !== 'object') return false
  let changed = false

  if (Array.isArray(patch.participants)) {
    for (const participant of patch.participants) {
      if (!participant || typeof participant !== 'object' || !isValidParticipantId(participant.participantId)) continue
      const storedParticipant = liveAudioParticipants.get(participant.participantId)
      if (!storedParticipant) continue
      if (microphonePermissionStates.has(participant.microphonePermissionState)) {
        storedParticipant.microphonePermissionState = participant.microphonePermissionState
        changed = true
      }
      if (microphoneTrackStates.has(participant.microphoneTrackState)) {
        storedParticipant.microphoneTrackState = participant.microphoneTrackState
        changed = true
      }
      if (typeof participant.isAliasVisibleToActiveParticipants === 'boolean') {
        storedParticipant.isAliasVisibleToActiveParticipants = participant.isAliasVisibleToActiveParticipants
        changed = true
        if (storedParticipant.isAliasHiddenByControl === undefined) {
          storedParticipant.isAliasHiddenByControl = !getDefaultModerationVisible()
        }
      }
      storedParticipant.updatedAt = Date.now()
    }
  }
  return changed
}

const containsClearAliasData = (patch) => (
  Array.isArray(patch?.participants) &&
  patch.participants.some((participant) => (
    participant &&
    typeof participant === 'object' &&
    (participant.alias !== undefined || participant.activeListPublicKey !== undefined)
  ))
)

const getRejoinGraceMs = () => {
  const raw = Number.parseInt(process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS || '60', 10)
  const seconds = Number.isFinite(raw) && raw >= 0 ? raw : 60
  return seconds * 1000
}

const generateVerificationCode = () => {
  const number = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')
  return `${number.slice(0, 3)}-${number.slice(3)}`
}

const isValidParticipantId = (value) => typeof value === 'string' && uuidV4Pattern.test(value)

const isValidBase64 = (value) =>
  typeof value === 'string' && value.length > 0 && base64Pattern.test(value)

const getBase64ByteLength = (value) => {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor((value.length * 3) / 4) - padding
}

const isControlAuthorized = (control) =>
  (control?.controlState === 'PRINCIPAL' || control?.controlState === 'AUTHORIZED') &&
  control?.syncRequired !== true

const findPrincipalControl = () =>
  Array.from(liveAudioControls.values()).find((control) => control.controlState === 'PRINCIPAL') || null

const getPendingControls = () => {
  const now = Date.now()
  return Array.from(liveAudioControls.values())
    .filter((control) => (
      (control.controlState === 'PENDING' || control.controlState === 'AUTHORIZED_SYNCING') &&
      control.codeExpiresAt > now
    ))
    .map((control) => ({
      controlSessionId: control.controlSessionId,
      verificationCode: control.verificationCode,
      codeExpiresAt: control.codeExpiresAt,
      connectedAt: control.connectedAt,
      recipientPublicKey: control.recipientPublicKey,
      joinRequestId: control.joinRequestId,
    }))
}

const canAuthorizeControls = (control) => {
  if (!control || control.syncRequired === true) return false
  if (control.controlState === 'PRINCIPAL') return true
  return allowDelegatedModerators() && control.controlState === 'AUTHORIZED'
}

const getLiveAudioControlState = (controlSessionId) => {
  const control = liveAudioControls.get(controlSessionId)
  if (!control) return null
  return {
    controlSessionId: control.controlSessionId,
    clientId: control.clientId,
    controlState: control.controlState,
    connectedAt: control.connectedAt,
    authorizedAt: control.authorizedAt,
  }
}

const isLiveAudioControlAuthorized = (controlSessionId) =>
  isControlAuthorized(liveAudioControls.get(controlSessionId))

const getLiveAudioControlSnapshot = () => ({
  principalControlSessionId: findPrincipalControl()?.controlSessionId || null,
  controls: Array.from(liveAudioControls.values()).map((control) => ({
    controlSessionId: control.controlSessionId,
    clientId: control.clientId,
    controlState: control.controlState,
    connectedAt: control.connectedAt,
    authorizedAt: control.authorizedAt,
    codeExpiresAt: (
      control.controlState === 'PENDING' || control.controlState === 'AUTHORIZED_SYNCING'
    ) ? control.codeExpiresAt : undefined,
  })),
})

const getLiveAudioParticipantSnapshot = () => ({
  participants: Array.from(liveAudioParticipants.values()).map((participant) => ({
    participantId: participant.participantId,
    role: participant.role,
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
    recordingConfirmationEpoch: participant.recordingConfirmationSessionId === presentationSessionId
      ? participant.recordingConfirmationEpoch
      : undefined,
    connected: Boolean(participant.ws && participant.ws.readyState === WebSocket.OPEN),
    disconnectedAt: participant.disconnectedAt,
    updatedAt: participant.updatedAt,
  })),
})

const getConnectionCountsSnapshot = () => {
  const counts = {
    audienceConnections: 0,
    controlConnections: 0,
    presenterConnections: 0,
  }

  for (const [client, meta] of wsClients) {
    if (client.readyState !== WebSocket.OPEN) continue
    if (meta.role === 'audience') counts.audienceConnections += 1
    if (meta.role === 'control') counts.controlConnections += 1
    if (meta.role === 'presenter') counts.presenterConnections += 1
  }

  return {
    totalConnections: counts.audienceConnections + counts.controlConnections + counts.presenterConnections,
    ...counts,
    updatedAt: Date.now(),
  }
}

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
  if (participant.isMicrophoneActive) return 'publishing'
  if (participant.speakerState === 'GRANTED' && participant.isMuted) return 'mutedByControl'
  if (participant.canPublishAudio) return 'off'
  return 'notRequested'
}

const makeOperationalParticipantSnapshot = (participant) => {
  return {
    participantId: participant.participantId,
    role: participant.role,
    operationalRole: inferOperationalRole(participant),
    microphonePermissionState: participant.microphonePermissionState || 'unknown',
    microphoneTrackState: participant.microphoneTrackState || inferMicrophoneTrackState(participant),
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
    connected: Boolean(participant.ws && participant.ws.readyState === WebSocket.OPEN),
    connectedAt: participant.connectedAt,
    disconnectedAt: participant.disconnectedAt,
    updatedAt: participant.updatedAt,
  }
}

const makeOperationalSnapshot = ({ liveKitState, quizAggregate } = {}) => {
  const participants = Array.from(liveAudioParticipants.values()).map(makeOperationalParticipantSnapshot)
  return {
    snapshotId: `snapshot-${Date.now()}-${randomUUID()}`,
    createdAt: Date.now(),
    presentationSessionId,
    serverEpoch,
    stateRevision,
    connectionCounts: getConnectionCountsSnapshot(),
    participants,
    interventionQueue: participants
      .filter((participant) => participant.speakerState === 'REQUESTED' && !participant.isKicked)
      .map((participant) => participant.participantId),
    policies: {
      accessMode,
      ...getRecordingPolicy(),
    },
    audienceAccessRequests: Array.from(audienceAccessRecords.values())
      .filter((record) => record.accessState === 'WAITING')
      .map((record) => ({
        participantId: record.participantId,
        requestedAt: record.requestedAt || record.createdAt,
      })),
    authorizations: {
      principalControlSessionId: findPrincipalControl()?.controlSessionId || null,
      controls: getLiveAudioControlSnapshot().controls,
      pendingControls: getPendingControls(),
      allowDelegatedModerators: allowDelegatedModerators(),
    },
    liveKit: {
      enabled: liveKitState?.enabled,
      available: liveKitState?.available,
      participants: liveKitState?.participants || [],
      speakers: liveKitState?.speakers || [],
      muted: liveKitState?.muted || [],
      kicked: liveKitState?.kicked || [],
    },
    quizAggregate: quizAggregate || {
      submittedAnswersBySlideId: {},
      finalScoreRanges: {},
      totalFinalScores: 0,
      updatedAt: null,
    },
  }
}

const hasActivePresenter = () => {
  for (const meta of wsClients.values()) {
    if (meta.role === 'presenter' && meta.ws && meta.ws.readyState === WebSocket.OPEN) {
      return true
    }
  }
  return false
}

const getMediaMasterClientId = () => {
  for (const meta of wsClients.values()) {
    if (meta.role === 'presenter' && meta.ws && meta.ws.readyState === WebSocket.OPEN) {
      return meta.clientId
    }
  }
  const principal = findPrincipalControl()
  return principal ? principal.clientId : null
}

const broadcastMediaMasterStatus = () => {
  const hasPresenter = hasActivePresenter()
  const principal = findPrincipalControl()
  const masterControlSessionId = (!hasPresenter && principal) ? principal.controlSessionId : null
  
  broadcastWs({
    type: 'MEDIA_MASTER_STATUS',
    masterControlSessionId,
    hasActivePresenter: hasPresenter
  }, (meta) => meta.role === 'control')
}

const broadcastWs = (message, filter) => {
  const data = JSON.stringify(message)
  for (const [client, meta] of wsClients) {
    if (client.readyState !== WebSocket.OPEN) continue
    if (filter && !filter(meta)) continue
    try {
      client.send(data)
    } catch {
      wsClients.delete(client)
    }
  }
}

const getLiveAudioParticipantState = (participantId) => {
  const participant = liveAudioParticipants.get(participantId)
  if (!participant) return null
  return {
    participantId: participant.participantId,
    role: participant.role,
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
    recordingConfirmationEpoch: participant.recordingConfirmationSessionId === presentationSessionId
      ? participant.recordingConfirmationEpoch
      : undefined,
    connected: Boolean(participant.ws && participant.ws.readyState === WebSocket.OPEN),
    disconnectedAt: participant.disconnectedAt,
    updatedAt: participant.updatedAt,
  }
}

const resetWsServerStateForTests = () => {
  for (const control of liveAudioControls.values()) {
    clearTimeout(control.expiryTimer)
    clearTimeout(control.resumeTimer)
  }
  for (const participant of liveAudioParticipants.values()) {
    clearTimeout(participant.cleanupTimer)
  }
  wsClients.clear()
  liveAudioControls.clear()
  liveAudioParticipants.clear()
  audienceAccessRecords.clear()
  audienceCredentialIndex.clear()
  audienceSseTickets.clear()
  liveAudioControlPublicKeyMessage = null
  privateControlOverlayEnvelope = null
  presentationSessionId = randomUUID()
  serverEpoch = randomUUID()
  stateRevision = 0
  accessMode = getDefaultAccessMode()
  configureRecordingPolicy()
  recordingPolicyTransitionInProgress = false
}

const createWsServer = (httpServer, onFallbackMessage, snapshotProviders = {}) => {
  configureRecordingPolicy(snapshotProviders.recordingPolicy)
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: WS_MAX_PAYLOAD_BYTES,
  })

  const broadcast = (message, filter) => {
    const data = typeof message === 'string' ? message : JSON.stringify(message)
    for (const [client, meta] of wsClients) {
      if (client.readyState !== WebSocket.OPEN) continue
      if (filter && !filter(meta)) continue
      if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
        wsClients.delete(client)
        client.close(1013, 'Slow consumer')
        continue
      }
      try {
        client.send(data)
      } catch {
        wsClients.delete(client)
      }
    }
  }

  const sendJson = (client, message) => {
    if (!client || client.readyState !== WebSocket.OPEN) return false
    if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
      wsClients.delete(client)
      client.close(1013, 'Slow consumer')
      return false
    }
    try {
      client.send(JSON.stringify(message))
      return true
    } catch {
      wsClients.delete(client)
      return false
    }
  }

  const makeConnectionCountsMessage = (revisionEnvelope = makeRevisionEnvelope()) => {
    const counts = {
      audienceConnections: 0,
      controlConnections: 0,
      presenterConnections: 0,
    }

    for (const [client, meta] of wsClients) {
      if (client.readyState !== WebSocket.OPEN) continue
      if (meta.role === 'audience') counts.audienceConnections += 1
      if (meta.role === 'control') counts.controlConnections += 1
      if (meta.role === 'presenter') counts.presenterConnections += 1
    }

    return {
      type: 'LIVE_AUDIO_CONNECTION_COUNTS',
      ...revisionEnvelope,
      totalConnections: counts.audienceConnections + counts.controlConnections + counts.presenterConnections,
      ...counts,
      updatedAt: Date.now(),
    }
  }

  const broadcastConnectionCounts = (revisionEnvelope = commitStateMutation()) => {
    const message = makeConnectionCountsMessage(revisionEnvelope)
    broadcast(message, (meta) => meta.role === 'presenter' || meta.role === 'control')
    broadcastMediaMasterStatus()
  }

  const sendError = (client, code, message) => {
    sendJson(client, { type: 'ERROR', code, message })
  }

  const sendPrivateSignalResult = (client, msg, result, reason, retryAfterMs) => {
    const response = {
      type: 'PRIVATE_CONTROL_SIGNAL_RESULT',
      messageId: msg.messageId,
      result,
      createdAt: Date.now(),
    }
    if (reason) response.reason = reason
    if (retryAfterMs !== undefined) response.retryAfterMs = retryAfterMs
    sendJson(client, response)
    return response
  }

  const sendAuthorizationState = (control) => {
    const principal = findPrincipalControl()
    const message = {
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE',
      ...makeRevisionEnvelope(),
      controlSessionId: control.controlSessionId,
      controlState: control.controlState,
      principalControlSessionId: principal?.controlSessionId,
      allowDelegatedModerators: allowDelegatedModerators(),
      updatedAt: Date.now(),
    }

    if (control.controlState === 'PENDING' || control.controlState === 'AUTHORIZED_SYNCING') {
      message.verificationCode = control.verificationCode
      message.codeExpiresAt = control.codeExpiresAt
    }

    if (canAuthorizeControls(control)) {
      message.pendingControls = getPendingControls()
    }

    sendJson(control.ws, message)
  }

  const makeSnapshotMessage = () => ({
    type: 'LIVE_AUDIO_SNAPSHOT',
    snapshot: makeOperationalSnapshot({
      liveKitState: snapshotProviders.getLiveKitState?.(),
      quizAggregate: snapshotProviders.getQuizAggregateSnapshot?.(),
    }),
    createdAt: Date.now(),
  })

  const sendOperationalSnapshot = (control) => {
    if (!isControlAuthorized(control) && !control?.approvalPending) return false
    return sendJson(control.ws, makeSnapshotMessage())
  }

  const broadcastAuthorizationState = () => {
    for (const control of liveAudioControls.values()) {
      sendAuthorizationState(control)
      sendOperationalSnapshot(control)
    }
    broadcastMediaMasterStatus()
  }

  const resetPrivateControlSession = () => {
    liveAudioControlPublicKeyMessage = null
    privateControlOverlayEnvelope = null
    broadcast({
      type: 'CONTROL_KEY_ROTATED',
      keyId: `server-reset-${Date.now()}`,
      reason: 'NO_AUTHORIZED_CONTROLS',
      createdAt: Date.now(),
    })
  }

  const promoteSuccessorIfNeeded = () => {
    if (findPrincipalControl()) return

    const authorized = Array.from(liveAudioControls.values())
      .filter((control) => control.controlState === 'AUTHORIZED')
      .sort((left, right) => left.authorizedAt - right.authorizedAt)

    if (authorized[0]) {
      authorized[0].controlState = 'PRINCIPAL'
      commitStateMutation()
      broadcastAuthorizationState()
      return
    }

    const pending = Array.from(liveAudioControls.values())
      .filter((control) => control.controlState === 'PENDING')
      .sort((left, right) => left.connectedAt - right.connectedAt)

    resetPrivateControlSession()

    if (pending[0]) {
      pending[0].controlState = 'PRINCIPAL'
      pending[0].verificationCode = undefined
      pending[0].codeExpiresAt = undefined
      pending[0].authorizedAt = Date.now()
      commitStateMutation()
    }

    broadcastAuthorizationState()
  }

  const removeControl = (controlSessionId) => {
    const control = liveAudioControls.get(controlSessionId)
    if (!control) return
    clearTimeout(control.expiryTimer)
    clearTimeout(control.resumeTimer)
    const wasPrincipal = control.controlState === 'PRINCIPAL'
    liveAudioControls.delete(controlSessionId)
    commitStateMutation()
    if (wasPrincipal) {
      promoteSuccessorIfNeeded()
    } else {
      broadcastAuthorizationState()
    }
  }

  const expireDisconnectedControl = (controlSessionId) => {
    const control = liveAudioControls.get(controlSessionId)
    if (!control || control.ws || !control.resumeExpiresAt || control.resumeExpiresAt > Date.now()) return
    removeControl(controlSessionId)
  }

  const suspendControl = (controlSessionId, ws) => {
    const control = liveAudioControls.get(controlSessionId)
    if (!control || control.ws !== ws) return
    control.ws = null
    control.disconnectedAt = Date.now()
    control.resumeExpiresAt = control.disconnectedAt + getControlRejoinGraceMs()
    clearTimeout(control.resumeTimer)
    control.resumeTimer = setTimeout(
      () => expireDisconnectedControl(controlSessionId),
      getControlRejoinGraceMs(),
    )
    control.resumeTimer.unref?.()
    commitStateMutation()
    broadcastAuthorizationState()
  }

  const expirePendingControl = (controlSessionId) => {
    const control = liveAudioControls.get(controlSessionId)
    if (!control || (control.controlState !== 'PENDING' && control.controlState !== 'AUTHORIZED_SYNCING')) return
    control.verificationCode = undefined
    control.codeExpiresAt = Date.now()
    commitStateMutation()
    sendAuthorizationState(control)
    broadcastAuthorizationState()
  }

  const registerControl = (ws, clientId, requestedControlSessionId) => {
    const connectedAt = Date.now()
    const requestedIdAvailable = requestedControlSessionId &&
      !liveAudioControls.has(requestedControlSessionId)
    const controlSessionId = requestedIdAvailable
      ? requestedControlSessionId
      : `control-${randomUUID()}`
    const hasPrincipal = Boolean(findPrincipalControl())
    const resumeCredential = createResumeCredential()
    const control = {
      ws,
      clientId,
      controlSessionId,
      connectedAt,
      authorizedAt: hasPrincipal ? 0 : connectedAt,
      controlState: hasPrincipal ? 'PENDING' : 'PRINCIPAL',
      verificationCode: undefined,
      codeExpiresAt: undefined,
      recipientPublicKey: undefined,
      joinRequestId: undefined,
      pendingTransfer: undefined,
      keyTransferAck: false,
      approvalPending: false,
      overlayAck: false,
      syncRequired: false,
      privateSignalResults: new Map(),
      resumeCredentialHash: hashResumeCredential(resumeCredential),
      resumeExpiresAt: undefined,
      disconnectedAt: undefined,
      resumeTimer: undefined,
    }

    if (control.controlState === 'PENDING') {
      control.verificationCode = generateVerificationCode()
      control.codeExpiresAt = connectedAt + getControlCodeTtlMs()
      control.expiryTimer = setTimeout(() => expirePendingControl(controlSessionId), getControlCodeTtlMs())
      control.expiryTimer.unref?.()
    }

    liveAudioControls.set(controlSessionId, control)
    commitStateMutation()
    return { control, resumeCredential }
  }

  const handleControlResume = (meta, msg) => {
    const temporary = liveAudioControls.get(meta?.controlSessionId)
    const target = typeof msg.controlSessionId === 'string'
      ? liveAudioControls.get(msg.controlSessionId)
      : undefined
    const rejectResume = (code) => {
      sendJson(meta.ws, {
        type: 'LIVE_AUDIO_CONTROL_RESUME_RESULT',
        accepted: false,
        code,
        presentationSessionId,
        serverEpoch,
        stateRevision,
      })
    }

    if (
      meta?.role !== 'control' ||
      !temporary ||
      !target ||
      target === temporary ||
      !target.resumeExpiresAt ||
      target.resumeExpiresAt <= Date.now() ||
      !resumeCredentialMatches(target, msg.credential)
    ) {
      rejectResume('CONTROL_RESUME_INVALID')
      return
    }

    const previousWs = target.ws
    if (previousWs && previousWs !== meta.ws) {
      wsClients.delete(previousWs)
      previousWs.close(4000, 'Control session resumed elsewhere')
    }

    clearTimeout(temporary.expiryTimer)
    clearTimeout(temporary.resumeTimer)
    liveAudioControls.delete(temporary.controlSessionId)

    clearTimeout(target.resumeTimer)
    const nextCredential = createResumeCredential()
    target.resumeCredentialHash = hashResumeCredential(nextCredential)
    target.resumeExpiresAt = undefined
    target.disconnectedAt = undefined
    target.resumeTimer = undefined
    target.ws = meta.ws
    target.clientId = meta.clientId
    target.syncRequired = Boolean(privateControlOverlayEnvelope)
    meta.controlSessionId = target.controlSessionId
    meta.connectionEpoch = randomUUID()
    commitStateMutation()

    sendJson(meta.ws, {
      type: 'LIVE_AUDIO_CONTROL_RESUME_RESULT',
      accepted: true,
      controlSessionId: target.controlSessionId,
      controlState: target.controlState,
      credential: nextCredential,
      presentationSessionId,
      serverEpoch,
      connectionEpoch: meta.connectionEpoch,
      stateRevision,
      accessMode,
    })
    sendAuthorizationState(target)
    if (target.syncRequired) {
      sendPrivateOverlaySnapshot(target)
    } else {
      sendOperationalSnapshot(target, 'CONTROL_RESUMED')
    }
    broadcastAuthorizationState()
  }

  const sendPrivateOverlaySnapshot = (control) => {
    if (!control?.ws || !privateControlOverlayEnvelope) return false
    return sendJson(control.ws, {
      type: 'LIVE_AUDIO_PRIVATE_OVERLAY_SNAPSHOT',
      ...privateControlOverlayEnvelope,
    })
  }

  const finishControlSynchronization = (control) => {
    if (
      control?.controlState !== 'AUTHORIZED_SYNCING' ||
      control.keyTransferAck !== true ||
      control.approvalPending !== true ||
      control.overlayAck !== true
    ) return false
    clearTimeout(control.expiryTimer)
    control.controlState = 'AUTHORIZED'
    control.authorizedAt = Date.now()
    control.verificationCode = undefined
    control.codeExpiresAt = undefined
    control.pendingTransfer = undefined
    control.approvalPending = false
    commitStateMutation()
    broadcastAuthorizationState()
    return true
  }

  const handlePrivateOverlayPublish = (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    if (!isControlAuthorized(issuer) || !validatePrivateOverlayPublish(msg)) {
      sendJson(meta.ws, {
        type: 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT',
        messageId: msg?.messageId,
        result: 'NACK',
        reason: 'INVALID_OR_FORBIDDEN',
      })
      return
    }
    if (issuer.controlState !== 'PRINCIPAL') {
      sendJson(meta.ws, {
        type: 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT',
        messageId: msg.messageId,
        result: 'NACK',
        reason: 'NOT_OVERLAY_AUTHORITY',
      })
      return
    }
    if (liveAudioControlPublicKeyMessage?.keyId !== msg.keyId) {
      sendJson(meta.ws, {
        type: 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT',
        messageId: msg.messageId,
        result: 'NACK',
        reason: 'KEY_MISMATCH',
      })
      return
    }
    if (msg.basedOnStateRevision > stateRevision) {
      sendJson(meta.ws, {
        type: 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT',
        messageId: msg.messageId,
        result: 'NACK',
        reason: 'TECHNICAL_STATE_AHEAD',
      })
      return
    }
    if (privateControlOverlayEnvelope?.messageId === msg.messageId) {
      sendJson(meta.ws, {
        type: 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT',
        messageId: msg.messageId,
        result: 'ACK',
        reason: 'DUPLICATE',
      })
      return
    }
    const expectedPrivateRevision = privateControlOverlayEnvelope
      ? privateControlOverlayEnvelope.privateStateRevision + 1
      : 1
    if (msg.privateStateRevision !== expectedPrivateRevision) {
      sendJson(meta.ws, {
        type: 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT',
        messageId: msg.messageId,
        result: 'NACK',
        reason: 'PRIVATE_REVISION_GAP',
      })
      return
    }
    privateControlOverlayEnvelope = {
      messageId: msg.messageId,
      keyId: msg.keyId,
      privateStateRevision: msg.privateStateRevision,
      basedOnStateRevision: msg.basedOnStateRevision,
      ciphertext: msg.ciphertext,
      nonce: msg.nonce,
      createdAt: Date.now(),
    }
    sendJson(meta.ws, {
      type: 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT',
      messageId: msg.messageId,
      result: 'ACK',
    })
    for (const control of liveAudioControls.values()) {
      if (control.controlSessionId === issuer.controlSessionId) continue
      if (control.controlState === 'AUTHORIZED' || control.controlState === 'PRINCIPAL' || control.approvalPending) {
        sendPrivateOverlaySnapshot(control)
      }
    }
  }

  const handlePrivateOverlayResult = (meta, msg) => {
    const control = liveAudioControls.get(meta?.controlSessionId)
    if (
      control?.syncRequired === true &&
      msg.result === 'ACK' &&
      privateControlOverlayEnvelope &&
      msg.keyId === privateControlOverlayEnvelope.keyId &&
      msg.privateStateRevision === privateControlOverlayEnvelope.privateStateRevision
    ) {
      control.syncRequired = false
      commitStateMutation()
      sendOperationalSnapshot(control)
      broadcastAuthorizationState()
      return
    }
    if (
      control?.controlState !== 'AUTHORIZED_SYNCING' ||
      msg.result !== 'ACK' ||
      !privateControlOverlayEnvelope ||
      msg.keyId !== privateControlOverlayEnvelope.keyId ||
      msg.privateStateRevision !== privateControlOverlayEnvelope.privateStateRevision
    ) return
    control.overlayAck = true
    finishControlSynchronization(control)
  }

  const sendAudienceAccessState = (meta, record) => sendJson(meta?.ws, {
    type: 'AUDIENCE_ACCESS_STATE',
    ...makeAudienceAccessState(record),
    eventId: randomUUID(),
  })

  const notifyAudienceAccessRecord = (record) => {
    for (const meta of wsClients.values()) {
      if (meta.role === 'audience' && meta.audienceAccessId === record.participantId) {
        sendAudienceAccessState(meta, record)
      }
    }
  }

  const broadcastAccessPolicy = () => {
    const message = {
      type: 'SESSION_ACCESS_POLICY',
      ...makeRevisionEnvelope(),
      accessMode,
      updatedAt: Date.now(),
    }
    broadcast(message)
  }

  const makeRecordingPolicyMessage = (revisionEnvelope = makeRevisionEnvelope(), changedDuringSession = false) => ({
    type: 'SESSION_RECORDING_POLICY',
    ...revisionEnvelope,
    ...getRecordingPolicy(),
    changedDuringSession,
    updatedAt: Date.now(),
  })

  const broadcastRecordingPolicy = (revisionEnvelope, changedDuringSession) => {
    broadcast(makeRecordingPolicyMessage(revisionEnvelope, changedDuringSession))
  }

  const sendRecordingPolicyResult = (ws, msg, result, reason) => {
    sendJson(ws, {
      type: 'SESSION_RECORDING_POLICY_RESULT',
      commandId: msg.commandId,
      result,
      ...(reason ? { reason } : {}),
      presentationSessionId,
      serverEpoch,
      stateRevision,
      recordingState,
      recordingEpoch,
    })
  }

  const handleAudienceAccessBind = (meta, msg) => {
    if (meta?.role !== 'audience') return
    const record = authorizeAudienceCredential(msg.credential, { requireAdmitted: false })
    if (!record) {
      sendJson(meta.ws, {
        type: 'AUDIENCE_ACCESS_STATE',
        presentationSessionId,
        accessMode,
        accessState: 'CREDENTIAL_OBSOLETE',
        stateRevision,
      })
      return
    }
    meta.audienceAccessId = record.participantId
    meta.participantId = record.participantId
    sendAudienceAccessState(meta, record)
    if (record.accessState === 'ADMITTED') {
      sendJson(meta.ws, {
        type: 'AUDIO_TIMELINE_STATE',
        timeline: getTimeline(),
      })
    }
  }

  const handleAudienceAccessRequest = (meta, msg) => {
    if (meta?.role !== 'audience' || !meta.audienceAccessId) return
    const record = audienceAccessRecords.get(meta.audienceAccessId)
    if (!record || msg.participantId !== record.participantId) return
    const now = Date.now()
    if (accessMode === 'PUBLIC') {
      record.accessState = 'ADMITTED'
    } else if (record.accessState === 'BLOCKED') {
      sendAudienceAccessState(meta, record)
      return
    } else if (record.accessState === 'REJECTED' && record.retryAt > now) {
      sendAudienceAccessState(meta, record)
      return
    } else {
      record.accessState = 'WAITING'
      record.requestedAt = now
    }
    record.hasAlias = true
    record.retryAt = undefined
    const revisionEnvelope = commitStateMutation()
    sendAudienceAccessState(meta, record)
    if (record.accessState === 'WAITING') {
      broadcast({
        type: 'AUDIENCE_ACCESS_REQUEST',
        ...revisionEnvelope,
        participantId: record.participantId,
        requestedAt: now,
      }, (targetMeta) => (
        targetMeta.role === 'control' &&
        isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
      ))
    }
  }

  const handleAudienceAccessDecision = (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    if (!isControlAuthorized(issuer)) return
    const record = audienceAccessRecords.get(msg.participantId)
    if (!record || !['ADMIT', 'REJECT', 'BLOCK'].includes(msg.decision)) return
    if (msg.decision === 'ADMIT') {
      record.accessState = 'ADMITTED'
      record.retryAt = undefined
    } else if (msg.decision === 'REJECT') {
      record.accessState = 'REJECTED'
      record.retryAt = Date.now() + 30_000
    } else {
      record.accessState = 'BLOCKED'
      record.retryAt = undefined
    }
    const revisionEnvelope = commitStateMutation()
    notifyAudienceAccessRecord(record)
    broadcast({
      type: 'AUDIENCE_ACCESS_DECISION_RESULT',
      ...revisionEnvelope,
      participantId: record.participantId,
      decision: msg.decision,
      decidedByControlSessionId: issuer.controlSessionId,
      decidedAt: Date.now(),
    }, (targetMeta) => (
      targetMeta.role === 'control' &&
      isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    ))
  }

  const handleSessionAccessPolicyUpdate = (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    if (issuer?.controlState !== 'PRINCIPAL' || issuer.syncRequired || !['PUBLIC', 'CONTROLLED'].includes(msg.accessMode)) {
      sendError(meta.ws, 'SESSION_POLICY_FORBIDDEN', 'Only the ready principal Control may change access mode')
      return
    }
    if (msg.accessMode === accessMode) return
    accessMode = msg.accessMode
    for (const record of audienceAccessRecords.values()) {
      if (accessMode === 'PUBLIC') {
        record.accessState = 'ADMITTED'
        record.retryAt = undefined
      } else if (!record.hasAlias) {
        record.accessState = 'REQUEST_REQUIRED'
      }
    }
    commitStateMutation()
    for (const record of audienceAccessRecords.values()) notifyAudienceAccessRecord(record)
    broadcastAccessPolicy()
  }

  const handleSessionRecordingPolicyUpdate = async (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    if (
      issuer?.controlState !== 'PRINCIPAL' ||
      issuer.syncRequired ||
      !recordingMutable ||
      !['NOT_RECORDING', 'RECORDING'].includes(msg.recordingState) ||
      msg.presentationSessionId !== presentationSessionId ||
      !Number.isSafeInteger(msg.expectedStateRevision) ||
      (msg.recordingState === 'RECORDING' && !recordingAvailable)
    ) {
      sendError(meta.ws, 'SESSION_RECORDING_POLICY_FORBIDDEN', 'Recording policy cannot be changed by this Control')
      sendRecordingPolicyResult(meta.ws, msg, 'NACK', 'FORBIDDEN')
      return
    }
    if (msg.recordingState === recordingState) {
      sendRecordingPolicyResult(meta.ws, msg, 'ACK')
      return
    }
    if (msg.expectedStateRevision !== stateRevision) {
      sendError(meta.ws, 'REVISION_CONFLICT', 'Recording policy update used an obsolete state revision')
      sendRecordingPolicyResult(meta.ws, msg, 'NACK', 'REVISION_CONFLICT')
      sendOperationalSnapshot(issuer)
      return
    }

    const startsRecording = recordingState === 'NOT_RECORDING' && msg.recordingState === 'RECORDING'
    const expectedSessionId = presentationSessionId
    if (startsRecording) {
      recordingPolicyTransitionInProgress = true
      try {
        await snapshotProviders.revokeLiveAudioPublishingForRecording?.()
      } catch {
        sendError(meta.ws, 'LIVEKIT_PERMISSION_REVOCATION_FAILED', 'Recording was not enabled because Live Audio permissions could not be revoked')
        sendRecordingPolicyResult(meta.ws, msg, 'NACK', 'LIVEKIT_REVOCATION_FAILED')
        return
      } finally {
        recordingPolicyTransitionInProgress = false
      }
      if (
        presentationSessionId !== expectedSessionId ||
        recordingState !== 'NOT_RECORDING'
      ) {
        sendError(meta.ws, 'REVISION_CONFLICT', 'Recording policy changed while Live Audio permissions were being revoked')
        sendRecordingPolicyResult(meta.ws, msg, 'NACK', 'REVISION_CONFLICT')
        sendOperationalSnapshot(issuer)
        return
      }
    }
    recordingState = msg.recordingState
    if (startsRecording) recordingEpoch += 1

    if (startsRecording) {
      for (const record of audienceAccessRecords.values()) {
        record.recordingConfirmation = undefined
      }
    }
    for (const participant of liveAudioParticipants.values()) {
      if (startsRecording) {
        participant.recordingConfirmationSessionId = undefined
        participant.recordingConfirmationEpoch = undefined
        participant.isMicrophoneActive = false
        participant.isMuted = true
        participant.microphoneTrackState = participant.speakerState === 'GRANTED'
          ? 'mutedByControl'
          : participant.microphoneTrackState
        if (participant.role === 'audience') participant.canPublishAudio = false
      } else if (participant.role === 'audience' && participant.speakerState === 'GRANTED') {
        participant.canPublishAudio = true
      }
      participant.updatedAt = Date.now()
    }

    const revisionEnvelope = commitStateMutation()
    broadcastRecordingPolicy(revisionEnvelope, startsRecording)
    if (startsRecording) {
      broadcast({
        type: 'LIVE_AUDIO_MUTE_ALL',
        ...revisionEnvelope,
        recordingEpoch,
        reason: 'RECORDING_STARTED',
        createdAt: Date.now(),
      }, (targetMeta) => targetMeta.role === 'audience' || targetMeta.role === 'presenter')
    }
    broadcast(makeSnapshotMessage(), (targetMeta) => (
      targetMeta.role === 'control' &&
      isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    ))
    sendRecordingPolicyResult(meta.ws, msg, 'ACK')
  }

  const handleAudienceRecordingConfirmation = (meta, msg) => {
    const participant = liveAudioParticipants.get(msg.participantId)
    const accessRecord = meta?.audienceAccessId
      ? audienceAccessRecords.get(meta.audienceAccessId)
      : null
    if (
      meta?.role !== 'audience' ||
      !participant ||
      participant.ws !== meta.ws ||
      meta.participantId !== msg.participantId ||
      !accessRecord ||
      accessRecord.participantId !== msg.participantId ||
      accessRecord.accessState !== 'ADMITTED' ||
      msg.presentationSessionId !== presentationSessionId ||
      msg.recordingEpoch !== recordingEpoch ||
      recordingState !== 'RECORDING'
    ) {
      sendJson(meta?.ws, {
        type: 'AUDIENCE_RECORDING_CONFIRMATION_RESULT',
        result: 'NACK',
        presentationSessionId,
        recordingEpoch,
        stateRevision,
      })
      return
    }
    if (
      accessRecord.recordingConfirmation?.presentationSessionId === presentationSessionId &&
      accessRecord.recordingConfirmation?.recordingEpoch === recordingEpoch
    ) {
      sendJson(meta.ws, {
        type: 'AUDIENCE_RECORDING_CONFIRMATION_RESULT',
        ...makeRevisionEnvelope(),
        result: 'ACK',
        participantId: participant.participantId,
        recordingEpoch,
      })
      return
    }
    accessRecord.recordingConfirmation = {
      presentationSessionId,
      recordingEpoch,
      confirmedAt: Date.now(),
    }
    participant.recordingConfirmationSessionId = presentationSessionId
    participant.recordingConfirmationEpoch = recordingEpoch
    if (participant.speakerState === 'GRANTED' && !participant.isKicked) {
      participant.canPublishAudio = true
    }
    participant.updatedAt = Date.now()
    const revisionEnvelope = commitStateMutation()
    routeParticipantStatus(participant, revisionEnvelope)
    sendJson(meta.ws, {
      type: 'AUDIENCE_RECORDING_CONFIRMATION_RESULT',
      ...revisionEnvelope,
      result: 'ACK',
      participantId: participant.participantId,
      recordingEpoch,
    })
  }

  const isAuthorizedToDecide = (control) => canAuthorizeControls(control)

  const handleAuthorizationDecision = (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    const target = liveAudioControls.get(msg.targetControlSessionId)

    if (!isAuthorizedToDecide(issuer)) {
      sendError(meta.ws, 'CONTROL_AUTH_FORBIDDEN', 'Control is not allowed to authorize other controls')
      return
    }

    if (!target || (target.controlState !== 'PENDING' && target.controlState !== 'AUTHORIZED_SYNCING')) {
      sendError(meta.ws, 'CONTROL_AUTH_TARGET_INVALID', 'Pending control was not found')
      return
    }

    if (!target.codeExpiresAt || target.codeExpiresAt <= Date.now()) {
      sendError(meta.ws, 'CONTROL_AUTH_CODE_EXPIRED', 'Verification code expired')
      sendAuthorizationState(target)
      broadcastAuthorizationState()
      return
    }

    if (msg.decision === 'APPROVE') {
      if (target.controlState !== 'AUTHORIZED_SYNCING' || target.keyTransferAck !== true) {
        sendError(meta.ws, 'CONTROL_E2E_NOT_READY', 'Control E2E key transfer has not been acknowledged')
        return
      }
      if (!privateControlOverlayEnvelope) {
        sendError(meta.ws, 'CONTROL_OVERLAY_NOT_READY', 'Private Control overlay is not available yet')
        return
      }
      target.approvalPending = true
      target.overlayAck = false
      commitStateMutation()
      sendPrivateOverlaySnapshot(target)
      sendOperationalSnapshot(target)
      sendAuthorizationState(target)
      return
    } else {
      clearTimeout(target.expiryTimer)
      sendJson(target.ws, {
        type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE',
        controlSessionId: target.controlSessionId,
        controlState: 'PENDING',
        allowDelegatedModerators: allowDelegatedModerators(),
        verificationCode: undefined,
        codeExpiresAt: Date.now(),
        updatedAt: Date.now(),
      })
      liveAudioControls.delete(target.controlSessionId)
      commitStateMutation()
      wsClients.delete(target.ws)
      target.ws.close(4003, 'Control authorization rejected')
    }

    broadcastAuthorizationState()
  }

  const forwardToAuthorizingControls = (msg, sourceControl) => {
    sourceControl.recipientPublicKey = msg.recipientPublicKey
    sourceControl.joinRequestId = msg.messageId
    const enriched = {
      ...msg,
      controlSessionId: sourceControl.controlSessionId,
      verificationCode: sourceControl.verificationCode,
      createdAt: msg.createdAt || Date.now(),
    }
    for (const control of liveAudioControls.values()) {
      if (control.controlSessionId === sourceControl.controlSessionId) continue
      if (!canAuthorizeControls(control)) continue
      sendJson(control.ws, enriched)
    }
  }

  const forwardAuthorizedControlMessage = (msg, issuer) => {
    const target = liveAudioControls.get(msg.controlSessionId)
    if (
      !isControlAuthorized(issuer) ||
      !target ||
      (target.controlState !== 'PENDING' && target.controlState !== 'AUTHORIZED_SYNCING') ||
      typeof msg.transferId !== 'string' ||
      msg.transferId.trim() === '' ||
      typeof msg.keyId !== 'string' ||
      msg.keyId.trim() === ''
    ) return
    target.controlState = 'AUTHORIZED_SYNCING'
    target.keyTransferAck = false
    target.pendingTransfer = {
      transferId: msg.transferId,
      keyId: msg.keyId,
      issuerControlSessionId: issuer.controlSessionId,
    }
    commitStateMutation()
    sendJson(target.ws, {
      ...msg,
      authorizedByControlSessionId: issuer.controlSessionId,
      createdAt: msg.createdAt || Date.now(),
    })
    broadcastAuthorizationState()
  }

  const handleControlKeyTransferResult = (meta, msg) => {
    const target = liveAudioControls.get(meta.controlSessionId)
    const transfer = target?.pendingTransfer
    if (
      !target ||
      target.controlState !== 'AUTHORIZED_SYNCING' ||
      msg.controlSessionId !== target.controlSessionId ||
      !transfer ||
      msg.transferId !== transfer.transferId ||
      msg.keyId !== transfer.keyId ||
      (msg.result !== 'ACK' && msg.result !== 'NACK')
    ) {
      sendError(meta.ws, 'CONTROL_KEY_TRANSFER_INVALID', 'Control key transfer result is not correlated')
      return
    }

    const issuer = liveAudioControls.get(transfer.issuerControlSessionId)
    if (issuer && isControlAuthorized(issuer)) {
      sendJson(issuer.ws, {
        ...msg,
        createdAt: msg.createdAt || Date.now(),
      })
    }

    if (msg.result === 'ACK') {
      target.keyTransferAck = true
    } else {
      target.controlState = 'PENDING'
      target.keyTransferAck = false
      target.pendingTransfer = undefined
    }
    commitStateMutation()
    broadcastAuthorizationState()
  }

  const routePrivateControlSignalToControls = (msg) => {
    let recipients = 0
    for (const control of liveAudioControls.values()) {
      if (!isControlAuthorized(control)) continue
      if (msg.toControlSessionId && msg.toControlSessionId !== control.controlSessionId) continue
      if (sendJson(control.ws, msg)) recipients += 1
    }
    return recipients
  }

  const routePrivateControlSignalToParticipant = (msg) => {
    let recipients = 0
    for (const [client, targetMeta] of wsClients) {
      if (targetMeta.role !== 'audience' || targetMeta.participantId !== msg.toParticipantId) continue
      if (sendJson(client, msg)) recipients += 1
    }
    return recipients
  }

  const validatePrivateControlSignal = (msg, senderRole = 'audience') => {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false
    if (msg.type !== 'PRIVATE_CONTROL_SIGNAL') return false
    if (!['PROFILE_STATE', 'PRIVATE_MESSAGE', 'CONTROL_STATE'].includes(msg.signalClass)) return false
    if (typeof msg.messageId !== 'string' || msg.messageId.trim() === '') return false
    if (senderRole === 'control') {
      if (typeof msg.fromParticipantId !== 'string' || msg.fromParticipantId.trim() === '') return false
    } else if (!isValidParticipantId(msg.fromParticipantId)) {
      return false
    }
    if (msg.toControlSessionId !== undefined && typeof msg.toControlSessionId !== 'string') return false
    if (msg.toParticipantId !== undefined && !isValidParticipantId(msg.toParticipantId)) return false
    if (senderRole === 'audience' && msg.toParticipantId !== undefined) return false
    if (senderRole === 'control' && !isValidParticipantId(msg.toParticipantId)) return false
    if (typeof msg.keyId !== 'string' || msg.keyId.trim() === '') return false
    if (!isValidBase64(msg.ephemeralPublicKey)) return false
    if (!isValidBase64(msg.ciphertext)) return false
    if (getBase64ByteLength(msg.ciphertext) > PRIVATE_CONTROL_SIGNAL_MAX_CIPHERTEXT_BYTES) return false
    if (!isValidBase64(msg.nonce) || getBase64ByteLength(msg.nonce) !== 12) return false
    if (msg.createdAt !== undefined && (typeof msg.createdAt !== 'number' || !Number.isFinite(msg.createdAt))) return false
    return true
  }

  const validatePrivateOverlayPublish = (msg) => {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false
    if (msg.type !== 'LIVE_AUDIO_PRIVATE_OVERLAY_PUBLISH') return false
    if (typeof msg.messageId !== 'string' || msg.messageId.trim() === '') return false
    if (typeof msg.keyId !== 'string' || msg.keyId.trim() === '') return false
    if (!Number.isSafeInteger(msg.privateStateRevision) || msg.privateStateRevision < 0) return false
    if (!Number.isSafeInteger(msg.basedOnStateRevision) || msg.basedOnStateRevision < 0) return false
    if (!isValidBase64(msg.ciphertext)) return false
    if (getBase64ByteLength(msg.ciphertext) > PRIVATE_CONTROL_OVERLAY_MAX_CIPHERTEXT_BYTES) return false
    if (!isValidBase64(msg.nonce) || getBase64ByteLength(msg.nonce) !== 12) return false
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
    if (msg.updatedAt !== undefined && (typeof msg.updatedAt !== 'number' || !Number.isFinite(msg.updatedAt))) return false
    return msg.alias === undefined
  }

  const validateActiveParticipantProfile = (msg) => {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false
    if (msg.type !== 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE') return false
    if (!isValidParticipantId(msg.participantId)) return false
    if (msg.alias !== undefined || msg.activeListPublicKey !== undefined) return false
    if (typeof msg.isAliasVisibleToActiveParticipants !== 'boolean') return false
    if (msg.createdAt !== undefined && (typeof msg.createdAt !== 'number' || !Number.isFinite(msg.createdAt))) return false
    return true
  }

  const bindParticipantToConnection = (meta, participantId, status = {}) => {
    if (!isValidParticipantId(participantId)) return null
    if (meta.participantId && meta.participantId !== participantId) return null

    const existing = liveAudioParticipants.get(participantId)
    if (existing && existing.ws && existing.ws !== meta.ws && existing.ws.readyState === WebSocket.OPEN) {
      return null
    }

    if (existing?.cleanupTimer) {
      clearTimeout(existing.cleanupTimer)
    }

    const now = Date.now()
    const isKicked = existing?.isKicked === true || status.isKicked === true
    const requestedAudienceState = status.speakerState === 'REQUESTED'
      ? 'REQUESTED'
      : status.speakerState === 'REVOKED'
        ? 'REVOKED'
        : 'LISTENER'
    const speakerState = isKicked
      ? 'REVOKED'
      : existing?.speakerState === 'GRANTED' || existing?.speakerState === 'MUTED'
        ? existing.speakerState
        : requestedAudienceState
    const canonicalPublishPermission = Boolean(
      !isKicked &&
      existing?.canPublishAudio === true &&
      speakerState === 'GRANTED' &&
      hasCurrentRecordingConfirmation(participantId)
    )
    const isMicrophoneActive = canonicalPublishPermission && status.isMicrophoneActive === true
    const participant = {
      participantId,
      role: meta.role,
      clientId: meta.clientId,
      ws: meta.ws,
      speakerState,
      canSubscribe: typeof status.canSubscribe === 'boolean' ? status.canSubscribe : existing?.canSubscribe ?? true,
      canPublishAudio: canonicalPublishPermission,
      isMuted: isMicrophoneActive ? false : true,
      isActiveAudience: isKicked ? false : typeof status.isActiveAudience === 'boolean' ? status.isActiveAudience : existing?.isActiveAudience ?? false,
      isMicrophoneActive,
      isKicked,
      isAliasVisibleToActiveParticipants: existing?.isAliasVisibleToActiveParticipants ?? false,
      canViewActiveParticipants: existing?.canViewActiveParticipants ?? false,
      isAliasHiddenByControl: existing?.isAliasHiddenByControl ?? !getDefaultModerationVisible(),
      recordingConfirmationSessionId: existing?.recordingConfirmationSessionId,
      recordingConfirmationEpoch: existing?.recordingConfirmationEpoch,
      microphonePermissionState: typeof status.microphonePermissionState === 'string'
        ? status.microphonePermissionState
        : existing?.microphonePermissionState || 'unknown',
      microphoneTrackState: typeof status.microphoneTrackState === 'string'
        ? status.microphoneTrackState
        : existing?.microphoneTrackState,
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
      disconnectedAt: undefined,
      cleanupDueAt: undefined,
      cleanupTimer: undefined,
      privateMessageTimestamps: existing?.privateMessageTimestamps || [],
      technicalSignalTimestamps: existing?.technicalSignalTimestamps || [],
      privateSignalResults: existing?.privateSignalResults || new Map(),
    }
    liveAudioParticipants.set(participantId, participant)
    meta.participantId = participantId
    return participant
  }

  const releaseParticipantConnection = (meta) => {
    if (meta?.role !== 'audience' || !meta.participantId) return
    const participant = liveAudioParticipants.get(meta.participantId)
    if (!participant || participant.ws !== meta.ws) return

    participant.ws = null
    participant.disconnectedAt = Date.now()
    participant.cleanupDueAt = participant.disconnectedAt + getRejoinGraceMs()
    clearTimeout(participant.cleanupTimer)
    participant.cleanupTimer = setTimeout(() => cleanupExpiredParticipant(meta.participantId), getRejoinGraceMs())
    participant.cleanupTimer.unref?.()

    const revisionEnvelope = commitStateMutation()
    broadcast({
      ...makeReducedParticipantStatus(participant),
      ...revisionEnvelope,
      connected: false,
      updatedAt: Date.now(),
    }, (targetMeta) => isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId)))
  }

  const cleanupExpiredParticipant = (participantId) => {
    const current = liveAudioParticipants.get(participantId)
    if (!current || current.ws !== null) return
    if (current.cleanupDueAt && current.cleanupDueAt > Date.now()) return

    const releasedStatus = {
      ...makeReducedParticipantStatus(current),
      speakerState: 'REVOKED',
      canPublishAudio: false,
      isMuted: true,
      isActiveAudience: false,
      isMicrophoneActive: false,
      updatedAt: Date.now(),
    }
    current.speakerState = 'REVOKED'
    current.canPublishAudio = false
    current.isMuted = true
    current.isActiveAudience = false
    current.isMicrophoneActive = false
    liveAudioParticipants.delete(participantId)
    const revisionEnvelope = commitStateMutation()
    routeParticipantStatus(releasedStatus, revisionEnvelope)
    broadcast({
      type: 'LIVE_AUDIO_REVOKE_SPEAK',
      ...revisionEnvelope,
      participantId,
      createdAt: Date.now(),
    }, (targetMeta) => {
      if (targetMeta.role === 'presenter') return true
      if (targetMeta.role !== 'control') return false
      return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    })
  }

  const sweepExpiredParticipants = () => {
    const now = Date.now()
    for (const participant of liveAudioParticipants.values()) {
      if (participant.ws === null && participant.cleanupDueAt && participant.cleanupDueAt <= now) {
        cleanupExpiredParticipant(participant.participantId)
      }
    }
  }

  const canAcceptPrivateSignal = (meta, msg, existingParticipant) => {
    const participant = existingParticipant || bindParticipantToConnection(meta, msg.fromParticipantId)
    if (!participant) return { accepted: false, reason: 'INVALID_SIGNAL' }

    const now = Date.now()
    const timestampsKey = msg.signalClass === 'PRIVATE_MESSAGE'
      ? 'privateMessageTimestamps'
      : 'technicalSignalTimestamps'
    const rateLimit = msg.signalClass === 'PRIVATE_MESSAGE'
      ? PRIVATE_CONTROL_SIGNAL_RATE_LIMIT
      : PRIVATE_CONTROL_TECHNICAL_SIGNAL_RATE_LIMIT
    participant[timestampsKey] = participant[timestampsKey]
      .filter((timestamp) => now - timestamp < PRIVATE_CONTROL_SIGNAL_RATE_WINDOW_MS)
    if (participant[timestampsKey].length >= rateLimit) {
      const retryAfterMs = Math.max(
        1,
        PRIVATE_CONTROL_SIGNAL_RATE_WINDOW_MS - (now - participant[timestampsKey][0]),
      )
      return { accepted: false, reason: 'RATE_LIMIT', retryAfterMs, participant }
    }

    participant[timestampsKey].push(now)
    participant.updatedAt = now
    return { accepted: true, participant }
  }

  const canAcceptControlPrivateSignal = (meta, msg) => {
    const control = liveAudioControls.get(meta.controlSessionId)
    if (!isControlAuthorized(control)) return false
    const participant = liveAudioParticipants.get(msg.toParticipantId)
    return Boolean(
      participant &&
      participant.role === 'audience' &&
      participant.ws &&
      participant.ws.readyState === WebSocket.OPEN
    )
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
    microphonePermissionState: msg.microphonePermissionState,
    microphoneTrackState: msg.microphoneTrackState,
    updatedAt: msg.updatedAt || Date.now(),
  })

  const routeParticipantStatus = (msg, revisionEnvelope = commitStateMutation()) => {
    const reduced = {
      ...makeReducedParticipantStatus(msg),
      ...revisionEnvelope,
    }
    broadcast(reduced, (targetMeta) => {
      if (targetMeta.role === 'presenter') return true
      if (targetMeta.role !== 'control') return false
      return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    })
    return revisionEnvelope
  }

  const validateModerationMessage = (msg) => {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false
    if (!liveAudioModerationTypes.has(msg.type)) return false
    if (msg.type !== 'LIVE_AUDIO_MUTE_ALL' && !isValidParticipantId(msg.participantId)) return false
    if (msg.excludeParticipantIds !== undefined) {
      if (msg.type !== 'LIVE_AUDIO_MUTE_ALL' || !Array.isArray(msg.excludeParticipantIds)) return false
      if (!msg.excludeParticipantIds.every(isValidParticipantId)) return false
    }
    if (msg.issuedByParticipantId !== undefined && !isValidParticipantId(msg.issuedByParticipantId)) return false
    if (msg.createdAt !== undefined && (typeof msg.createdAt !== 'number' || !Number.isFinite(msg.createdAt))) return false
    return true
  }

  const applyModerationState = (msg) => {
    const now = Date.now()
    const changedParticipants = []
    const update = (participantId, patch) => {
      const participant = liveAudioParticipants.get(participantId)
      if (!participant) return
      Object.assign(participant, patch, { updatedAt: now })
      changedParticipants.push(participant)
    }

    switch (msg.type) {
      case 'LIVE_AUDIO_GRANT_SPEAK':
        update(msg.participantId, {
          speakerState: 'GRANTED',
          canPublishAudio: hasCurrentRecordingConfirmation(msg.participantId),
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
        })
        break
      case 'LIVE_AUDIO_REVOKE_SPEAK':
        update(msg.participantId, {
          speakerState: 'LISTENER',
          canPublishAudio: false,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
        })
        break
      case 'LIVE_AUDIO_MUTE_PARTICIPANT':
        update(msg.participantId, {
          speakerState: 'GRANTED',
          isMuted: true,
          canPublishAudio: hasCurrentRecordingConfirmation(msg.participantId),
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
        })
        break
      case 'LIVE_AUDIO_KICK_PARTICIPANT':
        update(msg.participantId, {
          speakerState: 'REVOKED',
          canPublishAudio: false,
          isMuted: true,
          isActiveAudience: false,
          isMicrophoneActive: false,
          isKicked: true,
        })
        break
      case 'LIVE_AUDIO_RESCUE_PARTICIPANT':
        update(msg.participantId, {
          speakerState: 'LISTENER',
          canPublishAudio: false,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
          microphoneTrackState: 'off',
        })
        break
      case 'LIVE_AUDIO_MUTE_ALL': {
        const excluded = new Set(msg.excludeParticipantIds || [])
        for (const participant of liveAudioParticipants.values()) {
          if (participant.role !== 'audience' || excluded.has(participant.participantId)) continue
          if (participant.speakerState !== 'GRANTED') continue
          update(participant.participantId, {
            speakerState: 'GRANTED',
            isMuted: true,
            canPublishAudio: hasCurrentRecordingConfirmation(participant.participantId),
            isActiveAudience: true,
            isMicrophoneActive: false,
            isKicked: false,
          })
        }
        break
      }
      default:
        break
    }
    if (changedParticipants.length === 0) return null
    const revisionEnvelope = commitStateMutation()
    for (const participant of changedParticipants) {
      routeParticipantStatus(makeReducedParticipantStatus(participant), revisionEnvelope)
    }
    return revisionEnvelope
  }

  const routeControlPublicKey = (msg, issuer) => {
    if (!isControlAuthorized(issuer) && !(issuer?.controlState === 'PRINCIPAL' && issuer.syncRequired)) return
    if (liveAudioControlPublicKeyMessage?.keyId && liveAudioControlPublicKeyMessage.keyId !== msg.keyId) {
      privateControlOverlayEnvelope = null
      issuer.syncRequired = false
    }
    liveAudioControlPublicKeyMessage = {
      ...msg,
      controlSessionId: issuer.controlSessionId,
      createdAt: msg.createdAt || Date.now(),
    }
    broadcast(liveAudioControlPublicKeyMessage, (targetMeta) => {
      if (targetMeta.role === 'audience') return true
      if (targetMeta.role !== 'control') return false
      return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    })
  }

  const canReceiveModerationMessage = (targetMeta, msg) => {
    if (targetMeta.role === 'presenter') return true
    if (targetMeta.role === 'control') {
      return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    }
    if (targetMeta.role !== 'audience' || !targetMeta.participantId) return false
    if (msg.type === 'LIVE_AUDIO_MUTE_ALL') {
      const excluded = new Set(msg.excludeParticipantIds || [])
      return !excluded.has(targetMeta.participantId)
    }
    return msg.participantId === targetMeta.participantId
  }

  wss.on('connection', (ws, req) => {
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const role = makeRole(url.searchParams.get('role') || 'unknown')

    if (!hasAllowedRequestOrigin(req)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        code: 'ORIGIN_FORBIDDEN',
        message: 'Request origin is not allowed',
      }))
      ws.close(1008, 'Origin forbidden')
      return
    }

    if (role !== 'audience' && isAuthRequired() && !hasValidBasicAuth(req)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }))
      ws.close(4001, 'Unauthorized')
      return
    }

    const clientId = url.searchParams.get('clientId') || randomUUID()
    const registration = role === 'control'
      ? registerControl(ws, clientId, url.searchParams.get('controlSessionId'))
      : null
    const control = registration?.control || null
    const meta = {
      role,
      clientId,
      ws,
      controlSessionId: control?.controlSessionId,
      connectionEpoch: randomUUID(),
    }
    wsClients.set(ws, meta)

    ws.send(JSON.stringify({
      type: 'WELCOME',
      clientId,
      serverTimeMs: Date.now(),
      role,
      controlSessionId: control?.controlSessionId,
      controlState: control?.controlState,
      controlResumeCredential: registration?.resumeCredential,
      presentationSessionId,
      serverEpoch,
      connectionEpoch: meta.connectionEpoch,
      stateRevision,
      recordingState,
      recordingEpoch,
    }))
    broadcastConnectionCounts()
    broadcastMediaMasterStatus()

    if (control) {
      sendAuthorizationState(control)
      broadcastAuthorizationState()
    }

    if (role === 'audience' && liveAudioControlPublicKeyMessage) {
      sendJson(ws, liveAudioControlPublicKeyMessage)
    }
    sendJson(ws, makeRecordingPolicyMessage())

    if (role !== 'audience') {
      ws.send(JSON.stringify({
        type: 'AUDIO_TIMELINE_STATE',
        timeline: getTimeline(),
      }))
    }

    ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      const meta = wsClients.get(ws)
      if (!meta) return
      if (meta.role === 'unknown' && msg.type !== 'SERVER_TIME_PING') {
        return
      }
      if (meta.role === 'audience' && !audienceAllowedTypes.has(msg.type)) {
        return
      }
      if (
        meta.role === 'audience' &&
        admittedAudienceOnlyTypes.has(msg.type)
      ) {
        const access = meta.audienceAccessId
          ? audienceAccessRecords.get(meta.audienceAccessId)
          : null
        if (access?.accessState !== 'ADMITTED') {
          sendError(meta.ws, 'AUDIENCE_ACCESS_NOT_BOUND', 'Bind a valid Audience credential before accessing session content')
          return
        }
      }
      if (
        recordingPolicyTransitionInProgress &&
        !recordingTransitionSafeTypes.has(msg.type)
      ) {
        if (msg.type === 'SESSION_RECORDING_POLICY_UPDATE') {
          sendRecordingPolicyResult(ws, msg, 'NACK', 'TRANSITION_IN_PROGRESS')
        }
        sendError(
          ws,
          'RECORDING_POLICY_TRANSITION_IN_PROGRESS',
          'Retry after the recording policy transition completes',
        )
        return
      }

      switch (msg.type) {
        case 'LIVE_AUDIO_CONTROL_RESUME':
          handleControlResume(meta, msg)
          break

        case 'AUDIENCE_ACCESS_BIND':
          handleAudienceAccessBind(meta, msg)
          break

        case 'AUDIENCE_ACCESS_REQUEST':
          handleAudienceAccessRequest(meta, msg)
          break

        case 'AUDIENCE_ACCESS_DECISION':
          if (meta?.role === 'control') handleAudienceAccessDecision(meta, msg)
          break

        case 'SESSION_ACCESS_POLICY_UPDATE':
          if (meta?.role === 'control') handleSessionAccessPolicyUpdate(meta, msg)
          break

        case 'SESSION_RECORDING_POLICY_UPDATE':
          if (meta?.role === 'control') await handleSessionRecordingPolicyUpdate(meta, msg)
          break

        case 'AUDIENCE_RECORDING_CONFIRMATION':
          handleAudienceRecordingConfirmation(meta, msg)
          break

        case 'LIVE_AUDIO_PRIVATE_OVERLAY_PUBLISH':
          handlePrivateOverlayPublish(meta, msg)
          break

        case 'LIVE_AUDIO_PRIVATE_OVERLAY_RESULT':
          handlePrivateOverlayResult(meta, msg)
          break

        case 'SERVER_TIME_PING':
          ws.send(JSON.stringify({
            type: 'SERVER_TIME_PONG',
            clientSentAtMs: msg.clientSentAtMs,
            serverTimeMs: Date.now(),
          }))
          break

        case 'AUDIO_TIMELINE_ACTION': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot mutate the audio timeline')
            break
          }
          const timeline = applyAction(msg.action)
          broadcast({
            type: 'AUDIO_TIMELINE_STATE',
            timeline,
          }, canReceiveAudienceSessionContent)
          break
        }

        case 'PRIVATE_CONTROL_SIGNAL':
          if (meta.role === 'audience') {
            const accessRecord = meta.audienceAccessId
              ? audienceAccessRecords.get(meta.audienceAccessId)
              : null
            if (
              !accessRecord ||
              accessRecord.participantId !== msg.fromParticipantId ||
              accessRecord.accessState !== 'ADMITTED'
            ) {
              if (typeof msg.messageId === 'string') {
                sendPrivateSignalResult(ws, msg, 'NACK', 'ACCESS_NOT_BOUND')
              }
              break
            }
            if (accessRecord && msg.signalClass === 'PROFILE_STATE') {
              accessRecord.hasAlias = true
            }
            if (!validatePrivateControlSignal(msg, 'audience')) {
              if (typeof msg.messageId === 'string') {
                sendPrivateSignalResult(ws, msg, 'NACK', 'INVALID_SIGNAL')
              }
              break
            }
            const participant = bindParticipantToConnection(meta, msg.fromParticipantId)
            const cachedResult = participant?.privateSignalResults.get(msg.messageId)
            if (cachedResult) {
              sendJson(ws, cachedResult)
              break
            }
            const acceptance = canAcceptPrivateSignal(meta, msg, participant)
            if (!acceptance.accepted) {
              const result = sendPrivateSignalResult(
                ws,
                msg,
                'NACK',
                acceptance.reason,
                acceptance.retryAfterMs,
              )
              acceptance.participant?.privateSignalResults.set(msg.messageId, result)
              break
            }
            const recipients = routePrivateControlSignalToControls(msg)
            const result = recipients > 0
              ? sendPrivateSignalResult(ws, msg, 'ACK')
              : sendPrivateSignalResult(ws, msg, 'NACK', 'NO_RECIPIENT')
            acceptance.participant.privateSignalResults.set(msg.messageId, result)
            if (acceptance.participant.privateSignalResults.size > 100) {
              const oldest = acceptance.participant.privateSignalResults.keys().next().value
              if (oldest) acceptance.participant.privateSignalResults.delete(oldest)
            }
            break
          }
          if (meta.role === 'control') {
            const controlMeta = liveAudioControls.get(meta.controlSessionId)
            if (!isControlAuthorized(controlMeta)) {
              sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot send private signals')
              break
            }
            if (!validatePrivateControlSignal(msg, 'control')) {
              if (typeof msg.messageId === 'string') {
                sendPrivateSignalResult(ws, msg, 'NACK', 'INVALID_SIGNAL')
              }
              break
            }
            const cachedResult = controlMeta.privateSignalResults.get(msg.messageId)
            if (cachedResult) {
              sendJson(ws, cachedResult)
              break
            }
            const recipients = canAcceptControlPrivateSignal(meta, msg)
              ? routePrivateControlSignalToParticipant(msg)
              : 0
            const result = recipients > 0
              ? sendPrivateSignalResult(ws, msg, 'ACK')
              : sendPrivateSignalResult(ws, msg, 'NACK', 'NO_RECIPIENT')
            controlMeta.privateSignalResults.set(msg.messageId, result)
            if (controlMeta.privateSignalResults.size > 100) {
              const oldest = controlMeta.privateSignalResults.keys().next().value
              if (oldest) controlMeta.privateSignalResults.delete(oldest)
            }
          }
          break

        case 'LIVE_AUDIO_PARTICIPANT_STATUS':
          if (meta.role !== 'audience') break
          if (!validateParticipantStatus(msg, 'audience')) break
          {
            const participant = bindParticipantToConnection(meta, msg.participantId, msg)
            if (!participant) break
            if (!participant.isActiveAudience && !participant.isKicked) {
              participant.isAliasVisibleToActiveParticipants = false
              participant.canViewActiveParticipants = false
            }
            routeParticipantStatus(participant)
          }
          break

        case 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE': {
          if (meta.role !== 'audience') break
          if (!validateActiveParticipantProfile(msg)) break
          const existing = liveAudioParticipants.get(msg.participantId)
          const shouldActivate = existing?.isKicked === true
            ? false
            : existing?.isActiveAudience ?? true
          const participant = bindParticipantToConnection(meta, msg.participantId, {
            speakerState: existing?.speakerState && existing.speakerState !== 'REVOKED'
              ? existing.speakerState
              : 'LISTENER',
            canSubscribe: existing?.canSubscribe ?? true,
            canPublishAudio: existing?.canPublishAudio ?? false,
            isMuted: existing?.isMuted ?? true,
            isActiveAudience: shouldActivate,
            isMicrophoneActive: existing?.isMicrophoneActive ?? false,
            isKicked: existing?.isKicked ?? false,
            microphonePermissionState: existing?.microphonePermissionState,
            microphoneTrackState: existing?.microphoneTrackState,
          })
          if (!participant || participant.isKicked) break
          participant.isAliasVisibleToActiveParticipants = msg.isAliasVisibleToActiveParticipants
          participant.updatedAt = Date.now()
          const revisionEnvelope = routeParticipantStatus(participant)
          broadcast({
            type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
            ...revisionEnvelope,
            participantId: msg.participantId,
            isAliasVisibleToActiveParticipants: msg.isAliasVisibleToActiveParticipants,
            createdAt: msg.createdAt || Date.now(),
          }, (targetMeta) => {
            if (targetMeta.role !== 'control') return false
            return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
          })
          break
        }

        case 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION':
          if (meta?.role !== 'control') break
          handleAuthorizationDecision(meta, msg)
          break

        case 'LIVE_AUDIO_CONTROL_JOIN_REQUEST': {
          if (meta?.role !== 'control') break
          const sourceControl = liveAudioControls.get(meta.controlSessionId)
          if (!sourceControl || sourceControl.controlState !== 'PENDING') break
          forwardToAuthorizingControls(msg, sourceControl)
          break
        }

        case 'LIVE_AUDIO_CONTROL_AUTHORIZED': {
          if (meta?.role !== 'control') break
          const issuer = liveAudioControls.get(meta.controlSessionId)
          forwardAuthorizedControlMessage(msg, issuer)
          break
        }

        case 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT':
          if (meta?.role !== 'control') break
          handleControlKeyTransferResult(meta, msg)
          break

        case 'LIVE_AUDIO_CONTROL_PUBLIC_KEY': {
          if (meta?.role !== 'control') break
          const issuer = liveAudioControls.get(meta.controlSessionId)
          if (
            typeof msg.controlSessionId !== 'string' ||
            msg.controlSessionId !== issuer?.controlSessionId ||
            typeof msg.keyId !== 'string' ||
            msg.keyId.trim() === '' ||
            !isValidBase64(msg.publicKey)
          ) {
            break
          }
          routeControlPublicKey(msg, issuer)
          break
        }

        case 'LIVE_AUDIO_SNAPSHOT_REQUEST': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot request operational snapshots')
            break
          }
          sendOperationalSnapshot(controlMeta)
          break
        }

        case 'LIVE_AUDIO_SNAPSHOT_PATCH': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot publish operational snapshot patches')
            break
          }
          if (containsClearAliasData(msg.snapshot)) {
            sendError(ws, 'CLEAR_ALIAS_FORBIDDEN', 'Alias data must use end-to-end encrypted private signals')
            break
          }
          const changed = mergeOperationalSnapshotPatch(msg.snapshot)
          if (!changed) break
          commitStateMutation()
          broadcast(makeSnapshotMessage(), (targetMeta) => {
            if (targetMeta.role !== 'control') return false
            return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
          })
          break
        }

        case 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) break
          if (!isValidParticipantId(msg.participantId) || typeof msg.canViewActiveParticipants !== 'boolean') break
          const participant = liveAudioParticipants.get(msg.participantId)
          if (!participant) break
          participant.canViewActiveParticipants = msg.canViewActiveParticipants
          participant.updatedAt = Date.now()
          const revisionEnvelope = commitStateMutation()
          if (participant.ws?.readyState === WebSocket.OPEN) {
            sendJson(participant.ws, {
              type: 'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION',
              ...revisionEnvelope,
              participantId: msg.participantId,
              canViewActiveParticipants: msg.canViewActiveParticipants,
              createdAt: Date.now(),
            })
          }
          broadcast(makeSnapshotMessage(), (targetMeta) => {
            if (targetMeta.role !== 'control') return false
            return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
          })
          break
        }

        case 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) break
          if (!isValidParticipantId(msg.participantId) || typeof msg.isAliasHiddenByControl !== 'boolean') break
          const participant = liveAudioParticipants.get(msg.participantId)
          if (!participant) break
          if (!participant.isAliasVisibleToActiveParticipants && !msg.isAliasHiddenByControl) break
          participant.isAliasHiddenByControl = msg.isAliasHiddenByControl
          participant.updatedAt = Date.now()
          commitStateMutation()
          broadcast(makeSnapshotMessage(), (targetMeta) => {
            if (targetMeta.role !== 'control') return false
            return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
          })
          break
        }

        case 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) break
          if (!isValidParticipantId(msg.participantId)) break
          const participant = liveAudioParticipants.get(msg.participantId)
          if (!participant || !participant.isKicked) break
          Object.assign(participant, {
            isKicked: false,
            isActiveAudience: false,
            isAliasVisibleToActiveParticipants: false,
            canViewActiveParticipants: false,
            isAliasHiddenByControl: false,
            speakerState: 'LISTENER',
            canPublishAudio: false,
            isMuted: true,
            isMicrophoneActive: false,
            updatedAt: Date.now(),
          })
          const revisionEnvelope = routeParticipantStatus(makeReducedParticipantStatus(participant))
          if (participant.ws?.readyState === WebSocket.OPEN) {
            sendJson(participant.ws, {
              type: 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
              ...revisionEnvelope,
              participantId: msg.participantId,
              createdAt: Date.now(),
            })
          }
          broadcast(makeSnapshotMessage(), (targetMeta) => {
            if (targetMeta.role !== 'control') return false
            return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
          })
          break
        }

        case 'SYNC_STATE':
        case 'AUDIO_TELEMETRY':
        case 'VIDEO_TELEMETRY':
        case 'DISPLAY_TELEMETRY':
          if (meta?.role === 'audience') break
          if (meta?.role === 'control' && !isControlAuthorized(liveAudioControls.get(meta.controlSessionId))) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot mutate projection or telemetry state')
            break
          }
          if (onFallbackMessage) {
            onFallbackMessage(msg, meta)
          }
          break

        case 'REMOTE_COMMAND':
          if (meta?.role !== 'control') break
          if (!isControlAuthorized(liveAudioControls.get(meta.controlSessionId))) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot mutate projection state')
            break
          }
          if (msg.payload?.command === 'RESET_STATE' && msg.payload.clearSession) {
            try {
              await snapshotProviders.revokeLiveAudioPublishingForRecording?.()
            } catch {
              sendError(ws, 'LIVEKIT_PERMISSION_REVOCATION_FAILED', 'Session rotation was rejected because Live Audio permissions could not be revoked')
              break
            }
          }
          {
            const accepted = onFallbackMessage ? onFallbackMessage(msg, meta) === true : false
            if (!accepted) break
          }
          if (msg.payload?.command === 'RESET_STATE' && msg.payload.clearSession) {
            presentationSessionId = randomUUID()
            stateRevision = 0
            liveAudioControls.clear()
            liveAudioParticipants.clear()
            clearAudienceAccessRecords()
            audienceSseTickets.clear()
            accessMode = getDefaultAccessMode()
            configureRecordingPolicy(snapshotProviders.recordingPolicy)
            broadcastConnectionCounts()
            broadcastAuthorizationState()
            broadcast(JSON.stringify({
              type: 'PRESENTATION_SESSION_ROTATED',
              presentationSessionId,
              serverEpoch,
              stateRevision,
              recordingState,
              recordingEpoch,
              eventId: randomUUID(),
            }))
            broadcastRecordingPolicy(makeRevisionEnvelope(), false)
            console.log('[SERVER] Presentation session rotated')
          }
          break

        case 'LIVE_AUDIO_GRANT_SPEAK':
        case 'LIVE_AUDIO_REVOKE_SPEAK':
        case 'LIVE_AUDIO_MUTE_PARTICIPANT':
        case 'LIVE_AUDIO_MUTE_ALL':
        case 'LIVE_AUDIO_KICK_PARTICIPANT':
        case 'LIVE_AUDIO_RESCUE_PARTICIPANT': {
          if (meta?.role !== 'control') break
          if (!validateModerationMessage(msg)) break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot send moderation actions')
            break
          }
          if (
            msg.type === 'LIVE_AUDIO_GRANT_SPEAK' &&
            !hasCurrentRecordingConfirmation(msg.participantId)
          ) {
            sendError(ws, 'RECORDING_CONFIRMATION_REQUIRED', 'Participant must confirm the active recording epoch before receiving microphone permission')
            break
          }
          const revisionEnvelope = applyModerationState(msg)
          if (!revisionEnvelope) break
          broadcast({
            ...msg,
            ...revisionEnvelope,
          }, (targetMeta) => canReceiveModerationMessage(targetMeta, msg))
          break
        }

        case 'LIVE_AUDIO_REQUEST_ALIASES': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot request aliases')
            break
          }
          broadcast(msg, (targetMeta) => targetMeta.role === 'audience')
          break
        }

        default:
          break
      }
    })

    ws.on('close', () => {
      const meta = wsClients.get(ws)
      wsClients.delete(ws)
      if (meta?.role === 'control' && meta.controlSessionId) {
        suspendControl(meta.controlSessionId, ws)
      }
      releaseParticipantConnection(meta)
      broadcastConnectionCounts()
      broadcastMediaMasterStatus()
    })
    ws.on('error', () => {
      const meta = wsClients.get(ws)
      wsClients.delete(ws)
      if (meta?.role === 'control' && meta.controlSessionId) {
        suspendControl(meta.controlSessionId, ws)
      }
      releaseParticipantConnection(meta)
      broadcastConnectionCounts()
      broadcastMediaMasterStatus()
    })
  })

  const heartbeat = setInterval(() => {
    const now = Date.now()
    for (const [ticket, ticketRecord] of audienceSseTickets) {
      if (ticketRecord.expiresAt <= now) audienceSseTickets.delete(ticket)
    }
    for (const [participantId, accessRecord] of audienceAccessRecords) {
      if (accessRecord.expiresAt > now) continue
      const wasWaiting = accessRecord.accessState === 'WAITING'
      deleteAudienceAccessRecord(participantId)
      const revisionEnvelope = wasWaiting ? commitStateMutation() : null
      if (revisionEnvelope) {
        broadcast({
          type: 'AUDIENCE_ACCESS_DECISION_RESULT',
          ...revisionEnvelope,
          participantId,
          decision: 'EXPIRED',
        }, (targetMeta) => (
          targetMeta.role === 'control' &&
          isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
        ))
      }
      for (const meta of wsClients.values()) {
        if (meta.role !== 'audience' || meta.audienceAccessId !== participantId) continue
        sendJson(meta.ws, {
          type: 'AUDIENCE_ACCESS_STATE',
          presentationSessionId,
          accessMode,
          participantId,
          accessState: 'CREDENTIAL_OBSOLETE',
          stateRevision,
        })
      }
    }
    for (const [client, meta] of wsClients) {
      if (client.isAlive === false) {
        wsClients.delete(client)
        if (meta?.role === 'control' && meta.controlSessionId) {
          suspendControl(meta.controlSessionId, client)
        }
        releaseParticipantConnection(meta)
        broadcastConnectionCounts()
        broadcastMediaMasterStatus()
        client.terminate()
        continue
      }
      
      client.isAlive = false
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.ping()
        } catch {
          wsClients.delete(client)
        }
      } else {
        wsClients.delete(client)
      }
    }
    sweepExpiredParticipants()
  }, 25_000)
  heartbeat.unref?.()

  wss.on('close', () => clearInterval(heartbeat))

  return wss
}

export {
  createWsServer,
  getLiveAudioControlState,
  getLiveAudioControlSnapshot,
  getLiveAudioParticipantState,
  getLiveAudioParticipantSnapshot,
  isLiveAudioControlAuthorized,
  resetWsServerStateForTests,
  hasActivePresenter,
  broadcastWs,
  getMediaMasterClientId,
  bootstrapAudienceAccess,
  authorizeAudienceCredential,
  issueAudienceSseTicket,
  consumeAudienceSseTicket,
  logoutAudienceCredential,
  getSessionAccessMode,
  getPresentationSessionId,
  getServerEpoch,
  isAudienceParticipantAdmitted,
  canReceiveAudienceSessionContent,
  getRecordingPolicy,
  hasCurrentRecordingConfirmation,
}
