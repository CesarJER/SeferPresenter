import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { applyAction, getTimeline } from './timelineManager.mjs'
import { hasAllowedRequestOrigin, isAuthRequired, hasValidBasicAuth } from './authUtils.mjs'
import {
  isValidParticipantId,
  isValidBase64,
  validatePrivateControlSignal,
  validateParticipantStatus,
  validateActiveParticipantProfile,
  validateModerationMessage,
  validateLargePresentationMessage,
  WS_ORDINARY_PAYLOAD_BYTES,
  microphonePermissionStates,
  microphoneTrackStates,
  liveAudioConnectionStates,
} from './ws-message-validation.mjs'
import {
  makeOperationalParticipantSnapshot,
  makeReducedParticipantStatus,
} from './ws-participant-snapshots.mjs'

const wsClients = new Map()
export const authorizeOperatorCredential = (req, { controlOnly = false } = {}) => {
  const credential = req.headers?.['x-sefer-operator-credential']
  if (typeof credential !== 'string' || !/^[0-9a-f]{64}$/.test(credential)) return null
  for (const meta of wsClients.values()) {
    if (meta.ws.readyState !== WebSocket.OPEN || !meta.operatorCredential) continue
    if (!timingSafeEqual(Buffer.from(credential), Buffer.from(meta.operatorCredential))) continue
    if (meta.role === 'control' && isControlAuthorized(liveAudioControls.get(meta.controlSessionId))) return meta
    if (!controlOnly && meta.role === 'presenter') return meta
  }
  return null
}
const roles = new Set(['presenter', 'control', 'audience', 'unknown'])
const liveAudioControls = new Map()
const liveAudioParticipants = new Map()
const audienceAccessRecords = new Map()
const audienceSseTickets = new Map()
let presentationSessionId = randomUUID()
let liveAudioControlPublicKeyMessage = null
const getDefaultExternalBroadcastState = () => {
  const def = process.env.VITE_SEFER_PUBLICABLE_DEFAULT?.toLowerCase()
  if (def === 'recording' || def === 'live') return def
  return 'off'
}

let externalBroadcastState = {
  state: getDefaultExternalBroadcastState(),
  revision: 0,
  updatedAt: Date.now(),
}
const PRIVATE_CONTROL_SIGNAL_RATE_LIMIT = 5
const PRIVATE_CONTROL_SIGNAL_RATE_WINDOW_MS = 60_000
const WS_MAX_PAYLOAD_BYTES = 512 * 1024
const WS_MAX_BUFFERED_BYTES = 512 * 1024
const audienceAllowedTypes = new Set([
  'SERVER_TIME_PING',
  'AUDIENCE_ACCESS_BIND',
  'AUDIENCE_ACCESS_REQUEST',
  'AUDIENCE_ACCESS_LEAVE',
  'LIVE_AUDIO_PARTICIPANT_STATUS',
  'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
  'PRIVATE_CONTROL_SIGNAL',
  'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
])
const admittedAudienceOnlyTypes = new Set([
  'LIVE_AUDIO_PARTICIPANT_STATUS',
  'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
  'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
])

const makeRole = (value) => roles.has(value) ? value : 'unknown'

const getControlCodeTtlMs = () => {
  const raw = Number.parseInt(process.env.SEFER_LIVE_AUDIO_CONTROL_CODE_TTL_SECONDS || '90', 10)
  const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120) : 90
  return seconds * 1000
}

const allowDelegatedModerators = () =>
  String(process.env.SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS || 'true').toLowerCase() !== 'false'

const getDefaultModerationVisible = () =>
  String(process.env.SEFER_ACTIVE_ALIAS_MODERATION_DEFAULT_VISIBLE || 'true').toLowerCase() !== 'false'

const getDefaultActiveListAccessForPublicProfiles = () =>
  String(process.env.SEFER_ACTIVE_LIST_DEFAULT_FOR_PUBLIC_PROFILES || 'false').toLowerCase() === 'true'

const getDefaultAccessMode = () =>
  String(process.env.SEFER_SESSION_ACCESS_DEFAULT || 'PUBLIC').toUpperCase() === 'CONTROLLED'
    ? 'CONTROLLED'
    : 'PUBLIC'

let accessMode = getDefaultAccessMode()

const createAudienceCredential = () => randomBytes(32).toString('base64url')
const hashAudienceCredential = (credential) => createHash('sha256').update(credential, 'utf8').digest()

const findAudienceAccessByCredential = (credential) => {
  if (typeof credential !== 'string' || credential.length < 32) return null
  const candidate = hashAudienceCredential(credential)
  for (const record of audienceAccessRecords.values()) {
    if (record.credentialHash.length === candidate.length && timingSafeEqual(record.credentialHash, candidate)) {
      return record
    }
  }
  return null
}

const makeAudienceAccessState = (record) => ({
  presentationSessionId,
  accessMode,
  participantId: record.participantId,
  accessState: record.accessState,
  retryAt: record.retryAt,
})

const bootstrapAudienceAccess = (credential) => {
  const existing = findAudienceAccessByCredential(credential)
  if (existing) return { ...makeAudienceAccessState(existing), credential: undefined }

  const nextCredential = createAudienceCredential()
  const record = {
    participantId: randomUUID(),
    credentialHash: hashAudienceCredential(nextCredential),
    accessState: accessMode === 'PUBLIC' ? 'ADMITTED' : 'REQUEST_REQUIRED',
    hasAlias: false,
    retryAt: undefined,
    createdAt: Date.now(),
  }
  audienceAccessRecords.set(record.participantId, record)
  return { ...makeAudienceAccessState(record), credential: nextCredential }
}

const authorizeAudienceCredential = (credential, { requireAdmitted = true } = {}) => {
  const record = findAudienceAccessByCredential(credential)
  if (!record) return null
  if (requireAdmitted && accessMode === 'CONTROLLED' && record.accessState !== 'ADMITTED') return null
  return record
}

const issueAudienceSseTicket = (credential, purpose) => {
  const record = authorizeAudienceCredential(credential)
  if (!record || (purpose !== 'STATE' && purpose !== 'QUIZ')) return null
  const ticket = randomBytes(24).toString('base64url')
  audienceSseTickets.set(ticket, {
    participantId: record.participantId,
    purpose,
    expiresAt: Date.now() + 30_000,
  })
  return ticket
}

const consumeAudienceSseTicket = (ticket, purpose) => {
  if (typeof ticket !== 'string') return null
  const issued = audienceSseTickets.get(ticket)
  audienceSseTickets.delete(ticket)
  if (!issued || issued.purpose !== purpose || issued.expiresAt <= Date.now()) return null
  const record = audienceAccessRecords.get(issued.participantId)
  if (!record || (accessMode === 'CONTROLLED' && record.accessState !== 'ADMITTED')) return null
  return record
}

const getSessionAccessMode = () => accessMode

const mergeOperationalSnapshotPatch = (patch) => {
  if (!patch || typeof patch !== 'object') return

  if (Array.isArray(patch.participants)) {
    for (const participant of patch.participants) {
      if (!participant || typeof participant !== 'object' || !isValidParticipantId(participant.participantId)) continue
      const storedParticipant = liveAudioParticipants.get(participant.participantId)
      if (!storedParticipant) continue
      if (microphonePermissionStates.has(participant.microphonePermissionState)) {
        storedParticipant.microphonePermissionState = participant.microphonePermissionState
      }
      if (microphoneTrackStates.has(participant.microphoneTrackState)) {
        storedParticipant.microphoneTrackState = participant.microphoneTrackState
      }
      if (typeof participant.isAliasVisibleToActiveParticipants === 'boolean') {
        storedParticipant.isAliasVisibleToActiveParticipants = participant.isAliasVisibleToActiveParticipants
        storedParticipant.updatedAt = Date.now()
        if (storedParticipant.isAliasHiddenByControl === undefined) {
          storedParticipant.isAliasHiddenByControl = !getDefaultModerationVisible()
        }
      }
    }
  }
}

const getRejoinGraceMs = () => {
  const raw = Number.parseInt(process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS || '60', 10)
  const seconds = Number.isFinite(raw) && raw >= 0 ? raw : 60
  return seconds * 1000
}

const generateVerificationCode = () => {
  const number = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')
  return `${number.slice(0, 3)}-${number.slice(3)}`
}

const isControlAuthorized = (control) =>
  control?.controlState === 'PRINCIPAL' || control?.controlState === 'AUTHORIZED'

const findPrincipalControl = () =>
  Array.from(liveAudioControls.values()).find((control) => control.controlState === 'PRINCIPAL') || null

const getPendingControls = () => {
  const now = Date.now()
  return Array.from(liveAudioControls.values())
    .filter((control) => control.controlState === 'PENDING' && control.codeExpiresAt > now)
    .map((control) => ({
      controlSessionId: control.controlSessionId,
      verificationCode: control.verificationCode,
      codeExpiresAt: control.codeExpiresAt,
      connectedAt: control.connectedAt,
    }))
}

const canAuthorizeControls = (control) => {
  if (!control) return false
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
    codeExpiresAt: control.controlState === 'PENDING' ? control.codeExpiresAt : undefined,
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
    activeListPublicKey: participant.activeListPublicKey,
    liveAudioConnectionState: participant.liveAudioConnectionState,
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

const makeOperationalSnapshot = ({ liveKitState, quizAggregate } = {}) => {
  const participants = Array.from(liveAudioParticipants.values()).map((participant) =>
    makeOperationalParticipantSnapshot(participant))
  return {
    snapshotId: `snapshot-${Date.now()}-${randomUUID()}`,
    createdAt: Date.now(),
    connectionCounts: getConnectionCountsSnapshot(),
    participants,
    interventionQueue: participants
      .filter((participant) => participant.speakerState === 'REQUESTED' && !participant.isKicked)
      .map((participant) => participant.participantId),
    policies: { accessMode },
    audienceAccessRequests: Array.from(audienceAccessRecords.values())
      .filter((record) => record.accessState === 'WAITING' || record.accessState === 'BLOCKED')
      .map((record) => ({
        participantId: record.participantId,
        requestedAt: record.requestedAt || record.createdAt,
        accessState: record.accessState,
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
      meta.cleanup()
      client.terminate()
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
    activeListPublicKey: participant.activeListPublicKey,
    liveAudioConnectionState: participant.liveAudioConnectionState,
    connected: Boolean(participant.ws && participant.ws.readyState === WebSocket.OPEN),
    disconnectedAt: participant.disconnectedAt,
    updatedAt: participant.updatedAt,
  }
}

const resetWsServerStateForTests = () => {
  for (const control of liveAudioControls.values()) {
    clearTimeout(control.expiryTimer)
  }
  for (const participant of liveAudioParticipants.values()) {
    clearTimeout(participant.cleanupTimer)
  }
  wsClients.clear()
  liveAudioControls.clear()
  liveAudioParticipants.clear()
  audienceAccessRecords.clear()
  audienceSseTickets.clear()
  liveAudioControlPublicKeyMessage = null
  externalBroadcastState = { state: getDefaultExternalBroadcastState(), revision: 0, updatedAt: Date.now() }
  accessMode = getDefaultAccessMode()
}

const createWsServer = (httpServer, onFallbackMessage, snapshotProviders = {}) => {
  if (snapshotProviders.presentationSessionStore) {
    presentationSessionId = snapshotProviders.presentationSessionStore.getSessionId()
  }
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: WS_MAX_PAYLOAD_BYTES,
  })

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
  })

  const broadcast = (message, filter) => {
    const data = typeof message === 'string' ? message : JSON.stringify(message)
    for (const [client, meta] of wsClients) {
      if (client.readyState !== WebSocket.OPEN) continue
      if (filter && !filter(meta)) continue
      if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
        meta.cleanup()
        client.close(1013, 'Slow consumer')
        continue
      }
      try {
        client.send(data)
      } catch {
        meta.cleanup()
        client.terminate()
      }
    }
  }

  const sendJson = (client, message) => {
    if (client.readyState !== WebSocket.OPEN) return false
    if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
      wsClients.get(client)?.cleanup()
      client.close(1013, 'Slow consumer')
      return false
    }
    try {
      client.send(JSON.stringify(message))
      return true
    } catch {
      wsClients.get(client)?.cleanup()
      client.terminate()
      return false
    }
  }

  const makeConnectionCountsMessage = () => ({
    type: 'LIVE_AUDIO_CONNECTION_COUNTS',
    ...getConnectionCountsSnapshot(),
  })

  const broadcastConnectionCounts = () => {
    const message = makeConnectionCountsMessage()
    broadcast(message, (meta) => meta.role === 'presenter' || meta.role === 'control')
    broadcastMediaMasterStatus()
  }

  const sendError = (client, code, message) => {
    sendJson(client, { type: 'ERROR', code, message })
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

  const broadcastAccessPolicy = () => broadcast({
    type: 'SESSION_ACCESS_POLICY',
    presentationSessionId,
    accessMode,
    updatedAt: Date.now(),
  })

  const handleAudienceAccessBind = (meta, msg) => {
    if (meta?.role !== 'audience') return
    const record = authorizeAudienceCredential(msg.credential, { requireAdmitted: false })
    if (!record) {
      sendJson(meta.ws, {
        type: 'AUDIENCE_ACCESS_STATE',
        presentationSessionId,
        accessMode,
        accessState: 'CREDENTIAL_OBSOLETE',
      })
      return
    }
    meta.audienceAccessId = record.participantId
    meta.participantId = record.participantId
    sendAudienceAccessState(meta, record)
    if (liveAudioControlPublicKeyMessage) sendJson(meta.ws, liveAudioControlPublicKeyMessage)
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
    sendAudienceAccessState(meta, record)
    if (record.accessState === 'WAITING') {
      broadcast({
        type: 'AUDIENCE_ACCESS_REQUEST',
        participantId: record.participantId,
        requestedAt: now,
      }, (targetMeta) => (
        targetMeta.role === 'control' &&
        isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
      ))
    }
  }

  const handleAudienceAccessLeave = (meta) => {
    if (meta?.role !== 'audience' || accessMode !== 'CONTROLLED' || !meta.audienceAccessId) return
    const record = audienceAccessRecords.get(meta.audienceAccessId)
    if (!record || record.accessState === 'BLOCKED') return
    record.accessState = 'REQUEST_REQUIRED'
    record.hasAlias = false
    record.requestedAt = undefined
    record.retryAt = undefined
    releaseParticipantConnection(meta)
    meta.participantId = meta.audienceAccessId
    notifyAudienceAccessRecord(record)
    snapshotProviders.invalidateAudienceStreams?.()
  }

  const handleAudienceAccessDecision = (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    if (!isControlAuthorized(issuer)) return
    const record = audienceAccessRecords.get(msg.participantId)
    if (!record || !['ADMIT', 'REJECT', 'BLOCK', 'UNBLOCK'].includes(msg.decision)) return
    if (msg.decision === 'ADMIT') {
      record.accessState = 'ADMITTED'
      record.retryAt = undefined
    } else if (msg.decision === 'REJECT') {
      record.accessState = 'REJECTED'
      record.retryAt = Date.now() + 30_000
    } else if (msg.decision === 'UNBLOCK') {
      record.accessState = 'WAITING'
      record.retryAt = undefined
    } else {
      record.accessState = 'BLOCKED'
      record.retryAt = undefined
    }
    notifyAudienceAccessRecord(record)
    snapshotProviders.invalidateAudienceStreams?.()
    broadcast({
      type: 'AUDIENCE_ACCESS_DECISION_RESULT',
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
    if (issuer?.controlState !== 'PRINCIPAL' || !['PUBLIC', 'CONTROLLED'].includes(msg.accessMode)) {
      sendError(meta.ws, 'SESSION_POLICY_FORBIDDEN', 'Only the principal Control may change access mode')
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
      notifyAudienceAccessRecord(record)
    }
    audienceSseTickets.clear()
    snapshotProviders.invalidateAudienceStreams?.()
    broadcastAccessPolicy()
  }

  const sendAuthorizationState = (control) => {
    const principal = findPrincipalControl()
    const message = {
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE',
      controlSessionId: control.controlSessionId,
      controlState: control.controlState,
      principalControlSessionId: principal?.controlSessionId,
      allowDelegatedModerators: allowDelegatedModerators(),
      updatedAt: Date.now(),
    }

    if (control.controlState === 'PENDING') {
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
    if (!isControlAuthorized(control)) return false
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
    }

    broadcastAuthorizationState()
  }

  const removeControl = (controlSessionId) => {
    const control = liveAudioControls.get(controlSessionId)
    if (!control) return
    clearTimeout(control.expiryTimer)
    const wasPrincipal = control.controlState === 'PRINCIPAL'
    liveAudioControls.delete(controlSessionId)
    if (wasPrincipal) {
      promoteSuccessorIfNeeded()
    } else {
      broadcastAuthorizationState()
    }
  }

  const expirePendingControl = (controlSessionId) => {
    const control = liveAudioControls.get(controlSessionId)
    if (!control || control.controlState !== 'PENDING') return
    control.verificationCode = undefined
    control.codeExpiresAt = Date.now()
    sendAuthorizationState(control)
    broadcastAuthorizationState()
  }

  const registerControl = (ws, clientId, requestedControlSessionId) => {
    const connectedAt = Date.now()
    const controlSessionId = requestedControlSessionId && !liveAudioControls.has(requestedControlSessionId) ? requestedControlSessionId : `control-${randomUUID()}`
    const hasPrincipal = Boolean(findPrincipalControl())
    const control = {
      ws,
      clientId,
      controlSessionId,
      connectedAt,
      authorizedAt: hasPrincipal ? 0 : connectedAt,
      controlState: hasPrincipal ? 'PENDING' : 'PRINCIPAL',
      verificationCode: undefined,
      codeExpiresAt: undefined,
    }

    if (control.controlState === 'PENDING') {
      control.verificationCode = generateVerificationCode()
      control.codeExpiresAt = connectedAt + getControlCodeTtlMs()
      control.expiryTimer = setTimeout(() => expirePendingControl(controlSessionId), getControlCodeTtlMs())
      control.expiryTimer.unref?.()
    }

    liveAudioControls.set(controlSessionId, control)
    return control
  }

  const handleAuthorizationDecision = (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    const target = liveAudioControls.get(msg.targetControlSessionId)

    if (!canAuthorizeControls(issuer)) {
      sendError(meta.ws, 'CONTROL_AUTH_FORBIDDEN', 'Control is not allowed to authorize other controls')
      return
    }

    if (!target || target.controlState !== 'PENDING') {
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
      clearTimeout(target.expiryTimer)
      target.controlState = 'AUTHORIZED'
      target.authorizedAt = Date.now()
      target.verificationCode = undefined
      target.codeExpiresAt = undefined
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
      wsClients.delete(target.ws)
      target.ws.close(4003, 'Control authorization rejected')
    }

    broadcastAuthorizationState()
  }

  const forwardToAuthorizingControls = (msg, sourceControl) => {
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
    if (!isControlAuthorized(issuer) || !target) return
    sendJson(target.ws, {
      ...msg,
      authorizedByControlSessionId: issuer.controlSessionId,
      createdAt: msg.createdAt || Date.now(),
    })
  }

  const routePrivateControlSignalToControls = (msg) => {
    broadcast(msg, (clientMeta) => {
      if (clientMeta.role === 'control') {
        const control = liveAudioControls.get(clientMeta.controlSessionId)
        if (isControlAuthorized(control)) {
          return true
        }
      }
      return false
    })
  }

  const routePrivateControlSignalToParticipant = (msg) => {
    broadcast(msg, (meta) => (
      meta.role === 'audience' &&
      (meta.participantId === msg.toParticipantId || meta.audienceAccessId === msg.toParticipantId)
    ))
  }

  const bindParticipantToConnection = (meta, participantId, status = {}) => {
    if (!isValidParticipantId(participantId)) return null
    const registered = snapshotProviders.getLiveKitState?.()?.participants?.find((participant) => participant.participantId === participantId)
    if (meta.role === 'control' && registered?.controlSessionId && registered.controlSessionId !== meta.controlSessionId) return null
    const isNewParticipantId = meta.participantId && meta.participantId !== participantId
    if (isNewParticipantId) {
      const isAllowedAccessTransition = meta.role === 'audience' && (
        meta.participantId === meta.audienceAccessId ||
        participantId === meta.audienceAccessId
      )
      if (!isAllowedAccessTransition && !(meta.role === 'control' && registered?.controlSessionId && registered.controlSessionId === meta.controlSessionId)) return null
      const accessParticipant = liveAudioParticipants.get(meta.participantId)
      if (accessParticipant?.ws === meta.ws) {
        liveAudioParticipants.delete(meta.participantId)
      }
    }

    const existing = liveAudioParticipants.get(participantId)
    if (existing && existing.ws && existing.ws !== meta.ws && existing.ws.readyState === WebSocket.OPEN) {
      return null
    }

    if (existing?.cleanupTimer) {
      clearTimeout(existing.cleanupTimer)
    }

    const now = Date.now()
    const isKicked = existing?.isKicked === true
    const canPublishAudio = !isKicked && (registered ? registered.canPublish === true : existing?.canPublishAudio === true)
    const speakerState = isKicked
      ? 'REVOKED'
      : canPublishAudio
        ? 'GRANTED'
        : status.speakerState === 'REQUESTED'
          ? 'REQUESTED'
          : 'LISTENER'
    const isMicrophoneActive = !canPublishAudio
      ? false
      : typeof status.isMicrophoneActive === 'boolean'
        ? status.isMicrophoneActive
        : existing?.isMicrophoneActive ?? false
    const participant = {
      participantId,
      role: meta.role,
      clientId: meta.clientId,
      ws: meta.ws,
      speakerState,
      canSubscribe: registered?.canSubscribe ?? existing?.canSubscribe ?? true,
      canPublishAudio,
      isMuted: !canPublishAudio ? true : typeof status.isMuted === 'boolean' ? status.isMuted : existing?.isMuted ?? true,
      isActiveAudience: isKicked ? false : typeof status.isActiveAudience === 'boolean' ? status.isActiveAudience : existing?.isActiveAudience ?? false,
      isMicrophoneActive,
      isKicked,
      isAliasVisibleToActiveParticipants: existing?.isAliasVisibleToActiveParticipants ?? false,
      canViewActiveParticipants: existing?.canViewActiveParticipants ?? false,
      isAliasHiddenByControl: existing?.isAliasHiddenByControl ?? !getDefaultModerationVisible(),
      activeListPublicKey: existing?.activeListPublicKey,
      microphonePermissionState: typeof status.microphonePermissionState === 'string'
        ? status.microphonePermissionState
        : existing?.microphonePermissionState || 'unknown',
      microphoneTrackState: typeof status.microphoneTrackState === 'string'
        ? status.microphoneTrackState
        : existing?.microphoneTrackState,
      liveAudioConnectionState: liveAudioConnectionStates.has(status.liveAudioConnectionState)
        ? status.liveAudioConnectionState
        : existing?.liveAudioConnectionState,
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
      disconnectedAt: undefined,
      cleanupDueAt: undefined,
      cleanupTimer: undefined,
      privateSignalTimestamps: existing?.privateSignalTimestamps || [],
    }
    liveAudioParticipants.set(participantId, participant)
    meta.participantId = participantId
    if (isNewParticipantId && liveAudioControlPublicKeyMessage && meta.role === 'audience') {
      sendJson(meta.ws, liveAudioControlPublicKeyMessage)
    }
    return participant
  }

  const releaseParticipantConnection = (meta) => {
    if (meta?.role !== 'audience' || !meta.participantId) return
    const participantId = meta.participantId
    const participant = liveAudioParticipants.get(participantId)
    if (!participant || participant.ws !== meta.ws) return

    participant.ws = null
    participant.disconnectedAt = Date.now()
    participant.cleanupDueAt = participant.disconnectedAt + getRejoinGraceMs()
    clearTimeout(participant.cleanupTimer)
    participant.cleanupTimer = setTimeout(() => cleanupExpiredParticipant(participantId), getRejoinGraceMs())
    participant.cleanupTimer.unref?.()

    broadcast({
      ...makeReducedParticipantStatus(participant),
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
    routeParticipantStatus(releasedStatus)
    broadcast({
      type: 'LIVE_AUDIO_REVOKE_SPEAK',
      participantId,
      createdAt: Date.now(),
    }, (targetMeta) => {
      if (targetMeta.role === 'presenter') return true
      if (targetMeta.role !== 'control') return false
      return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    })
    liveAudioParticipants.delete(participantId)
  }

  const sweepExpiredParticipants = () => {
    const now = Date.now()
    for (const participant of liveAudioParticipants.values()) {
      if (participant.ws === null && participant.cleanupDueAt && participant.cleanupDueAt <= now) {
        cleanupExpiredParticipant(participant.participantId)
      }
    }
  }

  const canAcceptPrivateSignal = (meta, msg) => {
    const participant = bindParticipantToConnection(meta, msg.fromParticipantId)
    if (!participant) return false

    const now = Date.now()
    participant.privateSignalTimestamps = participant.privateSignalTimestamps
      .filter((timestamp) => now - timestamp < PRIVATE_CONTROL_SIGNAL_RATE_WINDOW_MS)
    if (participant.privateSignalTimestamps.length >= PRIVATE_CONTROL_SIGNAL_RATE_LIMIT) return false

    participant.privateSignalTimestamps.push(now)
    participant.updatedAt = now
    return true
  }

  const canAcceptControlPrivateSignal = (meta, msg) => {
    const control = liveAudioControls.get(meta.controlSessionId)
    if (!isControlAuthorized(control)) return false
    if (!msg.toParticipantId) return true
    const participant = liveAudioParticipants.get(msg.toParticipantId)
    if (
      participant &&
      participant.role === 'audience' &&
      participant.ws &&
      participant.ws.readyState === WebSocket.OPEN
    ) {
      return true
    }
    for (const wsMeta of wsClients.values()) {
      if (
        wsMeta.role === 'audience' &&
        (wsMeta.audienceAccessId === msg.toParticipantId || wsMeta.participantId === msg.toParticipantId) &&
        wsMeta.ws &&
        wsMeta.ws.readyState === WebSocket.OPEN
      ) {
        return true
      }
    }
    return false
  }

  const routeParticipantStatus = (msg) => {
    const reduced = makeReducedParticipantStatus(msg)
    broadcast(reduced, (targetMeta) => {
      if (targetMeta.role === 'presenter') return true
      if (targetMeta.role !== 'control') return false
      return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    })
  }

  const applyModerationState = (msg) => {
    const now = Date.now()
    const update = (participantId, patch) => {
      const participant = liveAudioParticipants.get(participantId)
      if (!participant) return
      Object.assign(participant, patch, { updatedAt: now })
      routeParticipantStatus(makeReducedParticipantStatus(participant))
    }

    switch (msg.type) {
      case 'LIVE_AUDIO_GRANT_SPEAK':
        update(msg.participantId, {
          speakerState: 'GRANTED',
          canPublishAudio: true,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
          microphoneTrackState: 'off',
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
          microphoneTrackState: 'off',
        })
        break
      case 'LIVE_AUDIO_MUTE_PARTICIPANT':
        update(msg.participantId, {
          speakerState: 'GRANTED',
          isMuted: true,
          canPublishAudio: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
          microphoneTrackState: 'mutedByControl',
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
          microphoneTrackState: 'off',
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
            canPublishAudio: true,
            isActiveAudience: true,
            isMicrophoneActive: false,
            isKicked: false,
            microphoneTrackState: 'mutedByControl',
          })
        }
        break
      }
      default:
        break
    }
  }

  let externalBroadcastUpdatePending = false
  let externalBroadcastRequestVersion = 0
  const setExternalBroadcastState = async (nextState) => {
    if (!['off', 'live', 'recording'].includes(nextState)) return false
    if (externalBroadcastUpdatePending && nextState !== 'off') return false
    const requestVersion = ++externalBroadcastRequestVersion
    if (externalBroadcastState.state === nextState) return true
    if (nextState !== 'off') {
      externalBroadcastUpdatePending = true
      try {
        if (await snapshotProviders.revokeAllLiveKitSpeakers?.() === false) return false
      } catch {
        return false
      } finally {
        externalBroadcastUpdatePending = false
      }
      if (requestVersion !== externalBroadcastRequestVersion) return false
    }

    const previousState = externalBroadcastState.state
    externalBroadcastState = {
      state: nextState,
      revision: externalBroadcastState.revision + 1,
      updatedAt: Date.now(),
    }

    void snapshotProviders.recordExternalBroadcastTransition?.({
      previousState,
      nextState,
      revision: externalBroadcastState.revision,
      updatedAt: externalBroadcastState.updatedAt,
    })

    if (nextState !== 'off') {
      for (const participant of liveAudioParticipants.values()) {
        if (participant.role !== 'audience' || participant.isKicked) continue
        if (
          participant.speakerState !== 'GRANTED' &&
          participant.canPublishAudio !== true &&
          participant.isMicrophoneActive !== true
        ) continue
        Object.assign(participant, {
          speakerState: 'LISTENER',
          canPublishAudio: false,
          isMuted: true,
          isMicrophoneActive: false,
          updatedAt: Date.now(),
        })
        routeParticipantStatus(participant)
        if (participant.ws?.readyState === WebSocket.OPEN) {
          sendJson(participant.ws, {
            type: 'LIVE_AUDIO_REVOKE_SPEAK',
            participantId: participant.participantId,
            createdAt: Date.now(),
          })
        }
      }
    }

    broadcast({ type: 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE', ...externalBroadcastState })
    return true
  }

  const routeControlPublicKey = (msg, issuer) => {
    if (!isControlAuthorized(issuer)) return
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

  const rotatePresentationSession = ({ hardRefresh = false } = {}) => {
    // Persist the new boundary before clearing state or notifying any client.
    const nextSessionId = snapshotProviders.presentationSessionStore?.rotate() || randomUUID()
    presentationSessionId = nextSessionId
    for (const control of liveAudioControls.values()) clearTimeout(control.expiryTimer)
    liveAudioControls.clear()
    liveAudioParticipants.clear()
    audienceAccessRecords.clear()
    audienceSseTickets.clear()
    snapshotProviders.invalidateAudienceStreams?.()
    accessMode = getDefaultAccessMode()
    setExternalBroadcastState('off')
    broadcastConnectionCounts()
    broadcastAuthorizationState()
    broadcast({ type: 'PRESENTATION_SESSION_ROTATED', presentationSessionId, hardRefresh: hardRefresh === true })
    resetPrivateControlSession()
    for (const [ws, meta] of wsClients) {
      if (meta.role !== 'control' && meta.role !== 'presenter') continue
      wsClients.delete(ws)
      ws.close(1012, 'Presentation session rotated')
    }
    console.log('[SERVER] Presentation session rotated')
  }
  wss.rotatePresentationSession = rotatePresentationSession

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
    const control = role === 'control'
      ? registerControl(ws, clientId, url.searchParams.get('controlSessionId'))
      : null
    const meta = {
      role,
      clientId,
      ws,
      controlSessionId: control?.controlSessionId,
      operatorCredential: role === 'control' || role === 'presenter' ? randomBytes(32).toString('hex') : undefined,
    }
    let cleanedUp = false
    meta.cleanup = () => {
      // Retain socket identity even when rotation/rejection already retired metadata.
      if (cleanedUp) return
      cleanedUp = true
      wsClients.delete(ws)
      if (meta.role === 'control' && liveAudioControls.get(meta.controlSessionId)?.ws === ws) {
        removeControl(meta.controlSessionId)
      }
      releaseParticipantConnection(meta)
      broadcastConnectionCounts()
      broadcastMediaMasterStatus()
    }
    wsClients.set(ws, meta)
    ws.on('close', meta.cleanup)
    ws.on('error', () => {
      meta.cleanup()
      if (ws.readyState === WebSocket.OPEN) ws.terminate()
    })

    ws.send(JSON.stringify({
      type: 'WELCOME',
      clientId,
      serverTimeMs: Date.now(),
      role,
      controlSessionId: control?.controlSessionId,
      controlState: control?.controlState,
      operatorCredential: meta.operatorCredential,
      presentationSessionId,
      accessMode,
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

    ws.send(JSON.stringify({
      type: 'AUDIO_TIMELINE_STATE',
      timeline: getTimeline(),
    }))
    ws.send(JSON.stringify({
      type: 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE',
      ...externalBroadcastState,
    }))

    ws.on('message', (raw) => {
      const meta = wsClients.get(ws)
      if (!meta) return
      const large = raw.length > WS_ORDINARY_PAYLOAD_BYTES
      const rejectLarge = () => {
        meta.cleanup()
        ws.close(1009)
      }
      if (large && (meta.role !== 'presenter' &&
          (meta.role !== 'control' || !isControlAuthorized(liveAudioControls.get(meta.controlSessionId))))) {
        rejectLarge()
        return
      }
      let msg
      try {
        msg = JSON.parse(raw.toString())
        if (large && !validateLargePresentationMessage(msg, meta.role, raw.length)) {
          rejectLarge()
          return
        }
      } catch {
        if (large) rejectLarge()
        return
      }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return

      if (meta.role === 'unknown' && msg.type !== 'SERVER_TIME_PING') {
        return
      }
      if (meta.role === 'audience' && !audienceAllowedTypes.has(msg.type)) {
        return
      }
      if (
        meta.role === 'audience' &&
        accessMode === 'CONTROLLED' &&
        admittedAudienceOnlyTypes.has(msg.type)
      ) {
        const record = meta.audienceAccessId
          ? audienceAccessRecords.get(meta.audienceAccessId)
          : null
        if (record?.accessState !== 'ADMITTED') return
      }

      switch (msg.type) {
        case 'SERVER_TIME_PING':
          ws.send(JSON.stringify({
            type: 'SERVER_TIME_PONG',
            clientSentAtMs: msg.clientSentAtMs,
            serverTimeMs: Date.now(),
          }))
          break

        case 'AUDIO_TIMELINE_ACTION': {
          if (meta?.role === 'presenter' && (msg.action?.type === 'SET_DURATION' || msg.action?.type === 'END')) {
            const timeline = applyAction(msg.action)
            broadcast({
              type: 'AUDIO_TIMELINE_STATE',
              timeline,
            })
            break
          }
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
          })
          break
        }

        case 'PRIVATE_CONTROL_SIGNAL':
          if (meta.role === 'audience') {
            if (!validatePrivateControlSignal(msg, 'audience')) break
            if (!canAcceptPrivateSignal(meta, msg)) break
            routePrivateControlSignalToControls(msg)
            break
          }
          if (meta.role === 'control') {
            const controlMeta = liveAudioControls.get(meta.controlSessionId)
            if (!isControlAuthorized(controlMeta)) {
              sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot send private signals')
              break
            }
            if (!validatePrivateControlSignal(msg, 'control')) break
            if (!canAcceptControlPrivateSignal(meta, msg)) break
            
            if (msg.toParticipantId) {
              routePrivateControlSignalToParticipant(msg)
            } else {
              routePrivateControlSignalToControls(msg)
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
              participant.activeListPublicKey = undefined
            }
            routeParticipantStatus(participant)
          }
          break

        case 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE': {
          if (meta.role !== 'audience') break
          if (!validateActiveParticipantProfile(msg)) break
          const existing = liveAudioParticipants.get(msg.participantId)
          const isInitialActiveJoin = !existing || !existing.isActiveAudience
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
          const accessRecord = audienceAccessRecords.get(meta.audienceAccessId)
          if (accessRecord) accessRecord.hasAlias = true
          participant.isAliasVisibleToActiveParticipants = msg.isAliasVisibleToActiveParticipants
          participant.activeListPublicKey = msg.activeListPublicKey
          if (isInitialActiveJoin) {
            participant.canViewActiveParticipants = msg.isAliasVisibleToActiveParticipants && getDefaultActiveListAccessForPublicProfiles()
          }
          participant.updatedAt = Date.now()
          routeParticipantStatus(participant)
          broadcast({
            type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE',
            participantId: msg.participantId,
            activeListPublicKey: msg.activeListPublicKey,
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
          mergeOperationalSnapshotPatch(msg.snapshot)
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
          if (msg.canViewActiveParticipants && (!participant.isActiveAudience || !participant.activeListPublicKey)) {
            sendError(ws, 'ACTIVE_AUDIENCE_REQUIRED', 'Only an active Audience participant can receive the active list')
            break
          }
          participant.canViewActiveParticipants = msg.canViewActiveParticipants
          participant.updatedAt = Date.now()
          if (participant.ws?.readyState === WebSocket.OPEN) {
            sendJson(participant.ws, {
              type: 'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION',
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

        case 'AUDIENCE_ACCESS_BIND':
          handleAudienceAccessBind(meta, msg)
          break

        case 'AUDIENCE_ACCESS_REQUEST':
          handleAudienceAccessRequest(meta, msg)
          break

        case 'AUDIENCE_ACCESS_LEAVE':
          handleAudienceAccessLeave(meta)
          break

        case 'AUDIENCE_ACCESS_DECISION':
          if (meta.role === 'control') handleAudienceAccessDecision(meta, msg)
          break

        case 'SESSION_ACCESS_POLICY_UPDATE':
          if (meta.role === 'control') handleSessionAccessPolicyUpdate(meta, msg)
          break

        case 'LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot change the external broadcast state')
            break
          }
          if (!['off', 'live', 'recording'].includes(msg.state)) break
          void setExternalBroadcastState(msg.state).then((accepted) => {
            if (!accepted) sendError(ws, 'LIVEKIT_PERMISSION_NOT_CONFIRMED', 'LiveKit could not revoke all microphones; retry explicitly')
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
            activeListPublicKey: undefined,
            speakerState: 'LISTENER',
            canPublishAudio: false,
            isMuted: true,
            isMicrophoneActive: false,
            updatedAt: Date.now(),
          })
          routeParticipantStatus(makeReducedParticipantStatus(participant))
          if (participant.ws?.readyState === WebSocket.OPEN) {
            sendJson(participant.ws, {
              type: 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
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
          {
            const resetsSession = msg.payload?.command === 'RESET_STATE' && msg.payload.clearSession === true
            let rotated = false
            const beforeSessionReset = () => {
              if (rotated) return
              rotatePresentationSession(msg.payload)
              rotated = true
            }
            try {
              const accepted = onFallbackMessage
                ? onFallbackMessage(msg, meta, resetsSession ? beforeSessionReset : undefined) === true
                : false
              if (!accepted) break
              if (resetsSession) beforeSessionReset()
            } catch {
              sendError(ws, 'SESSION_PERSISTENCE_FAILED', 'Presentation session reset could not be persisted')
            }
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
          const expectedCanPublish = ['LIVE_AUDIO_GRANT_SPEAK', 'LIVE_AUDIO_MUTE_PARTICIPANT'].includes(msg.type)
            ? true
            : ['LIVE_AUDIO_REVOKE_SPEAK', 'LIVE_AUDIO_KICK_PARTICIPANT', 'LIVE_AUDIO_RESCUE_PARTICIPANT'].includes(msg.type)
              ? false
              : null
          if (expectedCanPublish !== null) {
            const registered = snapshotProviders.getLiveKitState?.()?.participants?.find(
              (participant) => participant.participantId === msg.participantId,
            )
            if (Boolean(registered?.canPublish) !== expectedCanPublish) {
              sendError(ws, 'LIVEKIT_PERMISSION_NOT_CONFIRMED', 'LiveKit permission update is not confirmed')
              break
            }
          }
          applyModerationState(msg)
          broadcast(msg, (targetMeta) => canReceiveModerationMessage(targetMeta, msg))
          break
        }

        case 'LIVE_AUDIO_REQUEST_ALIASES': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot request aliases')
            break
          }
          if (Array.isArray(msg.targetParticipantIds) && msg.targetParticipantIds.length > 0) {
            const targetSet = new Set(msg.targetParticipantIds)
            broadcast(msg, (targetMeta) => targetMeta.role === 'audience' && targetSet.has(targetMeta.participantId))
          } else {
            broadcast(msg, (targetMeta) => targetMeta.role === 'audience')
          }
          break
        }

        default:
          break
      }
    })
  })

  const heartbeat = setInterval(() => {
    for (const [client, meta] of wsClients) {
      if (client.isAlive === false) {
        meta.cleanup()
        client.terminate()
        continue
      }

      client.isAlive = false
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.ping()
        } catch {
          meta.cleanup()
          client.terminate()
        }
      } else {
        meta.cleanup()
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
  getSessionAccessMode,
}
