import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createLiveKitApi } from './livekit-server.mjs'
import {
  createWsServer,
  authorizeAudienceCredential,
  bootstrapAudienceAccess,
  consumeAudienceSseTicket,
  getLiveAudioControlSnapshot,
  getLiveAudioParticipantState,
  getPresentationSessionId,
  getRecordingPolicy,
  hasCurrentRecordingConfirmation,
  getServerEpoch,
  getSessionAccessMode,
  issueAudienceSseTicket,
  logoutAudienceCredential,
  isLiveAudioControlAuthorized,
  isAudienceParticipantAdmitted,
} from './ws-server.mjs'
import {
  hasAllowedRequestOrigin,
  hasValidBasicAuth,
  isAuthRequired,
  isProtectedRequestPath,
} from './authUtils.mjs'
import {
  getDefaultProjectionState,
  makeProjectionSyncStateMessage,
  normalizeProjectionState,
  reduceProjectionCommand,
} from './projection-state-reducer.mjs'
import { broadcastWs } from './ws-server.mjs'
import { getTimeline, applyAction } from './timelineManager.mjs'
import {
  estimateTimelinePositionSec,
  findActiveCueIndex,
  findCueForSlideSelection,
} from './audio-timeline-sync.mjs'
import { getPublicCatalogs } from './public-catalog-config.mjs'
import { buildPublicPresentations } from './public-presentations-builder.mjs'
import { validatePublicQuizMessage } from './quiz-message-validation.mjs'
import {
  formatValidationError,
  validateAudioSyncPayload,
  validatePresentationsPayload,
} from './content-validation.mjs'
import { readJsonWithRecovery, writeJsonSafely } from './json-persistence.mjs'
import { resolvePathInsideRoot } from './path-containment.mjs'
import { deriveAudienceProjectionState } from './audience-projection-state.mjs'
import {
  buildOperatorManifest,
  readPrivacyLocalMarkdown,
  validateOperatorManifestFile,
} from './operator-config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const publicDir = path.join(rootDir, 'public')

const getBearerCredential = (req) => {
  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null
  return authorization.slice('Bearer '.length).trim()
}
const port = Number(process.env.SEFER_PORT || 8787)
const staticArgIndex = process.argv.indexOf('--static')
const staticDir = path.resolve(rootDir, staticArgIndex >= 0 ? process.argv[staticArgIndex + 1] || 'dist' : 'dist')
const operatorManifest = staticArgIndex >= 0
  ? validateOperatorManifestFile(staticDir)
  : buildOperatorManifest(process.env)
const privacyLocalPath = process.env.SEFER_PRIVACY_LOCAL_PATH?.trim() ||
  path.join(rootDir, 'privacy.local.md')
const privacyLocalMarkdown = readPrivacyLocalMarkdown(privacyLocalPath)
const sseHeartbeatMs = 30_000

let currentState = makeProjectionSyncStateMessage(getDefaultProjectionState(), {
  clientId: 'server',
  origin: 'control',
})
let audienceStateRevision = 0
let audienceEventId = randomUUID()

let clients = new Set()
let audienceClients = new Set()
let quizClients = new Set()
let liveKitApi = null
let audioSyncMapsCache = []
let presentationsCache = []
let publicPresentationsCache = []
const pausedSseClients = new WeakSet()
const pendingSseBodies = new WeakMap()
const quizAggregateState = {
  submittedSessionsBySlideId: new Map(),
  finalScoreBuckets: new Map(),
  finalScoreSessions: new Map(),
  answerSessions: new Map(),
  finalScoreValues: new Map(),
  updatedAt: null,
}
const maxQuizSessionsPerPresentation = 5_000
const maxQuizAnswersPerSession = 500

const contentTypes = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

const normalizePublicPath = (value) => {
  if (!value) return ''
  const normalized = String(value).replace(/\\/g, '/')
  const publicIndex = normalized.lastIndexOf('/public/')
  if (publicIndex >= 0) {
    return normalized.slice(publicIndex + '/public'.length)
  }
  if (normalized.startsWith('public/')) {
    return `/${normalized.slice('public/'.length)}`
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

const normalizePresentations = (presentations) =>
  presentations.map((presentation) => ({
    ...presentation,
    background: normalizePublicPath(presentation.background || ''),
  }))

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

const registerSseClient = (clientSet, res) => {
  clientSet.add(res)
  const cleanup = () => {
    clientSet.delete(res)
  }
  res.on('close', cleanup)
  res.on('error', cleanup)
}

const writeSse = (clientSet, client, body) => {
  if (client.destroyed || client.writableEnded) {
    clientSet.delete(client)
    return
  }

  if (pausedSseClients.has(client)) {
    pendingSseBodies.set(client, body)
    return
  }

  try {
    const writable = client.write(`data: ${body}\n\n`, (err) => {
      if (err) clientSet.delete(client)
    })
    if (!writable) {
      pausedSseClients.add(client)
      client.once('drain', () => {
        pausedSseClients.delete(client)
        const pending = pendingSseBodies.get(client)
        pendingSseBodies.delete(client)
        if (pending !== undefined) writeSse(clientSet, client, pending)
      })
    }
  } catch {
    clientSet.delete(client)
  }
}

const writeSseSet = (clientSet, body) => {
  for (const client of clientSet) {
    writeSse(clientSet, client, body)
  }
}

const isObjectRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const hasStringOrObjectPayload = (value) => typeof value === 'string' || isObjectRecord(value)

const validateTelemetry = (telemetry, expectedType, hasTelemetryPayload) => {
  if (!isObjectRecord(telemetry)) {
    return `${expectedType} payload must be an object`
  }
  if (telemetry.type !== expectedType) {
    return `${expectedType} payload must include type="${expectedType}"`
  }
  if ('payload' in telemetry && !hasStringOrObjectPayload(telemetry.payload)) {
    return `${expectedType} payload must be a string or object when provided`
  }
  if (!hasTelemetryPayload(telemetry)) {
    return `${expectedType} payload has invalid telemetry data`
  }
  return null
}

const isNullableString = (value) => value === null || typeof value === 'string'

const readBody = (req, maxBytes = 5 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let totalLength = 0
    req.on('data', (chunk) => {
      chunks.push(chunk)
      totalLength += chunk.length
      if (totalLength > maxBytes) {
        reject(new Error('Body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })

const getBackupPath = (filePath) => {
  const configuredBackupDir = process.env.SEFER_BACKUP_DIR?.trim()
  return configuredBackupDir
    ? path.join(configuredBackupDir, `${path.basename(filePath)}.bak`)
    : `${filePath}.bak`
}

const persistJson = (filePath, value) => {
  const configuredBackupDir = process.env.SEFER_BACKUP_DIR?.trim()
  const backupPath = getBackupPath(filePath)
  if (configuredBackupDir) fs.mkdirSync(configuredBackupDir, { recursive: true })
  const result = writeJsonSafely(filePath, value, {
    backupPath,
    forceInPlaceFallback: process.env.SEFER_FORCE_IN_PLACE_PERSISTENCE === 'true'
  })
  if (result.limitation) {
    console.warn(`[PERSISTENCE] ${path.basename(filePath)}: ${result.limitation} Backup: ${result.backupPath}`)
  }
  return result
}

const readValidatedJsonWithRecovery = (filePath, fallback, validate, label) => {
  const validateValue = (value) => {
    const validation = validate(value)
    if (!validation.ok) throw new Error(formatValidationError(validation))
    return validation.value
  }

  const backupPath = getBackupPath(filePath)
  try {
    const result = readJsonWithRecovery({
      filePath,
      backupPath,
      fallback,
      validate: validateValue,
    })
    if (result.recovered) {
      console.warn(`[${label}] Primary data restored from validated backup: ${backupPath}`)
    }
    return result.value
  } catch (error) {
    throw new Error(`${label} data rejected; refusing to continue. ${error.message}`)
  }
}

const readPresentationsCache = () => {
  const filePath = path.join(rootDir, 'presentations.json')
  presentationsCache = normalizePresentations(
    readValidatedJsonWithRecovery(filePath, [], validatePresentationsPayload, 'PRESENTATIONS')
  )
  publicPresentationsCache = buildPublicPresentations(presentationsCache, getPublicCatalogs())
  return presentationsCache
}

const readAudioSyncMapsCache = () => {
  const filePath = path.join(rootDir, 'audio_sync.json')
  audioSyncMapsCache = readValidatedJsonWithRecovery(
    filePath,
    [],
    validateAudioSyncPayload,
    'AUDIO_SYNC'
  )
  return audioSyncMapsCache
}

const getPresentationForSyncMap = (syncMap) => {
  if (!syncMap?.presentationId) return null
  if (currentState.presentation?.id === syncMap.presentationId) return currentState.presentation
  return presentationsCache.find((presentation) => presentation.id === syncMap.presentationId) || null
}

const walkAssets = (directories, matcher) => {
  const results = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file)
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (matcher.test(fullPath)) {
        const relPath = path.relative(publicDir, fullPath).replace(/\\/g, '/')
        results.push(`/${relPath}`)
      }
    }
  }
  directories.forEach(walk)
  return results
}

const makeAudienceStateSnapshot = () => ({
  ...deriveAudienceProjectionState(currentState),
  presentationSessionId: getPresentationSessionId(),
  serverEpoch: getServerEpoch(),
  stateRevision: audienceStateRevision,
  eventId: audienceEventId,
})

const broadcast = (body) => {
  writeSseSet(clients, body)
  const audienceBody = JSON.stringify(makeAudienceStateSnapshot())
  for (const client of audienceClients) {
    if (
      getSessionAccessMode() === 'CONTROLLED' &&
      !isAudienceParticipantAdmitted(client.audienceParticipantId)
    ) {
      audienceClients.delete(client)
      client.end()
      continue
    }
    writeSse(audienceClients, client, audienceBody)
  }
}

const broadcastQuizAnswer = (body, parsed) => {
  const type = parsed?.type
  const isSensitive = type === 'QUIZ_ANSWER' || type === 'QUIZ_FINAL_SCORE'

  for (const client of quizClients) {
    if (
      getSessionAccessMode() === 'CONTROLLED' &&
      client.audienceParticipantId &&
      !isAudienceParticipantAdmitted(client.audienceParticipantId)
    ) {
      quizClients.delete(client)
      client.end()
      continue
    }
    if (isSensitive && !client.isControl) {
      continue
    }
    writeSse(quizClients, client, body)
  }
}

const scoreBucketForCentipunts = (value) => {
  if (!Number.isFinite(value)) return null
  const score = Math.max(0, Math.floor(value))
  const lower = Math.floor(score / 100) * 100
  return `${lower}-${lower + 99}`
}

const quizScopePrefix = (presentationId) => `${encodeURIComponent(presentationId)}::`
const quizScopedKey = (presentationId, value) => `${quizScopePrefix(presentationId)}${value}`
const clearQuizScope = (presentationId) => {
  const prefix = quizScopePrefix(presentationId)
  for (const key of quizAggregateState.submittedSessionsBySlideId.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.submittedSessionsBySlideId.delete(key)
  }
  for (const key of quizAggregateState.finalScoreBuckets.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.finalScoreBuckets.delete(key)
  }
  for (const key of quizAggregateState.finalScoreSessions.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.finalScoreSessions.delete(key)
  }
  for (const key of quizAggregateState.answerSessions.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.answerSessions.delete(key)
  }
  for (const key of quizAggregateState.finalScoreValues.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.finalScoreValues.delete(key)
  }
}

const canAcceptQuizAggregateMessage = (message) => {
  const activePresentationId = currentState.presentation?.id
  if (!activePresentationId || message.presentationId !== activePresentationId) {
    return 'Quiz message does not match the active presentation'
  }
  if (message.type !== 'QUIZ_ANSWER' && message.type !== 'QUIZ_FINAL_SCORE') return null
  const prefix = quizScopePrefix(activePresentationId)
  const sessionKey = quizScopedKey(activePresentationId, message.sessionId)
  const knownSession = quizAggregateState.answerSessions.has(sessionKey) || quizAggregateState.finalScoreSessions.has(sessionKey)
  if (!knownSession) {
    const knownSessionIds = new Set([
      ...Array.from(quizAggregateState.answerSessions.keys()).filter((key) => key.startsWith(prefix)),
      ...Array.from(quizAggregateState.finalScoreSessions.keys()).filter((key) => key.startsWith(prefix)),
    ])
    if (knownSessionIds.size >= maxQuizSessionsPerPresentation) return 'Quiz session capacity reached'
  }
  if (message.type === 'QUIZ_ANSWER') {
    const session = quizAggregateState.answerSessions.get(sessionKey)
    if (session && !session.answers?.[message.slideId] && Object.keys(session.answers || {}).length >= maxQuizAnswersPerSession) {
      return 'Quiz answer capacity reached'
    }
  }
  return null
}

const updateQuizAggregate = (message) => {
  if (!isObjectRecord(message)) return
  const now = Date.now()
  const presentationId = typeof message.presentationId === 'string' && message.presentationId
    ? message.presentationId
    : currentState.presentation?.id
  if (!presentationId) return

  if (message.type === 'QUIZ_ANSWER') {
    if (typeof message.sessionId !== 'string' || typeof message.slideId !== 'string') return
    if (!isObjectRecord(message.answer) || message.answer.submitted !== true) return

    const slideKey = quizScopedKey(presentationId, message.slideId)
    const sessions = quizAggregateState.submittedSessionsBySlideId.get(slideKey) || new Set()
    sessions.add(message.sessionId)
    quizAggregateState.submittedSessionsBySlideId.set(slideKey, sessions)
    const sessionKey = quizScopedKey(presentationId, message.sessionId)
    const existingSession = quizAggregateState.answerSessions.get(sessionKey) || {
      sessionId: message.sessionId,
      presentationId,
      answers: {},
    }
    quizAggregateState.answerSessions.set(sessionKey, {
      ...existingSession,
      displayName: typeof message.displayName === 'string' ? message.displayName.slice(0, 80) : existingSession.displayName,
      answers: {
        ...existingSession.answers,
        [message.slideId]: {
          slideId: message.slideId,
          selectedOptionIds: Array.isArray(message.answer.selectedOptionIds)
            ? message.answer.selectedOptionIds.filter((id) => typeof id === 'string')
            : [],
          submitted: true,
          submittedAt: Number.isFinite(message.answer.submittedAt) ? message.answer.submittedAt : now,
          bonusReadingClaimed: message.answer.bonusReadingClaimed === true,
          ...(typeof message.answer.citaBook === 'string' ? { citaBook: message.answer.citaBook.slice(0, 80) } : {}),
          ...(typeof message.answer.citaChapter === 'string' ? { citaChapter: message.answer.citaChapter.slice(0, 16) } : {}),
          ...(typeof message.answer.citaVerseStart === 'string' ? { citaVerseStart: message.answer.citaVerseStart.slice(0, 16) } : {}),
          ...(typeof message.answer.citaVerseEnd === 'string' ? { citaVerseEnd: message.answer.citaVerseEnd.slice(0, 16) } : {}),
        },
      },
    })
    quizAggregateState.updatedAt = now
    return
  }

  if (message.type === 'QUIZ_FINAL_SCORE') {
    if (typeof message.sessionId !== 'string' || !Number.isFinite(message.totalCentipunts)) return
    const sessionKey = quizScopedKey(presentationId, message.sessionId)
    const previousBucket = quizAggregateState.finalScoreSessions.get(sessionKey)
    if (previousBucket) {
      const previousCount = quizAggregateState.finalScoreBuckets.get(previousBucket) || 0
      if (previousCount <= 1) quizAggregateState.finalScoreBuckets.delete(previousBucket)
      else quizAggregateState.finalScoreBuckets.set(previousBucket, previousCount - 1)
    }

    const rawBucket = scoreBucketForCentipunts(message.totalCentipunts)
    const bucket = rawBucket ? quizScopedKey(presentationId, rawBucket) : null
    if (!bucket) return
    quizAggregateState.finalScoreSessions.set(sessionKey, bucket)
    quizAggregateState.finalScoreValues.set(sessionKey, Math.max(0, Math.floor(message.totalCentipunts)))
    quizAggregateState.finalScoreBuckets.set(bucket, (quizAggregateState.finalScoreBuckets.get(bucket) || 0) + 1)
    quizAggregateState.updatedAt = now
    return
  }

  if (message.type === 'QUIZ_CLEAR_ANSWERS') {
    if (typeof message.slideId === 'string') {
      quizAggregateState.submittedSessionsBySlideId.delete(quizScopedKey(presentationId, message.slideId))
      const prefix = quizScopePrefix(presentationId)
      for (const [key, session] of quizAggregateState.answerSessions.entries()) {
        if (!key.startsWith(prefix) || !session.answers?.[message.slideId]) continue
        const answers = { ...session.answers }
        delete answers[message.slideId]
        quizAggregateState.answerSessions.set(key, { ...session, answers })
      }
      for (const key of quizAggregateState.finalScoreBuckets.keys()) {
        if (key.startsWith(prefix)) quizAggregateState.finalScoreBuckets.delete(key)
      }
      for (const key of quizAggregateState.finalScoreSessions.keys()) {
        if (key.startsWith(prefix)) quizAggregateState.finalScoreSessions.delete(key)
      }
      for (const key of quizAggregateState.finalScoreValues.keys()) {
        if (key.startsWith(prefix)) quizAggregateState.finalScoreValues.delete(key)
      }
    } else {
      clearQuizScope(presentationId)
    }
    quizAggregateState.updatedAt = now
  }
}

const getQuizAggregateSnapshot = () => {
  const presentationId = currentState.presentation?.id
  if (!presentationId) return {
    submittedAnswersBySlideId: {},
    finalScoreRanges: {},
    totalFinalScores: 0,
    updatedAt: quizAggregateState.updatedAt,
  }
  const prefix = quizScopePrefix(presentationId)
  const scopedFinalSessions = Array.from(quizAggregateState.finalScoreSessions.keys())
    .filter((key) => key.startsWith(prefix))
  return ({
  submittedAnswersBySlideId: Object.fromEntries(
    Array.from(quizAggregateState.submittedSessionsBySlideId.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, sessions]) => [key.slice(prefix.length), sessions.size]),
  ),
  finalScoreRanges: Object.fromEntries(
    Array.from(quizAggregateState.finalScoreBuckets.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, count]) => [key.slice(prefix.length), count]),
  ),
  totalFinalScores: scopedFinalSessions.length,
  updatedAt: quizAggregateState.updatedAt,
  })
}

const getQuizControlSnapshot = (presentationId) => {
  const prefix = quizScopePrefix(presentationId)
  return {
    type: 'QUIZ_SESSION_SNAPSHOT',
    presentationId,
    sessions: Object.fromEntries(
      Array.from(quizAggregateState.answerSessions.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, session]) => [key.slice(prefix.length), session]),
    ),
    sessionTotalScores: Object.fromEntries(
      Array.from(quizAggregateState.finalScoreValues.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, score]) => [key.slice(prefix.length), score]),
    ),
    updatedAt: quizAggregateState.updatedAt,
  }
}

const logStateChange = (state) => {
  // Removed spammy log
}

const commitState = (state, metadata = {}) => {
  currentState = makeProjectionSyncStateMessage(state, {
    clientId: metadata.clientId,
    origin: metadata.origin,
    now: metadata.now,
    messageId: metadata.messageId,
  })
  audienceStateRevision += 1
  audienceEventId = randomUUID()
  logStateChange(currentState)
  broadcast(JSON.stringify(currentState))
  return currentState
}

const canReduceRemoteCommand = (sourceMeta) => {
  if (!sourceMeta) return true
  if (sourceMeta.role !== 'control') return false
  if (!sourceMeta.controlSessionId) return true
  return isLiveAudioControlAuthorized(sourceMeta.controlSessionId)
}

const broadcastTimelineState = () => {
  broadcastWs({
    type: 'AUDIO_TIMELINE_STATE',
    timeline: getTimeline(),
  })
}

const syncTimelineToSlideSelection = (payload, now = Date.now()) => {
  const tl = getTimeline()
  if (tl.syncMode !== 'bilateral' || !tl.syncMapId) return

  const syncMap = audioSyncMapsCache.find((map) => map.id === tl.syncMapId)
  if (!syncMap || !Array.isArray(syncMap.cues) || syncMap.cues.length === 0) return

  const presentation = payload.presentation || currentState.presentation
  if (!presentation || presentation.id !== syncMap.presentationId) return

  const targetVerse = payload.targetVerse || currentState.scriptureState?.verse
  const match = findCueForSlideSelection(syncMap, payload.slideIndex, targetVerse)
  if (!match) return

  const currentPositionSec = estimateTimelinePositionSec(tl, now)
  if (Math.abs(currentPositionSec - match.cue.timeSec) <= 1.0) return

  applyAction({ type: 'SEEK', positionSec: match.cue.timeSec })
  lastSyncMapId = tl.syncMapId
  lastActiveCueIndex = match.index
  broadcastTimelineState()
}

const reduceRemoteCommandMessage = (message, sourceMeta) => {
  if (!isObjectRecord(message) || message.type !== 'REMOTE_COMMAND') {
    return { ok: false, status: 400, error: 'Invalid remote command message' }
  }
  if (typeof message.clientId !== 'string') {
    return { ok: false, status: 400, error: 'REMOTE_COMMAND missing clientId' }
  }

  if (!canReduceRemoteCommand(sourceMeta)) {
    return { ok: false, status: 403, error: 'Control is not authorized to mutate projection state' }
  }

  const now = Date.now()
  const result = reduceProjectionCommand(currentState, message.payload, {
    clientId: message.clientId,
    origin: 'control',
    now,
  })
  if (!result.ok) {
    return { ok: false, status: 400, error: result.error }
  }

  if (message.payload.command === 'RESET_STATE' && message.payload.clearSession === true) {
    const presentationId = currentState.presentation?.id
    if (presentationId) clearQuizScope(presentationId)
  }

  const committedState = commitState(result.state, {
    clientId: message.clientId,
    origin: 'control',
    now,
  })

  if (message.payload.command === 'SELECT_PRESENTATION_AND_SLIDE') {
    syncTimelineToSlideSelection(message.payload, now)
  }

  return {
    ok: true,
    state: committedState,
  }
}

const heartbeatSseClients = () => {
  writeSseSet(clients, 'heartbeat')
  writeSseSet(audienceClients, 'heartbeat')
  writeSseSet(quizClients, 'heartbeat')
}

const requireAuth = (req, res, url) => {
  if (!isProtectedRequestPath(url.pathname, req.method || 'GET')) return false
  if (hasValidBasicAuth(req)) return false

  if (url.pathname.startsWith('/api/')) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Authentication required' }))
    return true
  }

  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="SeferPresenter"',
  })
  res.end('Authentication required')
  return true
}

const handleApi = async (req, res, url) => {
  if (url.pathname === '/api/audience/access/bootstrap' && req.method === 'POST') {
    try {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      sendJson(res, 200, bootstrapAudienceAccess(body.credential))
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid access bootstrap request' })
    }
    return true
  }

  if (url.pathname === '/api/privacy-document' && req.method === 'GET') {
    sendJson(res, 200, {
      operator: operatorManifest,
      markdown: privacyLocalMarkdown,
    })
    return true
  }

  if (url.pathname === '/api/audience/sse-ticket' && req.method === 'POST') {
    const credential = getBearerCredential(req)
    let purpose = 'STATE'
    try {
      const raw = await readBody(req)
      if (raw) {
        const body = JSON.parse(raw)
        if (body.purpose === 'QUIZ') purpose = 'QUIZ'
      }
    } catch {
      sendJson(res, 400, { error: 'Invalid SSE ticket request' })
      return true
    }
    const ticket = issueAudienceSseTicket(credential, purpose)
    if (!ticket) {
      sendJson(res, 403, { error: 'Audience admission is required' })
      return true
    }
    sendJson(res, 200, { ticket, expiresInSeconds: 30 })
    return true
  }

  if (url.pathname === '/api/audience/access/logout' && req.method === 'POST') {
    const removed = logoutAudienceCredential(getBearerCredential(req))
    sendJson(res, removed ? 200 : 401, { success: removed })
    return true
  }

  if (url.pathname.startsWith('/api/livekit/')) {
    const handled = await liveKitApi.handle({ req, res, url, readBody, sendJson })
    if (handled) return true
  }

  if (url.pathname === '/api/state-events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    registerSseClient(clients, res)
    writeSse(clients, res, JSON.stringify(currentState))
    return true
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, currentState)
    return true
  }

  if (url.pathname === '/api/audience/state' && req.method === 'GET') {
    if (
      getSessionAccessMode() === 'CONTROLLED' &&
      !authorizeAudienceCredential(getBearerCredential(req))
    ) {
      sendJson(res, 403, { error: 'Audience admission is required' })
      return true
    }
    sendJson(res, 200, makeAudienceStateSnapshot())
    return true
  }

  if (url.pathname === '/api/audience/events' && req.method === 'GET') {
    const ticket = url.searchParams.get('ticket')
    const ticketAccess = ticket ? consumeAudienceSseTicket(ticket, 'STATE') : null
    if (getSessionAccessMode() === 'CONTROLLED' && !ticketAccess) {
      sendJson(res, 403, { error: 'A valid one-use Audience SSE ticket is required' })
      return true
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    registerSseClient(audienceClients, res)
    res.audienceParticipantId = ticketAccess?.participantId
    writeSse(audienceClients, res, JSON.stringify(makeAudienceStateSnapshot()))
    return true
  }

  if (url.pathname === '/api/quiz-events' && req.method === 'GET') {
    const ticket = url.searchParams.get('ticket')
    const ticketAccess = ticket ? consumeAudienceSseTicket(ticket, 'QUIZ') : null
    if (getSessionAccessMode() === 'CONTROLLED' && !ticketAccess) {
      sendJson(res, 403, { error: 'A valid one-use Audience quiz ticket is required' })
      return true
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.isControl = !ticketAccess && (hasValidBasicAuth(req) || !isAuthRequired())
    res.audienceParticipantId = ticketAccess?.participantId
    registerSseClient(quizClients, res)
    return true
  }

  if (url.pathname === '/api/quiz-control-state' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req))
      if (typeof body.presentationId !== 'string' || !body.presentationId) {
        sendJson(res, 400, { error: 'presentationId is required' })
        return true
      }
      sendJson(res, 200, getQuizControlSnapshot(body.presentationId))
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/quiz-answer' && req.method === 'POST') {
    if (
      getSessionAccessMode() === 'CONTROLLED' &&
      !authorizeAudienceCredential(getBearerCredential(req))
    ) {
      sendJson(res, 403, { error: 'Audience admission is required' })
      return true
    }
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body)
      const validationError = validatePublicQuizMessage(parsed)
      if (validationError) {
        sendJson(res, 400, { error: validationError })
        return true
      }
      if (parsed.type === 'QUIZ_CLEAR_ANSWERS' && isAuthRequired() && !hasValidBasicAuth(req)) {
        sendJson(res, 401, { error: 'Authentication required to clear quiz answers' })
        return true
      }
      const aggregateError = canAcceptQuizAggregateMessage(parsed)
      if (aggregateError) {
        sendJson(res, 409, { error: aggregateError })
        return true
      }
      updateQuizAggregate(parsed)
      broadcastQuizAnswer(body, parsed)
      sendJson(res, 200, { success: true })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/state' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body)
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        typeof parsed.clientId !== 'string' ||
        typeof parsed.slideIndex !== 'number'
      ) {
        sendJson(res, 400, { error: 'Invalid state payload: missing or invalid clientId or slideIndex' })
        return true
      }
      commitState(normalizeProjectionState(parsed), {
        clientId: parsed.clientId,
        origin: parsed.origin === 'presenter' ? 'presenter' : 'control',
        now: parsed.timestamp,
        messageId: parsed.messageId,
      })
      sendJson(res, 200, { success: true })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/command' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body)
      const result = reduceRemoteCommandMessage(parsed)
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error })
        return true
      }
      sendJson(res, 200, { success: true, state: result.state })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/audio-telemetry' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const telemetry = JSON.parse(body)
      const error = validateTelemetry(
        telemetry,
        'AUDIO_TELEMETRY',
        (value) => isObjectRecord(value.audioState)
      )
      if (error) {
        sendJson(res, 400, { error })
        return true
      }
      
      currentState = { ...currentState, audioState: telemetry.audioState }
      broadcast(JSON.stringify(telemetry))
      sendJson(res, 200, { success: true })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/video-telemetry' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const telemetry = JSON.parse(body)
      const error = validateTelemetry(
        telemetry,
        'VIDEO_TELEMETRY',
        (value) => value.videoState === null || isObjectRecord(value.videoState)
      )
      if (error) {
        sendJson(res, 400, { error })
        return true
      }

      currentState = { ...currentState, videoState: telemetry.videoState }
      broadcast(JSON.stringify(telemetry))
      sendJson(res, 200, { success: true })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/display-telemetry' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const telemetry = JSON.parse(body)
      const error = validateTelemetry(
        telemetry,
        'DISPLAY_TELEMETRY',
        (value) =>
          typeof value.backgroundLock === 'boolean' &&
          isNullableString(value.lockedBackgroundValue) &&
          isNullableString(value.userSelectedBackground)
      )
      if (error) {
        sendJson(res, 400, { error })
        return true
      }
      currentState = {
        ...currentState,
        backgroundLock: telemetry.backgroundLock,
        lockedBackgroundValue: telemetry.lockedBackgroundValue,
        userSelectedBackground: telemetry.userSelectedBackground,
      }
      broadcast(JSON.stringify(telemetry))
      sendJson(res, 200, { success: true })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/backgrounds' && req.method === 'GET') {
    const backgrounds = walkAssets(
      [path.join(publicDir, 'backgrounds'), path.join(publicDir, 'videos')],
      /\.(avif|gif|jpe?g|png|svg|webp|mp4|webm)$/i
    )
    sendJson(res, 200, backgrounds)
    return true
  }

  if (url.pathname === '/api/audio' && req.method === 'GET') {
    const audio = walkAssets([path.join(publicDir, 'audio')], /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i)
    sendJson(res, 200, audio)
    return true
  }

  if (url.pathname === '/api/audio-sync' && req.method === 'GET') {
    sendJson(res, 200, readAudioSyncMapsCache())
    return true
  }

  if (url.pathname === '/api/audio-sync' && req.method === 'POST') {
    try {
      const parsed = JSON.parse(await readBody(req))
      const validation = validateAudioSyncPayload(parsed)
      if (!validation.ok) {
        sendJson(res, 400, { error: `Invalid audio sync payload: ${formatValidationError(validation)}` })
        return true
      }
      persistJson(path.join(rootDir, 'audio_sync.json'), validation.value)
      audioSyncMapsCache = validation.value
      sendJson(res, 200, { success: true })
    } catch (err) {
      const status = err instanceof SyntaxError ? 400 : 500
      sendJson(res, status, { error: status === 400 ? 'Invalid JSON' : 'Unable to persist audio sync data' })
    }
    return true
  }

  if (url.pathname === '/api/presentations' && req.method === 'GET') {
    try {
      sendJson(res, 200, readPresentationsCache())
    } catch {
      sendJson(res, 500, { error: 'Invalid presentations JSON' })
    }
    return true
  }

  if (url.pathname === '/api/presentations' && req.method === 'POST') {
    try {
      const parsed = JSON.parse(await readBody(req))
      const validation = validatePresentationsPayload(parsed)
      if (!validation.ok) {
        sendJson(res, 400, { error: `Invalid presentations payload: ${formatValidationError(validation)}` })
        return true
      }
      const presentations = normalizePresentations(validation.value)
      persistJson(path.join(rootDir, 'presentations.json'), presentations)
      presentationsCache = presentations
      publicPresentationsCache = buildPublicPresentations(presentationsCache, getPublicCatalogs())
      sendJson(res, 200, { success: true })
    } catch (err) {
      const status = err instanceof SyntaxError ? 400 : 500
      sendJson(res, status, { error: status === 400 ? 'Invalid JSON' : 'Unable to persist presentations' })
    }
    return true
  }

  if (url.pathname === '/api/public-catalogs' && req.method === 'GET') {
    sendJson(res, 200, getPublicCatalogs())
    return true
  }

  const catalogMatch = url.pathname.match(/^\/api\/public-catalogs\/([^/]+)\/presentations(?:\/([^/]+))?$/)
  if (catalogMatch && req.method === 'GET') {
    const catalogId = catalogMatch[1]
    const presentationId = catalogMatch[2]
    
    const catalogs = getPublicCatalogs()
    const catalog = catalogs.find(c => c.id === catalogId)
    
    if (!catalog) {
      sendJson(res, 404, { error: 'Catalog not found' })
      return true
    }

    const catalogPresentations = publicPresentationsCache.filter(p => p.tags.some(t => catalog.tags.includes(t)))

    if (presentationId) {
      const pres = catalogPresentations.find(p => p.id === presentationId)
      if (pres) {
        sendJson(res, 200, pres)
      } else {
        sendJson(res, 404, { error: 'Presentation not found in catalog' })
      }
    } else {
      sendJson(res, 200, catalogPresentations)
    }
    return true
  }

  if (url.pathname === '/api/audience-cache-assets' && req.method === 'GET') {
    const filePath = path.join(publicDir, 'audience-cache-assets.txt')
    if (!fs.existsSync(filePath)) {
      sendJson(res, 200, [])
      return true
    }
    const assets = fs.readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .filter((line) => line.startsWith('/'))
    sendJson(res, 200, assets)
    return true
  }

  return false
}

const serveFile = (req, res, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const contentType = contentTypes[ext] || 'application/octet-stream'

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'File not found' }))
    return
  }

  const stat = fs.statSync(filePath)
  const totalSize = stat.size
  const range = req.headers.range

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-")
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1

    if (start >= totalSize || end >= totalSize || start > end) {
      res.writeHead(416, {
        'Content-Range': `bytes */${totalSize}`,
        'Content-Type': 'text/plain'
      })
      res.end('Requested range not satisfiable')
      return
    }

    const chunksize = (end - start) + 1
    const file = fs.createReadStream(filePath, { start, end })
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    })
    file.pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': totalSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType
    })
    fs.createReadStream(filePath).pipe(res)
  }
}

const handleStatic = (req, res, url) => {
  if (!staticDir) return false
  const requestedPath = decodeURIComponent(url.pathname)
  const cleanPath = requestedPath === '/' ? '/audience' : requestedPath
  const candidate = resolvePathInsideRoot(staticDir, cleanPath)

  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    serveFile(req, res, candidate)
    return true
  }

  const publicCandidate = resolvePathInsideRoot(publicDir, cleanPath)
  if (publicCandidate && fs.existsSync(publicCandidate) && fs.statSync(publicCandidate).isFile()) {
    serveFile(req, res, publicCandidate)
    return true
  }

  const publicCatalogs = getPublicCatalogs()
  const isCatalogRoute = publicCatalogs.some((cat) => cleanPath === cat.path || cleanPath.startsWith(cat.path + '/'))

  const htmlFile = cleanPath.startsWith('/presenter')
    ? 'presenter.html'
    : cleanPath.startsWith('/control')
      ? 'control.html'
      : cleanPath.startsWith('/audio-editor')
        ? 'audio-editor.html'
        : isCatalogRoute
          ? 'catalog.html'
          : 'audience.html'

  const htmlPath = path.join(staticDir, htmlFile)
  if (fs.existsSync(htmlPath)) {
    serveFile(req, res, htmlPath)
    return true
  }

  const catalogs = getPublicCatalogs()
  if (catalogs.some(c => cleanPath.startsWith(c.path))) {
    const catalogHtmlPath = path.join(staticDir, 'catalog.html')
    if (fs.existsSync(catalogHtmlPath)) {
      serveFile(req, res, catalogHtmlPath)
      return true
    }
  }

  return false
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET') && !hasAllowedRequestOrigin(req)) {
    sendJson(res, 403, { error: 'Request origin is not allowed' })
    return
  }

  if (requireAuth(req, res, url)) return

  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, url)
    if (!handled) sendJson(res, 404, { error: 'Not found' })
    return
  }

  if (handleStatic(req, res, url)) return

  sendJson(res, 404, { error: 'Static file not found' })
})

const handleWsMessageFromClient = (msg, meta) => {
  if (msg.type === 'SYNC_STATE') {
    if (meta?.role === 'control' && !canReduceRemoteCommand(meta)) return false
    commitState(normalizeProjectionState(msg), {
      clientId: msg.clientId,
      origin: msg.origin === 'presenter' ? 'presenter' : 'control',
      now: msg.timestamp,
      messageId: msg.messageId,
    })
    return true
  } else if (msg.type === 'REMOTE_COMMAND') {
    const result = reduceRemoteCommandMessage(msg, meta)
    if (!result.ok) {
      console.warn(`[SERVER] Command rejected role=${meta?.role || 'http'} error=${result.error}`)
    }
    return result.ok
  } else if (msg.type === 'AUDIO_TELEMETRY') {
    currentState = { ...currentState, audioState: msg.audioState }
    broadcast(JSON.stringify(msg))
    if (meta?.role === 'presenter' || msg.audioState.lastUpdatedBy === 'projection') {
      const tl = getTimeline();
      const currentEstimated = tl.status === 'playing'
        ? tl.basePositionSec + ((Date.now() - tl.baseServerTimeMs) / 1000) * tl.playbackRate
        : tl.basePositionSec;
      if (Math.abs(currentEstimated - msg.audioState.currentTime) > 1.0) {
        applyAction({ type: 'SEEK', positionSec: msg.audioState.currentTime });
        broadcastWs({ type: 'AUDIO_TIMELINE_STATE', timeline: getTimeline() });
      }
    }
    return true
  } else if (msg.type === 'VIDEO_TELEMETRY') {
    currentState = { ...currentState, videoState: msg.videoState }
    broadcast(JSON.stringify(msg))
    return true
  } else if (msg.type === 'DISPLAY_TELEMETRY') {
    currentState = {
      ...currentState,
      backgroundLock: msg.backgroundLock,
      lockedBackgroundValue: msg.lockedBackgroundValue,
      userSelectedBackground: msg.userSelectedBackground,
    }
    broadcast(JSON.stringify(msg))
    return true
  }
  return false
}

const sseHeartbeat = setInterval(heartbeatSseClients, sseHeartbeatMs)
sseHeartbeat.unref?.()

let lastActiveCueIndex = -1
let lastSyncMapId = null

const evaluateServerCues = () => {
  const tl = getTimeline()
  if (tl.status !== 'playing' || tl.syncMode === 'none' || !tl.syncMapId) return

  const syncMap = audioSyncMapsCache.find(m => m.id === tl.syncMapId)
  if (!syncMap || !syncMap.cues || syncMap.cues.length === 0) return
  const presentation = getPresentationForSyncMap(syncMap)
  if (!presentation) return

  const now = Date.now()
  const currentPos = estimateTimelinePositionSec(tl, now)
  const activeCueIdx = findActiveCueIndex(syncMap.cues, currentPos)

  if (tl.syncMapId !== lastSyncMapId) {
    lastSyncMapId = tl.syncMapId
    lastActiveCueIndex = -1
  }

  if (activeCueIdx !== -1 && activeCueIdx !== lastActiveCueIndex) {
    lastActiveCueIndex = activeCueIdx
    const cue = syncMap.cues[activeCueIdx]

    reduceRemoteCommandMessage({
      type: 'REMOTE_COMMAND',
      clientId: 'server',
      payload: {
        command: 'SELECT_PRESENTATION_AND_SLIDE',
        presentation,
        slideIndex: cue.slideIndex,
        direction: cue.slideIndex < currentState.slideIndex ? 'backward' : 'forward',
        targetVerse: cue.verse
      }
    }, null)
  }
}

const serverCueInterval = setInterval(evaluateServerCues, 100)
serverCueInterval.unref?.()

server.on('close', () => {
  clearInterval(sseHeartbeat)
  clearInterval(serverCueInterval)
  liveKitApi?.close()
})

liveKitApi = createLiveKitApi({
  authorizeAudienceCredential,
  getSessionAccessMode,
  getLiveAudioControlSnapshot,
  getLiveAudioParticipantState,
  isLiveAudioControlAuthorized,
  getRecordingPolicy,
  hasCurrentRecordingConfirmation,
})

let wsServer

readAudioSyncMapsCache()
readPresentationsCache()
server.listen(port, () => {
  const staticLabel = staticDir ? `, serving ${path.relative(rootDir, staticDir)}` : ''
  wsServer = createWsServer(server, handleWsMessageFromClient, {
    getLiveKitState: () => liveKitApi?.getState?.() || {
      enabled: false,
      available: false,
      participants: [],
      speakers: [],
      muted: [],
      kicked: [],
    },
    getQuizAggregateSnapshot,
    recordingPolicy: operatorManifest,
    revokeLiveAudioPublishingForRecording: () =>
      liveKitApi?.revokeAudiencePublishingForRecording?.(),
  })
  console.log(`SeferPresenter local backend listening on http://localhost:${port}${staticLabel}`)
  console.log(`SeferPresenter WebSocket disponible en ws://localhost:${port}/ws`)
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(sseHeartbeat)
  clearInterval(serverCueInterval)
  for (const clientSet of [clients, audienceClients, quizClients]) {
    for (const response of clientSet) response.end()
    clientSet.clear()
  }
  for (const client of wsServer?.clients || []) client.close(1001, 'Server shutting down')
  wsServer?.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref?.()
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
