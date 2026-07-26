import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { hasValidBasicAuth } from './authUtils.mjs'
import { RoomServiceClient } from 'livekit-server-sdk'

const roles = new Set(['audience', 'control', 'presenter'])
const mutatingPaths = new Set([
  '/api/livekit/grant-speak',
  '/api/livekit/revoke-speak',
  '/api/livekit/mute-participant',
  '/api/livekit/mute-all',
  '/api/livekit/kick-participant',
  '/api/livekit/rescue-participant',
])
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const participants = new Map()
const issuedTokens = new Map()
let liveKitSdkAvailability = null
const roomState = {
  speakers: new Set(),
  muted: new Set(),
  kicked: new Set(),
}

const checkOptionalLiveKitSdk = async () => {
  if (liveKitSdkAvailability !== null) return liveKitSdkAvailability
  try {
    await import('livekit-server-sdk')
    liveKitSdkAvailability = true
  } catch {
    liveKitSdkAvailability = false
  }
  return liveKitSdkAvailability
}

const parseBoolean = (value, fallback = false) => {
  if (value === undefined) return fallback
  return String(value).toLowerCase() === 'true'
}

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const toLiveKitHttpUrl = (value) => {
  const url = new URL(value)
  if (url.protocol === 'ws:') url.protocol = 'http:'
  if (url.protocol === 'wss:') url.protocol = 'https:'
  return url.toString().replace(/\/$/, '')
}

const withTimeout = async (promise, timeoutMs) => {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('LiveKit readiness timeout')), timeoutMs)
        timeout.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

const getConfig = () => {
  const liveAudioEnabled = parseBoolean(process.env.SEFER_LIVE_AUDIO_ENABLED, false)
  const livekitUrl = process.env.LIVEKIT_URL
  const livekitApiUrl = process.env.LIVEKIT_API_URL || livekitUrl
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  const roomName = process.env.LIVEKIT_ROOM_NAME || 'sefer-live-audio'

  if (!liveAudioEnabled) {
    return { enabled: false, available: false, reason: 'disabled' }
  }

  if (!livekitUrl || !apiKey || !apiSecret) {
    return { enabled: false, available: false, reason: 'missing-livekit-env' }
  }

  return {
    enabled: true,
    available: true,
    livekitUrl,
    livekitApiUrl,
    apiKey,
    apiSecret,
    roomName,
    publicListen: parseBoolean(process.env.SEFER_LIVE_AUDIO_PUBLIC_LISTEN, true),
    tokenTtlMinutes: parsePositiveInt(process.env.SEFER_LIVE_AUDIO_TOKEN_TTL_MINUTES, 30),
    rejoinGraceSeconds: parsePositiveInt(process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS, 60),
  }
}

const base64url = (value) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

const signJwt = (payload, apiKey, apiSecret) => {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const data = `${encodedHeader}.${encodedPayload}`
  const signature = createHmac('sha256', apiSecret).update(data).digest('base64url')
  return `${data}.${signature}`
}

const createRefreshCredential = () => randomBytes(32).toString('base64url')

const hashRefreshCredential = (credential) =>
  createHash('sha256').update(credential).digest()

const hasValidRefreshCredential = (participant, credential) => {
  if (typeof credential !== 'string' || credential.length < 32) return false
  if (!Buffer.isBuffer(participant?.refreshCredentialHash)) return false
  const candidateHash = hashRefreshCredential(credential)
  return candidateHash.length === participant.refreshCredentialHash.length &&
    timingSafeEqual(candidateHash, participant.refreshCredentialHash)
}

const getRoomName = (config, roomSession) => {
  if (typeof roomSession !== 'string' || roomSession.trim() === '') return config.roomName
  const safeSession = roomSession.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return safeSession ? `${config.roomName}-${safeSession}` : config.roomName
}

const canAudiencePublish = (participantId, existingParticipant, authoritativePermission = false) => {
  if (participantId && roomState.kicked.has(participantId)) return false
  return authoritativePermission === true &&
    (existingParticipant?.speakerState !== 'REVOKED')
}

const getVideoGrant = (role, room, config, participantId, existingParticipant, audienceCanPublish) => {
  if (role === 'audience') {
    const canPublish = canAudiencePublish(participantId, existingParticipant, audienceCanPublish)
    return {
      room,
      roomJoin: true,
      canSubscribe: config.publicListen,
      canPublish,
      canPublishData: false,
      canPublishSources: canPublish ? ['microphone'] : undefined,
    }
  }

  return {
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    canPublishSources: ['microphone'],
  }
}

const issueToken = ({
  role,
  roomSession,
  controlSessionId,
  existingParticipant,
  participantId: requestedParticipantId,
  audienceCanPublish = false,
}) => {
  const config = getConfig()
  if (!config.enabled) {
    return { ok: false, status: 503, error: 'Live Audio is disabled or misconfigured' }
  }

  if (!roles.has(role)) {
    return { ok: false, status: 400, error: 'Invalid role' }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAt = Date.now() + config.tokenTtlMinutes * 60_000
  const participantId = existingParticipant?.participantId || requestedParticipantId || randomUUID()
  const participantIdentity = existingParticipant?.participantIdentity || `${role}-${participantId}`
  const room = getRoomName(config, roomSession || existingParticipant?.roomSession)
  const video = getVideoGrant(role, room, config, participantId, existingParticipant, audienceCanPublish)
  const payload = {
    iss: config.apiKey,
    sub: participantIdentity,
    metadata: JSON.stringify({ participantId }),
    jti: randomUUID(),
    nbf: nowSeconds - 5,
    exp: Math.floor(expiresAt / 1000),
    video,
  }
  const token = signJwt(payload, config.apiKey, config.apiSecret)
  const refreshCredential = createRefreshCredential()
  const participant = {
    participantId,
    participantIdentity,
    role,
    room,
    roomSession: roomSession || existingParticipant?.roomSession || null,
    controlSessionId: controlSessionId || existingParticipant?.controlSessionId || null,
    speakerState: existingParticipant?.speakerState || 'LISTENER',
    canSubscribe: Boolean(video.canSubscribe),
    canPublish: Boolean(video.canPublish),
    issuedAt: Date.now(),
    expiresAt,
    lastSeenAt: Date.now(),
    refreshCredentialHash: hashRefreshCredential(refreshCredential),
  }

  participants.set(participantId, participant)
  issuedTokens.set(token, { participantId, expiresAt })

  console.log(`[LIVEKIT] livekit:token:issued role=${role}`)

  return {
    ok: true,
    value: {
      livekitUrl: config.livekitUrl,
      token,
      expiresAt,
      participantIdentity,
      participantId,
      refreshCredential,
    },
  }
}

const readJson = async (req, readBody) => {
  const raw = await readBody(req, 64 * 1024)
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const requireConfigured = (res, sendJson) => {
  const config = getConfig()
  if (config.enabled) return true
  sendJson(res, 503, { error: 'Live Audio is disabled or misconfigured' })
  return false
}

const isValidParticipantId = (value) =>
  typeof value === 'string' && uuidV4Pattern.test(value) && participants.has(value)

const requireAuthorizedControl = (body, controlApi) => {
  if (!isRecord(body) || body.role !== 'control') {
    return { ok: false, status: 403, error: 'Only authorized Control can perform this action' }
  }

  if (typeof body.controlSessionId !== 'string' || !controlApi.isLiveAudioControlAuthorized(body.controlSessionId)) {
    return { ok: false, status: 403, error: 'Control is not authorized' }
  }

  return { ok: true }
}

const mutateParticipant = (participantId, mutator) => {
  if (!isValidParticipantId(participantId)) {
    return { ok: false, status: 404, error: 'Participant not found' }
  }

  const participant = participants.get(participantId)
  const keepParticipant = mutator(participant) !== false
  if (!keepParticipant) return { ok: true, participant }
  participant.lastSeenAt = Date.now()
  participants.set(participantId, participant)
  return { ok: true, participant }
}

const cleanupExpiredState = () => {
  const now = Date.now()
  const config = getConfig()
  const graceMs = (config.rejoinGraceSeconds || 60) * 1000

  for (const [token, record] of issuedTokens) {
    if (record.expiresAt + graceMs < now) issuedTokens.delete(token)
  }

  for (const [participantId, participant] of participants) {
    if (participant.expiresAt + graceMs < now) {
      participants.delete(participantId)
      roomState.speakers.delete(participantId)
      roomState.muted.delete(participantId)
      roomState.kicked.delete(participantId)
    }
  }
}

const handleToken = async ({ req, res, readBody, sendJson, controlApi }) => {
  if (!requireConfigured(res, sendJson)) return true
  const body = await readJson(req, readBody)
  const requestedRole = roles.has(body.role) ? body.role : 'audience'

  let audienceAccess = null
  if (requestedRole === 'audience') {
    audienceAccess = controlApi?.authorizeAudienceCredential?.(body.audienceAccessCredential)
    if (!audienceAccess && controlApi?.getSessionAccessMode?.() === 'CONTROLLED') {
      sendJson(res, 403, { error: 'Audience admission is required for Live Audio' })
      return true
    }
  } else {
    if (!hasValidBasicAuth(req)) {
      sendJson(res, 403, { error: 'Privileged Live Audio roles require authentication' })
      return true
    }
    if (
      requestedRole === 'control' &&
      (typeof body.controlSessionId !== 'string' || !controlApi?.isLiveAudioControlAuthorized?.(body.controlSessionId))
    ) {
      sendJson(res, 403, { error: 'Control is not authorized for Live Audio' })
      return true
    }
  }

  const result = issueToken({
    role: requestedRole,
    roomSession: body.roomSession,
    controlSessionId: requestedRole === 'control' ? body.controlSessionId : undefined,
    participantId: audienceAccess?.participantId,
    audienceCanPublish: requestedRole !== 'audience' || Boolean(
      audienceAccess &&
      controlApi?.getLiveAudioParticipantState?.(audienceAccess.participantId)?.canPublishAudio === true &&
      controlApi?.hasCurrentRecordingConfirmation?.(audienceAccess.participantId)
    ),
  })

  if (!result.ok) {
    sendJson(res, result.status, { error: result.error })
    return true
  }

  sendJson(res, 200, result.value)
  return true
}

const handleRefreshToken = async ({ req, res, readBody, sendJson, controlApi }) => {
  if (!requireConfigured(res, sendJson)) return true
  const body = await readJson(req, readBody)
  if (!isValidParticipantId(body.participantId)) {
    sendJson(res, 403, { error: 'Participant is not active' })
    return true
  }

  const existingParticipant = participants.get(body.participantId)
  if (existingParticipant.expiresAt <= Date.now()) {
    sendJson(res, 401, { error: 'Live Audio session has expired' })
    return true
  }
  if (!hasValidRefreshCredential(existingParticipant, body.refreshCredential)) {
    sendJson(res, 403, { error: 'Live Audio refresh credential is invalid' })
    return true
  }
  if (existingParticipant.role !== 'audience' && !hasValidBasicAuth(req)) {
    sendJson(res, 403, { error: 'Privileged Live Audio refresh requires authentication' })
    return true
  }
  if (
    existingParticipant.role === 'control' &&
    !controlApi?.isLiveAudioControlAuthorized?.(existingParticipant.controlSessionId)
  ) {
    sendJson(res, 403, { error: 'Control is no longer authorized for Live Audio' })
    return true
  }
  let audienceAccess = null
  if (existingParticipant.role === 'audience') {
    if (typeof controlApi?.authorizeAudienceCredential === 'function') {
      audienceAccess = controlApi.authorizeAudienceCredential(body.audienceAccessCredential)
      if (!audienceAccess || audienceAccess.participantId !== existingParticipant.participantId) {
        sendJson(res, 403, { error: 'Audience credential does not belong to this Live Audio participant' })
        return true
      }
    }
  }
  const wsParticipant = controlApi?.getLiveAudioParticipantState?.(body.participantId)
  if (wsParticipant) {
    existingParticipant.speakerState = wsParticipant.speakerState
    existingParticipant.canPublish = wsParticipant.canPublishAudio &&
      controlApi?.hasCurrentRecordingConfirmation?.(body.participantId)
    existingParticipant.canSubscribe = wsParticipant.canSubscribe
    if (wsParticipant.speakerState === 'GRANTED' || wsParticipant.canPublishAudio) {
      roomState.speakers.add(body.participantId)
      if (wsParticipant.isMuted) {
        roomState.muted.add(body.participantId)
      } else {
        roomState.muted.delete(body.participantId)
      }
    } else if (wsParticipant.speakerState === 'REVOKED' || wsParticipant.speakerState === 'MUTED' || wsParticipant.speakerState === 'LISTENER') {
      roomState.speakers.delete(body.participantId)
      if (wsParticipant.speakerState === 'MUTED') roomState.muted.add(body.participantId)
    }
  }
  const result = issueToken({
    role: existingParticipant.role,
    roomSession: existingParticipant.roomSession,
    controlSessionId: existingParticipant.controlSessionId,
    existingParticipant,
    audienceCanPublish: existingParticipant.role !== 'audience' ||
      controlApi?.hasCurrentRecordingConfirmation?.(existingParticipant.participantId),
  })

  console.log(`[LIVEKIT] livekit:token:refresh role=${existingParticipant.role}`)

  sendJson(res, 200, result.value)
  return true
}

const handleModeration = async ({ req, res, url, readBody, sendJson, controlApi }) => {
  if (!requireConfigured(res, sendJson)) return true
  const body = await readJson(req, readBody)
  const auth = requireAuthorizedControl(body, controlApi)

  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error })
    return true
  }

  if (url.pathname === '/api/livekit/mute-all') {
    for (const [participantId, participant] of participants) {
      if (participant.role === 'control') continue
      if (participant.speakerState !== 'GRANTED') continue
      roomState.speakers.add(participantId)
      roomState.muted.add(participantId)
      participant.speakerState = 'GRANTED'
      participant.lastSeenAt = Date.now()
    }
    console.log(`[LIVEKIT] origin=control action=mute-all`)
    sendJson(res, 200, { success: true })
    return true
  }

  if (url.pathname === '/api/livekit/grant-speak') {
    sendJson(res, 409, { error: 'Grant speaking permission through the authoritative WebSocket protocol' })
    return true
  }

  const participantId = body.participantId
  const actions = {
    '/api/livekit/grant-speak': (participant) => {
      roomState.kicked.delete(participant.participantId)
      roomState.speakers.add(participant.participantId)
      roomState.muted.add(participant.participantId)
      participant.speakerState = 'GRANTED'
    },
    '/api/livekit/revoke-speak': (participant) => {
      roomState.speakers.delete(participant.participantId)
      roomState.muted.delete(participant.participantId)
      participant.speakerState = 'LISTENER'
    },
    '/api/livekit/mute-participant': (participant) => {
      roomState.speakers.add(participant.participantId)
      roomState.muted.add(participant.participantId)
      participant.speakerState = 'GRANTED'
    },
    '/api/livekit/kick-participant': (participant) => {
      roomState.kicked.add(participant.participantId)
      roomState.speakers.delete(participant.participantId)
      roomState.muted.delete(participant.participantId)
      participant.speakerState = 'REVOKED'
    },
    '/api/livekit/rescue-participant': (participant) => {
      roomState.kicked.delete(participant.participantId)
      roomState.speakers.delete(participant.participantId)
      roomState.muted.delete(participant.participantId)
      participant.speakerState = 'LISTENER'
      participant.canPublish = false
    },
  }

  const mutator = actions[url.pathname]
  if (!mutator) return false

  const result = mutateParticipant(participantId, mutator)
  if (!result.ok) {
    sendJson(res, result.status, { error: result.error })
    return true
  }

  console.log(`[LIVEKIT] origin=control action=${url.pathname.replace('/api/livekit/', '')}`)

  sendJson(res, 200, { success: true })
  return true
}

export const createLiveKitApi = (controlApi) => {
  const cleanupTimer = setInterval(cleanupExpiredState, 30_000)
  cleanupTimer.unref?.()
  let reachabilityCache = null

  const getStatus = async () => {
    const config = getConfig()
    if (!config.enabled) {
      return config.reason === 'disabled'
        ? { enabled: false }
        : { enabled: false, available: false, reason: config.reason }
    }
    if (reachabilityCache && reachabilityCache.expiresAt > Date.now()) {
      return reachabilityCache.value
    }
    try {
      const roomService = controlApi?.createRoomServiceClient?.(config) ||
        new RoomServiceClient(
          toLiveKitHttpUrl(config.livekitApiUrl),
          config.apiKey,
          config.apiSecret,
        )
      await withTimeout(roomService.listRooms(), 1_500)
      const value = { enabled: true, available: true }
      reachabilityCache = { value, expiresAt: Date.now() + 5_000 }
      return value
    } catch {
      const value = { enabled: true, available: false, reason: 'livekit-unreachable' }
      reachabilityCache = { value, expiresAt: Date.now() + 5_000 }
      return value
    }
  }

  return {
    close: () => clearInterval(cleanupTimer),
    getState: () => ({
      enabled: getConfig().enabled,
      available: getConfig().available,
      participants: Array.from(participants.values()).map((participant) => ({
        participantId: participant.participantId,
        role: participant.role,
        room: participant.room,
        speakerState: participant.speakerState,
        canSubscribe: participant.canSubscribe,
        canPublish: participant.canPublish,
        expiresAt: participant.expiresAt,
      })),
      speakers: Array.from(roomState.speakers),
      muted: Array.from(roomState.muted),
      kicked: Array.from(roomState.kicked),
    }),
    revokeAudiencePublishingForRecording: async () => {
      const config = getConfig()
      if (!config.enabled) return
      const roomService = controlApi?.createRoomServiceClient?.(config) ||
        new RoomServiceClient(
          toLiveKitHttpUrl(config.livekitApiUrl),
          config.apiKey,
          config.apiSecret,
        )
      const audienceByRoom = new Map()
      for (const participant of participants.values()) {
        if (participant.role !== 'audience') continue
        const roomParticipants = audienceByRoom.get(participant.room) || []
        roomParticipants.push(participant)
        audienceByRoom.set(participant.room, roomParticipants)
      }
      for (const [room, issuedAudience] of audienceByRoom) {
        const connected = await roomService.listParticipants(room)
        const connectedByIdentity = new Map(connected.map((participant) => [participant.identity, participant]))
        for (const participant of issuedAudience) {
          const active = connectedByIdentity.get(participant.participantIdentity)
          participant.canPublish = false
          roomState.speakers.delete(participant.participantId)
          roomState.muted.add(participant.participantId)
          if (!active) continue
          const updated = await roomService.updateParticipant(room, participant.participantIdentity, {
            permission: {
              canSubscribe: participant.canSubscribe,
              canPublish: false,
              canPublishData: false,
              canPublishSources: [],
            },
          })
          for (const track of updated.tracks || active.tracks || []) {
            if (track.source === 2 && !track.muted) {
              await roomService.mutePublishedTrack(room, participant.participantIdentity, track.sid, true)
            }
          }
        }
      }
    },
    handle: async ({ req, res, url, readBody, sendJson }) => {
      try {
        if (url.pathname === '/api/livekit/status' && req.method === 'GET') {
          if (getConfig().enabled) void checkOptionalLiveKitSdk()
          const status = await getStatus()
          sendJson(res, status.enabled && status.available === false ? 503 : 200, status)
          return true
        }

        if (url.pathname === '/api/livekit/token' && req.method === 'POST') {
          void checkOptionalLiveKitSdk()
          return await handleToken({ req, res, readBody, sendJson, controlApi })
        }

        if (url.pathname === '/api/livekit/refresh-token' && req.method === 'POST') {
          return await handleRefreshToken({ req, res, readBody, sendJson, controlApi })
        }

        if (mutatingPaths.has(url.pathname) && req.method === 'POST') {
          return await handleModeration({ req, res, url, readBody, sendJson, controlApi })
        }

        return false
      } catch (err) {
        sendJson(res, 400, { error: err.message || 'Invalid Live Audio request' })
        return true
      }
    },
  }
}
