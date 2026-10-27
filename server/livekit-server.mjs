import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk'
import { hasValidBasicAuth } from './authUtils.mjs'

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
const roomState = {
  speakers: new Set(),
  muted: new Set(),
  kicked: new Set(),
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

const statusPayload = () => {
  const config = getConfig()
  if (!config.enabled) {
    return config.reason === 'disabled'
      ? { enabled: false }
      : { enabled: false, available: false, reason: config.reason }
  }
  return { enabled: true, available: false }
}

const sdkErrorCodes = new Set(['not_found', 'invalid_argument', 'unauthenticated', 'permission_denied', 'canceled', 'deadline_exceeded', 'unavailable', 'internal', 'unknown', 'already_exists', 'resource_exhausted', 'aborted', 'failed_precondition'])
const sdkErrorDetails = (error) => ({
  status: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : 0,
  code: sdkErrorCodes.has(error?.code) ? error.code : 'unknown',
})
const isParticipantAbsent = (error) => error?.code === 'not_found'

const markParticipantAbsent = (participant) => {
  participant.livekitConnected = false
  participant.speakerState = 'LISTENER'
  participant.canPublish = false
  roomState.speakers.delete(participant.participantId)
  roomState.muted.delete(participant.participantId)
}

const updatePublishPermission = async (client, participant, canPublish) => {
  await client.updateParticipant(participant.room, participant.participantIdentity, {
    permission: {
      canPublish,
      canSubscribe: participant.canSubscribe,
      canPublishData: false,
      canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
    },
  })
  participant.livekitConnected = true
}

const muteParticipantTracks = async (client, participant) => {
  const remoteParticipant = await client.getParticipant(participant.room, participant.participantIdentity)
  for (const track of remoteParticipant.tracks || []) {
    if (track.source !== TrackSource.MICROPHONE) continue
    await client.mutePublishedTrack(participant.room, participant.participantIdentity, track.sid, true)
  }
  participant.livekitConnected = true
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

const canAudiencePublish = (participantId, existingParticipant) => {
  if (participantId && roomState.kicked.has(participantId)) return false
  return existingParticipant?.canPublish === true
}

const getVideoGrant = (role, room, config, participantId, existingParticipant) => {
  if (role === 'audience') {
    const canPublish = canAudiencePublish(participantId, existingParticipant)
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

const issueToken = ({ role, roomSession, controlSessionId, existingParticipant, audienceParticipantId }) => {
  const config = getConfig()
  if (!config.enabled) {
    return { ok: false, status: 503, error: 'Live Audio is disabled or misconfigured' }
  }

  if (!roles.has(role)) {
    return { ok: false, status: 400, error: 'Invalid role' }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresInMs = config.tokenTtlMinutes * 60_000
  const expiresAt = Date.now() + expiresInMs
  const participantId = existingParticipant?.participantId || audienceParticipantId || randomUUID()
  const participantIdentity = existingParticipant?.participantIdentity || `${role}-${participantId}`
  const room = getRoomName(config, roomSession || existingParticipant?.roomSession)
  if (!existingParticipant && audienceParticipantId) {
    roomState.speakers.delete(participantId)
    roomState.muted.delete(participantId)
  }
  const video = getVideoGrant(role, room, config, participantId, existingParticipant)
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
    livekitConnected: existingParticipant?.livekitConnected ?? false,
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
      expiresInMs,
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

const requireAuthorizedControl = (body, controlApi, req) => {
  if (!hasValidBasicAuth(req)) {
    return { ok: false, status: 403, code: 'privileged_auth_required', error: 'Live Audio moderation requires authentication' }
  }
  if (!isRecord(body) || body.role !== 'control') {
    return { ok: false, status: 403, code: 'control_unauthorized', error: 'Only authorized Control can perform this action' }
  }

  const operator = controlApi.authorizeOperatorCredential?.(req, { controlOnly: true })
  if (!operator || operator.controlSessionId !== body.controlSessionId) {
    return { ok: false, status: 403, code: 'control_unauthorized', error: 'Private Control connection credential required' }
  }
  if (typeof body.controlSessionId !== 'string' || !controlApi.isLiveAudioControlAuthorized(body.controlSessionId)) {
    return { ok: false, status: 403, code: 'control_unauthorized', error: 'Control is not authorized' }
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
  let audienceRecord

  if (requestedRole === 'audience') {
    audienceRecord = controlApi?.authorizeAudienceCredential?.(body.audienceAccessCredential)
    if (
      audienceRecord?.accessState === 'BLOCKED' ||
      (!audienceRecord && (controlApi?.getSessionAccessMode?.() === 'CONTROLLED' || body.audienceAccessCredential !== undefined))
    ) {
      sendJson(res, 403, { code: 'admission_required', error: 'Audience admission is required for Live Audio' })
      return true
    }
  }

  if (requestedRole !== 'audience') {
    if (!hasValidBasicAuth(req)) {
      sendJson(res, 403, { error: 'Privileged Live Audio roles require authentication' })
      return true
    }
    if (requestedRole === 'control') {
      const operator = controlApi?.authorizeOperatorCredential?.(req, { controlOnly: true })
      if (!operator || operator.controlSessionId !== body.controlSessionId) {
        sendJson(res, 403, { error: 'Private Control connection credential required' })
        return true
      }
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
    audienceParticipantId: requestedRole === 'audience' ? audienceRecord?.participantId : undefined,
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
    sendJson(res, 403, { code: 'participant_inactive', error: 'Participant is not active' })
    return true
  }

  const existingParticipant = participants.get(body.participantId)
  if (existingParticipant.role === 'audience') {
    const audienceRecord = controlApi?.authorizeAudienceCredential?.(body.audienceAccessCredential)
    if (
      audienceRecord?.accessState === 'BLOCKED' ||
      (controlApi?.getSessionAccessMode?.() === 'CONTROLLED' &&
        (!audienceRecord || audienceRecord.participantId !== existingParticipant.participantId))
    ) {
      sendJson(res, 403, { code: 'admission_required', error: 'Audience admission is required for Live Audio' })
      return true
    }
  }
  if (existingParticipant.expiresAt <= Date.now()) {
    sendJson(res, 401, { code: 'session_expired', error: 'Live Audio session has expired' })
    return true
  }
  if (!hasValidRefreshCredential(existingParticipant, body.refreshCredential)) {
    sendJson(res, 403, { code: 'refresh_credential_invalid', error: 'Live Audio refresh credential is invalid' })
    return true
  }
  if (existingParticipant.role !== 'audience' && !hasValidBasicAuth(req)) {
    sendJson(res, 403, { code: 'privileged_auth_required', error: 'Privileged Live Audio refresh requires authentication' })
    return true
  }
  if (
    existingParticipant.role === 'control' &&
    !controlApi?.isLiveAudioControlAuthorized?.(existingParticipant.controlSessionId)
  ) {
    sendJson(res, 403, { code: 'control_unauthorized', error: 'Control is no longer authorized for Live Audio' })
    return true
  }
  const result = issueToken({
    role: existingParticipant.role,
    roomSession: existingParticipant.roomSession,
    controlSessionId: existingParticipant.controlSessionId,
    existingParticipant,
  })

  console.log(`[LIVEKIT] livekit:token:refresh role=${existingParticipant.role}`)

  sendJson(res, 200, result.value)
  return true
}

const handleModeration = async ({ req, res, url, readBody, sendJson, controlApi, getRoomServiceClient }) => {
  if (!requireConfigured(res, sendJson)) return true
  const body = await readJson(req, readBody)
  const auth = requireAuthorizedControl(body, controlApi, req)

  if (!auth.ok) {
    sendJson(res, auth.status, { code: auth.code, error: auth.error })
    return true
  }

  if (url.pathname === '/api/livekit/mute-all') {
    const excluded = new Set(Array.isArray(body.excludeParticipantIds) ? body.excludeParticipantIds : [])
    for (const [participantId, participant] of participants) {
      if (participant.role === 'control') continue
      if (participant.speakerState !== 'GRANTED') continue
      if (excluded.has(participantId)) continue
      try {
        await muteParticipantTracks(getRoomServiceClient(), participant)
      } catch (error) {
        const details = sdkErrorDetails(error)
        console.warn(`[LIVEKIT] livekit:moderation:permission-failed action=mute-all status=${details.status} code=${details.code}`)
        if (isParticipantAbsent(error)) {
          markParticipantAbsent(participant)
          continue
        }
        sendJson(res, 502, { code: 'livekit_unavailable', error: 'LiveKit could not mute all participants' })
        return true
      }
      roomState.speakers.add(participantId)
      roomState.muted.add(participantId)
      participant.speakerState = 'GRANTED'
      participant.lastSeenAt = Date.now()
    }
    console.log(`[LIVEKIT] origin=control action=mute-all`)
    sendJson(res, 200, { success: true })
    return true
  }

  const participantId = body.participantId
  const publishPermission = url.pathname === '/api/livekit/grant-speak'
    ? true
    : ['/api/livekit/revoke-speak', '/api/livekit/kick-participant', '/api/livekit/rescue-participant'].includes(url.pathname)
      ? false
      : null

  if (!isValidParticipantId(participantId)) {
    if (publishPermission === false && typeof participantId === 'string' && uuidV4Pattern.test(participantId)) {
      if (url.pathname === '/api/livekit/kick-participant') {
        roomState.kicked.add(participantId)
      } else if (url.pathname === '/api/livekit/rescue-participant') {
        roomState.kicked.delete(participantId)
      }
      roomState.speakers.delete(participantId)
      roomState.muted.delete(participantId)
      sendJson(res, 200, { success: true })
      return true
    }
    sendJson(res, 409, { code: 'participant_not_ready', error: 'Participant needs to reconnect to Live Audio' })
    return true
  }

  const participant = participants.get(participantId)
  if (url.pathname === '/api/livekit/mute-participant' && !participant.canPublish) {
    sendJson(res, 409, { code: 'publish_permission_required', error: 'Participant does not have microphone permission' })
    return true
  }

  if (publishPermission !== null || url.pathname === '/api/livekit/mute-participant') {
    const action = url.pathname.replace('/api/livekit/', '')
    const startedAt = Date.now()
    console.log(`[LIVEKIT] livekit:moderation:request action=${action}`)
    try {
      if (publishPermission === null) {
        await muteParticipantTracks(getRoomServiceClient(), participant)
      } else {
        await updatePublishPermission(getRoomServiceClient(), participant, publishPermission)
      }
      console.log(`[LIVEKIT] livekit:moderation:permission-updated action=${action} durationMs=${Date.now() - startedAt}`)
    } catch (error) {
      const details = sdkErrorDetails(error)
      console.warn(`[LIVEKIT] livekit:moderation:permission-failed action=${action} status=${details.status} code=${details.code}`)
      if (isParticipantAbsent(error)) {
        markParticipantAbsent(participant)
        if (publishPermission !== false) {
          sendJson(res, 409, { code: 'participant_not_ready', error: 'Participant needs to reconnect to Live Audio' })
          return true
        }
      } else {
        sendJson(res, 502, { code: 'livekit_unavailable', error: 'LiveKit rejected the participant permission update' })
        return true
      }
    }
  }

  const actions = {
    '/api/livekit/grant-speak': (participant) => {
      roomState.kicked.delete(participant.participantId)
      roomState.speakers.add(participant.participantId)
      roomState.muted.add(participant.participantId)
      participant.speakerState = 'GRANTED'
      participant.canPublish = true
    },
    '/api/livekit/revoke-speak': (participant) => {
      roomState.speakers.delete(participant.participantId)
      roomState.muted.delete(participant.participantId)
      participant.speakerState = 'LISTENER'
      participant.canPublish = false
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
      participant.canPublish = false
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

export const createLiveKitApi = (controlApi, options = {}) => {
  const cleanupTimer = setInterval(cleanupExpiredState, 30_000)
  cleanupTimer.unref?.()
  let roomServiceClient = options.roomServiceClient
  let cachedStatus = { enabled: getConfig().enabled, available: false }
  let statusExpiresAt = 0
  let pendingStatus = null
  let cancelStatus = null
  let closed = false
  let revokingAll = false
  const pendingModerations = new Set()

  const getRoomServiceClient = () => {
    if (roomServiceClient) return roomServiceClient
    const config = getConfig()
    roomServiceClient = new RoomServiceClient(config.livekitApiUrl, config.apiKey, config.apiSecret, { requestTimeout: 2 })
    return roomServiceClient
  }

  const getOperationalStatus = async () => {
    const configStatus = statusPayload()
    if (closed) return { ...configStatus, available: false }
    if (!configStatus.enabled) return configStatus
    if (Date.now() < statusExpiresAt) return cachedStatus
    if (pendingStatus) return pendingStatus
    pendingStatus = (async () => {
      let timeout
      try {
        await Promise.race([
          Promise.resolve().then(() => getRoomServiceClient().listRooms()),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('LiveKit readiness timeout')), options.statusTimeoutMs ?? 2000)
            cancelStatus = () => {
              clearTimeout(timeout)
              reject(new Error('LiveKit API closed'))
            }
          }),
        ])
        cachedStatus = { enabled: true, available: true }
      } catch (error) {
        const details = sdkErrorDetails(error)
        console.warn(`[LIVEKIT] livekit:status:unavailable status=${details.status} code=${details.code}`)
        cachedStatus = { enabled: true, available: false, reason: 'livekit-unreachable' }
      } finally {
        clearTimeout(timeout)
        cancelStatus = null
        statusExpiresAt = Date.now() + 5000
        pendingStatus = null
      }
      return cachedStatus
    })()
    return pendingStatus
  }

  return {
    close: () => {
      closed = true
      clearInterval(cleanupTimer)
      cancelStatus?.()
    },
    revokeAllSpeakers: async () => {
      if (revokingAll) return false
      revokingAll = true
      let revokedAll = true
      try {
        await Promise.allSettled([...pendingModerations])
        for (const participant of participants.values()) {
          if (participant.role === 'control') continue
          if (!participant.canPublish) continue
          try {
            await updatePublishPermission(getRoomServiceClient(), participant, false)
          } catch (error) {
            const details = sdkErrorDetails(error)
            console.warn(`[LIVEKIT] livekit:moderation:permission-failed action=revoke-all status=${details.status} code=${details.code}`)
            if (!isParticipantAbsent(error)) {
              revokedAll = false
              continue
            }
            markParticipantAbsent(participant)
          }
          participant.speakerState = 'LISTENER'
          participant.canPublish = false
          participant.lastSeenAt = Date.now()
          roomState.speakers.delete(participant.participantId)
          roomState.muted.delete(participant.participantId)
        }
        return revokedAll
      } finally {
        revokingAll = false
      }
    },
    getState: () => ({
      enabled: getConfig().enabled,
      available: getConfig().enabled && cachedStatus.available,
      participants: Array.from(participants.values()).map((participant) => ({
        participantId: participant.participantId,
        role: participant.role,
        controlSessionId: participant.controlSessionId,
        room: participant.room,
        speakerState: participant.speakerState,
        canSubscribe: participant.canSubscribe,
        canPublish: participant.canPublish,
        livekitConnected: participant.livekitConnected === true,
        expiresAt: participant.expiresAt,
      })),
      speakers: Array.from(roomState.speakers),
      muted: Array.from(roomState.muted),
      kicked: Array.from(roomState.kicked),
    }),
    handle: async ({ req, res, url, readBody, sendJson }) => {
      try {
        if (url.pathname === '/api/livekit/status' && req.method === 'GET') {
          sendJson(res, 200, await getOperationalStatus())
          return true
        }

        if (url.pathname === '/api/livekit/token' && req.method === 'POST') {
          return await handleToken({ req, res, readBody, sendJson, controlApi })
        }

        if (url.pathname === '/api/livekit/refresh-token' && req.method === 'POST') {
          return await handleRefreshToken({ req, res, readBody, sendJson, controlApi })
        }

        if (mutatingPaths.has(url.pathname) && req.method === 'POST') {
          if (revokingAll) {
            sendJson(res, 409, { code: 'publication_transition_pending', error: 'Wait for the microphone revocation to finish and retry explicitly' })
            return true
          }
          const moderation = handleModeration({
            req,
            res,
            url,
            readBody,
            sendJson,
            controlApi,
            getRoomServiceClient,
          })
          pendingModerations.add(moderation)
          try {
            return await moderation
          } finally {
            pendingModerations.delete(moderation)
          }
        }

        return false
      } catch {
        sendJson(res, 400, { code: 'invalid_request', error: 'Invalid Live Audio request' })
        return true
      }
    },
  }
}

export const resetLiveKitStateForTests = () => {
  participants.clear()
  issuedTokens.clear()
  roomState.speakers.clear()
  roomState.muted.clear()
  roomState.kicked.clear()
}
