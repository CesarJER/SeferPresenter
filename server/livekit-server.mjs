import { createHmac, randomUUID } from 'node:crypto'

const roles = new Set(['audience', 'control', 'presenter'])
const mutatingPaths = new Set([
  '/api/livekit/grant-speak',
  '/api/livekit/revoke-speak',
  '/api/livekit/mute-participant',
  '/api/livekit/mute-all',
  '/api/livekit/kick-participant',
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

const getConfig = () => {
  const liveAudioEnabled = parseBoolean(process.env.SEFER_LIVE_AUDIO_ENABLED, false)
  const livekitUrl = process.env.LIVEKIT_URL
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
    apiKey,
    apiSecret,
    roomName,
    publicListen: parseBoolean(process.env.SEFER_LIVE_AUDIO_PUBLIC_LISTEN, true),
    tokenTtlMinutes: parsePositiveInt(process.env.SEFER_LIVE_AUDIO_TOKEN_TTL_MINUTES, 30),
    rejoinGraceSeconds: parsePositiveInt(process.env.SEFER_LIVE_AUDIO_REJOIN_GRACE_SECONDS, 60),
  }
}

const statusPayload = () => {
  const config = getConfig()
  if (!config.enabled) {
    return config.reason === 'disabled'
      ? { enabled: false }
      : { enabled: false, available: false, reason: config.reason }
  }
  return { enabled: true, available: true }
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

const getRoomName = (config, roomSession) => {
  if (typeof roomSession !== 'string' || roomSession.trim() === '') return config.roomName
  const safeSession = roomSession.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return safeSession ? `${config.roomName}-${safeSession}` : config.roomName
}

const getVideoGrant = (role, room, config) => {
  if (role === 'audience') {
    return {
      room,
      roomJoin: true,
      canSubscribe: config.publicListen,
      canPublish: false,
      canPublishData: false,
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

const issueToken = ({ role, roomSession, existingParticipant }) => {
  const config = getConfig()
  if (!config.enabled) {
    return { ok: false, status: 503, error: 'Live Audio is disabled or misconfigured' }
  }

  if (!roles.has(role)) {
    return { ok: false, status: 400, error: 'Invalid role' }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAt = Date.now() + config.tokenTtlMinutes * 60_000
  const participantId = existingParticipant?.participantId || randomUUID()
  const participantIdentity = existingParticipant?.participantIdentity || `${role}-${participantId}`
  const room = getRoomName(config, roomSession || existingParticipant?.roomSession)
  const video = getVideoGrant(role, room, config)
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
  const participant = {
    participantId,
    participantIdentity,
    role,
    room,
    roomSession: roomSession || existingParticipant?.roomSession || null,
    speakerState: existingParticipant?.speakerState || 'LISTENER',
    canSubscribe: Boolean(video.canSubscribe),
    canPublish: Boolean(video.canPublish),
    issuedAt: Date.now(),
    expiresAt,
    lastSeenAt: Date.now(),
  }

  participants.set(participantId, participant)
  issuedTokens.set(token, { participantId, expiresAt })

  return {
    ok: true,
    value: {
      livekitUrl: config.livekitUrl,
      token,
      expiresAt,
      participantIdentity,
      participantId,
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
    if (participant.expiresAt + graceMs < now || roomState.kicked.has(participantId)) {
      participants.delete(participantId)
      roomState.speakers.delete(participantId)
      roomState.muted.delete(participantId)
    }
  }
}

const handleToken = async ({ req, res, readBody, sendJson }) => {
  if (!requireConfigured(res, sendJson)) return true
  const body = await readJson(req, readBody)
  const result = issueToken({
    role: body.role,
    roomSession: body.roomSession,
  })

  if (!result.ok) {
    sendJson(res, result.status, { error: result.error })
    return true
  }

  sendJson(res, 200, result.value)
  return true
}

const handleRefreshToken = async ({ req, res, readBody, sendJson }) => {
  if (!requireConfigured(res, sendJson)) return true
  const body = await readJson(req, readBody)
  if (!isValidParticipantId(body.participantId)) {
    sendJson(res, 403, { error: 'Participant is not active' })
    return true
  }

  const existingParticipant = participants.get(body.participantId)
  const result = issueToken({
    role: existingParticipant.role,
    roomSession: existingParticipant.roomSession,
    existingParticipant,
  })

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
      roomState.muted.add(participantId)
      participant.speakerState = 'MUTED'
      participant.lastSeenAt = Date.now()
    }
    sendJson(res, 200, { success: true })
    return true
  }

  const participantId = body.participantId
  const actions = {
    '/api/livekit/grant-speak': (participant) => {
      roomState.speakers.add(participant.participantId)
      roomState.muted.delete(participant.participantId)
      participant.speakerState = 'GRANTED'
    },
    '/api/livekit/revoke-speak': (participant) => {
      roomState.speakers.delete(participant.participantId)
      participant.speakerState = 'REVOKED'
    },
    '/api/livekit/mute-participant': (participant) => {
      roomState.muted.add(participant.participantId)
      participant.speakerState = 'MUTED'
    },
    '/api/livekit/kick-participant': (participant) => {
      roomState.kicked.add(participant.participantId)
      roomState.speakers.delete(participant.participantId)
      roomState.muted.delete(participant.participantId)
      participants.delete(participant.participantId)
      return false
    },
  }

  const mutator = actions[url.pathname]
  if (!mutator) return false

  const result = mutateParticipant(participantId, mutator)
  if (!result.ok) {
    sendJson(res, result.status, { error: result.error })
    return true
  }

  sendJson(res, 200, { success: true })
  return true
}

export const createLiveKitApi = (controlApi) => {
  const cleanupTimer = setInterval(cleanupExpiredState, 30_000)
  cleanupTimer.unref?.()

  return {
    close: () => clearInterval(cleanupTimer),
    getState: () => ({
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
    }),
    handle: async ({ req, res, url, readBody, sendJson }) => {
      try {
        if (url.pathname === '/api/livekit/status' && req.method === 'GET') {
          if (getConfig().enabled) void checkOptionalLiveKitSdk()
          sendJson(res, 200, statusPayload())
          return true
        }

        if (url.pathname === '/api/livekit/token' && req.method === 'POST') {
          void checkOptionalLiveKitSdk()
          return await handleToken({ req, res, readBody, sendJson })
        }

        if (url.pathname === '/api/livekit/refresh-token' && req.method === 'POST') {
          return await handleRefreshToken({ req, res, readBody, sendJson })
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
