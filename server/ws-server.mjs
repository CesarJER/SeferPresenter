import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { applyAction, getTimeline } from './timelineManager.mjs'
import { isAuthRequired, hasValidBasicAuth } from './authUtils.mjs'

const wsClients = new Map()
const roles = new Set(['presenter', 'control', 'audience', 'unknown'])
const liveAudioControls = new Map()
const liveAudioParticipants = new Map()
let liveAudioControlPublicKeyMessage = null
const PRIVATE_CONTROL_SIGNAL_MAX_CIPHERTEXT_BYTES = 4096
const PRIVATE_CONTROL_SIGNAL_RATE_LIMIT = 5
const PRIVATE_CONTROL_SIGNAL_RATE_WINDOW_MS = 60_000
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const speakerStates = new Set(['LISTENER', 'REQUESTED', 'GRANTED', 'MUTED', 'REVOKED'])
const liveAudioModerationTypes = new Set([
  'LIVE_AUDIO_GRANT_SPEAK',
  'LIVE_AUDIO_REVOKE_SPEAK',
  'LIVE_AUDIO_MUTE_PARTICIPANT',
  'LIVE_AUDIO_MUTE_ALL',
  'LIVE_AUDIO_KICK_PARTICIPANT',
])
const audienceAllowedTypes = new Set([
  'SERVER_TIME_PING',
  'LIVE_AUDIO_PARTICIPANT_STATUS',
  'PRIVATE_CONTROL_SIGNAL',
])

const makeRole = (value) => roles.has(value) ? value : 'unknown'

const getControlCodeTtlMs = () => {
  const raw = Number.parseInt(process.env.SEFER_LIVE_AUDIO_CONTROL_CODE_TTL_SECONDS || '90', 10)
  const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120) : 90
  return seconds * 1000
}

const allowDelegatedModerators = () =>
  String(process.env.SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS || 'true').toLowerCase() !== 'false'

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
    connected: Boolean(participant.ws && participant.ws.readyState === WebSocket.OPEN),
    disconnectedAt: participant.disconnectedAt,
    updatedAt: participant.updatedAt,
  })),
})

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
  liveAudioControlPublicKeyMessage = null
}

const createWsServer = (httpServer, onFallbackMessage) => {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  const broadcast = (message, filter) => {
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

  const broadcastExcludeAudience = (message) =>
    broadcast(message, (meta) => meta.role !== 'audience')

  const sendJson = (client, message) => {
    if (client.readyState !== WebSocket.OPEN) return false
    try {
      client.send(JSON.stringify(message))
      return true
    } catch {
      wsClients.delete(client)
      return false
    }
  }

  const makeConnectionCountsMessage = () => {
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
      totalConnections: counts.audienceConnections + counts.controlConnections + counts.presenterConnections,
      ...counts,
      updatedAt: Date.now(),
    }
  }

  const broadcastConnectionCounts = () => {
    const message = makeConnectionCountsMessage()
    broadcast(message, (meta) => meta.role === 'presenter' || meta.role === 'control')
    broadcastMediaMasterStatus()
  }

  const sendError = (client, code, message) => {
    sendJson(client, { type: 'ERROR', code, message })
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

  const broadcastAuthorizationState = () => {
    for (const control of liveAudioControls.values()) {
      sendAuthorizationState(control)
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
    const controlSessionId = requestedControlSessionId || `control-${randomUUID()}`
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

  const isAuthorizedToDecide = (control) => canAuthorizeControls(control)

  const handleAuthorizationDecision = (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    const target = liveAudioControls.get(msg.targetControlSessionId)

    if (!isAuthorizedToDecide(issuer)) {
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
    broadcast(msg, (meta) => {
      if (meta.role !== 'control') return false
      const control = liveAudioControls.get(meta.controlSessionId)
      if (!isControlAuthorized(control)) return false
      return !msg.toControlSessionId || msg.toControlSessionId === control.controlSessionId
    })
  }

  const routePrivateControlSignalToParticipant = (msg) => {
    broadcast(msg, (meta) => (
      meta.role === 'audience' &&
      meta.participantId === msg.toParticipantId
    ))
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
    if (senderRole === 'control' && !isValidParticipantId(msg.toParticipantId)) return false
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
    if (msg.updatedAt !== undefined && (typeof msg.updatedAt !== 'number' || !Number.isFinite(msg.updatedAt))) return false
    return msg.alias === undefined
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
    const speakerState = isKicked
      ? 'REVOKED'
      : typeof status.speakerState === 'string'
        ? status.speakerState
        : existing?.speakerState || 'LISTENER'
    const isMicrophoneActive = isKicked
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
      canSubscribe: typeof status.canSubscribe === 'boolean' ? status.canSubscribe : existing?.canSubscribe ?? true,
      canPublishAudio: isKicked ? false : typeof status.canPublishAudio === 'boolean' ? status.canPublishAudio : existing?.canPublishAudio ?? false,
      isMuted: isKicked ? true : typeof status.isMuted === 'boolean' ? status.isMuted : existing?.isMuted ?? false,
      isActiveAudience: isKicked ? false : typeof status.isActiveAudience === 'boolean' ? status.isActiveAudience : existing?.isActiveAudience ?? false,
      isMicrophoneActive,
      isKicked,
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
      disconnectedAt: undefined,
      cleanupDueAt: undefined,
      cleanupTimer: undefined,
      privateSignalTimestamps: existing?.privateSignalTimestamps || [],
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
    updatedAt: msg.updatedAt || Date.now(),
  })

  const routeParticipantStatus = (msg) => {
    const reduced = makeReducedParticipantStatus(msg)
    broadcast(reduced, (targetMeta) => {
      if (targetMeta.role === 'presenter') return true
      if (targetMeta.role !== 'control') return false
      return isControlAuthorized(liveAudioControls.get(targetMeta.controlSessionId))
    })
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
          canPublishAudio: true,
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
          })
        }
        break
      }
      default:
        break
    }
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

  wss.on('connection', (ws, req) => {
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const role = makeRole(url.searchParams.get('role') || 'unknown')

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
    }
    wsClients.set(ws, meta)

    ws.send(JSON.stringify({
      type: 'WELCOME',
      clientId,
      serverTimeMs: Date.now(),
      role,
      controlSessionId: control?.controlSessionId,
      controlState: control?.controlState,
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

    if (role !== 'audience') {
      ws.send(JSON.stringify({
        type: 'AUDIO_TIMELINE_STATE',
        timeline: getTimeline(),
      }))
    }

    ws.on('message', (raw) => {
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

      switch (msg.type) {
        case 'SERVER_TIME_PING':
          ws.send(JSON.stringify({
            type: 'SERVER_TIME_PONG',
            clientSentAtMs: msg.clientSentAtMs,
            serverTimeMs: Date.now(),
          }))
          break

        case 'AUDIO_TIMELINE_ACTION': {
          if (meta?.role === 'audience') break
          const timeline = applyAction(msg.action)
          broadcastExcludeAudience({
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
            routePrivateControlSignalToParticipant(msg)
          }
          break

        case 'LIVE_AUDIO_PARTICIPANT_STATUS':
          if (meta.role !== 'audience') break
          if (!validateParticipantStatus(msg, 'audience')) break
          {
            const participant = bindParticipantToConnection(meta, msg.participantId, msg)
            if (!participant) break
            routeParticipantStatus(participant)
          }
          break

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

        case 'SYNC_STATE':
        case 'REMOTE_COMMAND':
        case 'AUDIO_TELEMETRY':
        case 'VIDEO_TELEMETRY':
        case 'DISPLAY_TELEMETRY':
          if (meta?.role === 'audience') break
          if (onFallbackMessage) {
            onFallbackMessage(msg, meta)
          }
          break



        case 'LIVE_AUDIO_GRANT_SPEAK':
        case 'LIVE_AUDIO_REVOKE_SPEAK':
        case 'LIVE_AUDIO_MUTE_PARTICIPANT':
        case 'LIVE_AUDIO_MUTE_ALL':
        case 'LIVE_AUDIO_KICK_PARTICIPANT': {
          if (meta?.role !== 'control') break
          if (!validateModerationMessage(msg)) break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot send moderation actions')
            break
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
        removeControl(meta.controlSessionId)
      }
      releaseParticipantConnection(meta)
      broadcastConnectionCounts()
      broadcastMediaMasterStatus()
    })
    ws.on('error', () => {
      const meta = wsClients.get(ws)
      wsClients.delete(ws)
      if (meta?.role === 'control' && meta.controlSessionId) {
        removeControl(meta.controlSessionId)
      }
      releaseParticipantConnection(meta)
      broadcastConnectionCounts()
      broadcastMediaMasterStatus()
    })
  })

  const heartbeat = setInterval(() => {
    for (const [client, meta] of wsClients) {
      if (client.isAlive === false) {
        wsClients.delete(client)
        if (meta?.role === 'control' && meta.controlSessionId) {
          removeControl(meta.controlSessionId)
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
}
