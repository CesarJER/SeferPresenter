import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadProjectEnvironment } from './env-utils.mjs'
import { loadI18nConfig } from './i18n-config.mjs'
import { createLiveKitApi } from './livekit-server.mjs'
import {
  createWsServer,
  authorizeOperatorCredential,
  getLiveAudioControlSnapshot,
  getLiveAudioParticipantState,
  isLiveAudioControlAuthorized,
  authorizeAudienceCredential,
  bootstrapAudienceAccess,
  consumeAudienceSseTicket,
  getSessionAccessMode,
  issueAudienceSseTicket,
} from './ws-server.mjs'
import {
  hasAllowedRequestOrigin,
  hasValidBasicAuth,
  isAuthRequired,
  isProtectedRequestPath,
} from './authUtils.mjs'
import { createVoiceScriptureService } from './voice-scripture-server.mjs'
import {
  getDefaultProjectionState,
  makeAudienceSyncStateMessage,
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
import {
  isQuizAggregateGroupPublishable,
  QUIZ_MIN_AGGREGATE_GROUP_SIZE,
  validatePublicQuizMessage,
} from './quiz-message-validation.mjs'
import {
  formatValidationError,
  validateAudioSyncPayload,
  validatePresentationsPayload,
} from './content-validation.mjs'
import { writeJsonSafely } from './json-persistence.mjs'
import { createPresentationSessionStore } from './presentation-session.mjs'
import { resolvePathInsideRoot } from './path-containment.mjs'
import { createPrivacySessionManifestRecorder } from './privacy-session-manifest.mjs'
import { getStaticCacheHeaders } from './static-cache-policy.mjs'
import { loadBrandingAsset } from './branding-assets.mjs'
import { loadLegalRepository } from './legal-repository.mjs'
import {
  getSeferDataPaths,
  initializeSeferDataDir,
  resolveSeferDataDir,
} from './data-directory.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

loadProjectEnvironment(rootDir)

const productStaticDir = path.join(rootDir, 'static')
const exampleDataDir = path.join(rootDir, 'examples', 'SeferPrivateData')
const seferDataDir = resolveSeferDataDir({ rootDir })
const dataInitialization = initializeSeferDataDir({ dataDir: seferDataDir, exampleDir: exampleDataDir })
const seferDataPaths = getSeferDataPaths(seferDataDir)
const publicI18nConfig = loadI18nConfig(process.env.SEFER_I18N_CONFIG_PATH?.trim()
  ? path.resolve(rootDir, process.env.SEFER_I18N_CONFIG_PATH.trim()) : seferDataPaths.i18n)
const presentationSessionStore = createPresentationSessionStore({ filePath: seferDataPaths.presentationSession })
const legalRepository = loadLegalRepository({ dataDir: seferDataDir })
const legalDocuments = legalRepository.status === 'ACTIVE'
  ? new Map([
      ['/legal/privacy.md', legalRepository.documents.privacyPolicy],
      ['/legal/privacy-summary.md', legalRepository.documents.privacySummary],
    ])
  : new Map()
const brandingAssets = new Map([
  ['/api/branding/logo.svg', {
    overridePath: seferDataPaths.branding.logo,
    fallbackPath: path.join(rootDir, 'src', 'assets', 'branding', 'logo.svg'),
    cacheControl: 'public, max-age=604800, stale-while-revalidate=2592000',
    contentType: 'image/svg+xml; charset=utf-8',
  }],
  ['/api/branding/favicon.svg', {
    overridePath: seferDataPaths.branding.favicon,
    fallbackPath: path.join(rootDir, 'src', 'assets', 'branding', 'favicon.svg'),
    cacheControl: 'public, max-age=604800, stale-while-revalidate=2592000',
    contentType: 'image/svg+xml; charset=utf-8',
  }],
  ['/api/branding/welcome.md', {
    overridePath: seferDataPaths.branding.welcome,
    fallbackPath: path.join(exampleDataDir, 'branding', 'welcome.md'),
    cacheControl: 'public, max-age=300, must-revalidate',
    contentType: 'text/markdown; charset=utf-8',
  }],
])
const port = Number(process.env.SEFER_PORT || 8787)
const staticArgIndex = process.argv.indexOf('--static')
const staticDir = path.resolve(rootDir, staticArgIndex >= 0 ? process.argv[staticArgIndex + 1] || 'dist' : 'dist')
const sseHeartbeatMs = 30_000
const privacySessionManifestRecorder = createPrivacySessionManifestRecorder({
  publicDir: productStaticDir,
  policyEvidence: legalRepository.policyEvidence,
})

if (dataInitialization.created.length > 0) {
  console.info(`[DATA] Initialized ${dataInitialization.created.length} missing file(s) in SEFER_DATA_DIR`)
}

const stateEpoch = randomUUID()
let stateRevision = 0
let currentState = makeProjectionSyncStateMessage(getDefaultProjectionState(), {
  clientId: 'server',
  origin: 'control',
})

currentState = { ...currentState, stateEpoch, stateRevision }

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
  slides: new Map(),
  answerSubmissionHashesBySlideId: new Map(),
  resultSubmissionHashesBySlideId: new Map(),
  finalScoreBuckets: new Map(),
  finalScoreSubmissionHashes: new Map(),
  finalScoreRequestIds: new Map(),
  updatedAt: null,
}
const maxQuizSubmissionsPerAggregate = 5_000

const contentTypes = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
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
  res.setHeader('Cache-Control', 'no-store')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

const sendBrandingAsset = (req, res, assetConfig) => {
  try {
    const { body, etag } = loadBrandingAsset(assetConfig)
    const headers = {
      'Cache-Control': assetConfig.cacheControl,
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    }
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers)
      res.end()
      return
    }
    res.writeHead(200, {
      ...headers,
      'Content-Length': body.length,
      'Content-Type': assetConfig.contentType,
    })
    res.end(body)
  } catch {
    sendJson(res, 500, { error: 'Branding asset unavailable' })
  }
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

const readJsonFile = (filePath, fallback) => {
  if (!fs.existsSync(filePath)) return fallback
  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
  return JSON.parse(content)
}

const catalogEtag = (data) => '"' + createHash('sha256').update(JSON.stringify(data)).digest('hex') + '"'
const requireCatalogRevision = (req, res, current) => {
  const expected = req.headers['if-match']
  if (!expected) { sendJson(res, 428, { error: 'Reload the catalog before saving' }); return false }
  if (expected !== catalogEtag(current)) { sendJson(res, 412, { error: 'Catalog changed in another editor; your draft was not saved' }); return false }
  return true
}
const persistJson = (filePath, value) => {
  const configuredBackupDir = process.env.SEFER_BACKUP_DIR?.trim()
  const backupPath = configuredBackupDir
    ? path.join(configuredBackupDir, `${path.basename(filePath)}.bak`)
    : `${filePath}.bak`
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

const readPresentationsCache = () => {
  try {
    const validation = validatePresentationsPayload(readJsonFile(seferDataPaths.presentations, []))
    if (!validation.ok) throw new Error(formatValidationError(validation))
    presentationsCache = normalizePresentations(validation.value)
  } catch (error) {
    console.error(`[PRESENTATIONS] Stored data rejected: ${error.message}`)
    presentationsCache = []
  }
  publicPresentationsCache = buildPublicPresentations(presentationsCache, getPublicCatalogs(), {
    publicDataDir: seferDataPaths.public,
  })
  return presentationsCache
}

const readAudioSyncMapsCache = () => {
  try {
    const validation = validateAudioSyncPayload(readJsonFile(seferDataPaths.audioSync, []))
    if (!validation.ok) throw new Error(formatValidationError(validation))
    audioSyncMapsCache = validation.value
  } catch (error) {
    console.error(`[AUDIO_SYNC] Stored data rejected: ${error.message}`)
    audioSyncMapsCache = []
  }
  return audioSyncMapsCache
}

const getPresentationForSyncMap = (syncMap) => {
  if (!syncMap?.presentationId) return null
  if (currentState.presentation?.id === syncMap.presentationId) return currentState.presentation
  return presentationsCache.find((presentation) => presentation.id === syncMap.presentationId) || null
}

const walkAssets = (directory, matcher) => {
  const results = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file)
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (matcher.test(fullPath)) {
        const relPath = path.relative(directory, fullPath).replace(/\\/g, '/')
        results.push(`/${relPath}`)
      }
    }
  }
  walk(directory)
  return results
}

const broadcast = (body) => {
  const message = JSON.parse(body)
  if (['AUDIO_TELEMETRY', 'VIDEO_TELEMETRY', 'DISPLAY_TELEMETRY'].includes(message.type)) {
    currentState = { ...currentState, stateEpoch, stateRevision: ++stateRevision }
    body = JSON.stringify({ ...message, stateEpoch, stateRevision })
  }
  writeSseSet(clients, body)
  const audienceBody = JSON.stringify(makeAudienceSyncStateMessage(currentState))
  writeSseSet(audienceClients, audienceBody)
}

const broadcastQuizAnswer = (body, parsed) => {
  const type = parsed?.type
  const isSensitive = type === 'QUIZ_AGGREGATE_SNAPSHOT'

  for (const client of quizClients) {
    if (isSensitive && !client.isControl) {
      continue
    }
    writeSse(quizClients, client, body)
  }
}

const quizScopePrefix = (presentationId) => `${encodeURIComponent(presentationId)}::`
const quizScopedKey = (presentationId, value) => `${quizScopePrefix(presentationId)}${value}`
const hashQuizSubmissionId = (presentationId, kind, scope, submissionId) => createHash('sha256')
  .update(`${presentationId}\u001f${kind}\u001f${scope}\u001f${submissionId}`)
  .digest('base64url')

const clearQuizFinalScores = (presentationId) => {
  const prefix = quizScopePrefix(presentationId)
  for (const key of quizAggregateState.finalScoreBuckets.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.finalScoreBuckets.delete(key)
  }
  for (const key of quizAggregateState.finalScoreSubmissionHashes.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.finalScoreSubmissionHashes.delete(key)
  }
  quizAggregateState.finalScoreRequestIds.delete(presentationId)
}

const clearQuizScope = (presentationId) => {
  const prefix = quizScopePrefix(presentationId)
  for (const key of quizAggregateState.slides.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.slides.delete(key)
  }
  for (const key of quizAggregateState.answerSubmissionHashesBySlideId.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.answerSubmissionHashesBySlideId.delete(key)
  }
  for (const key of quizAggregateState.resultSubmissionHashesBySlideId.keys()) {
    if (key.startsWith(prefix)) quizAggregateState.resultSubmissionHashesBySlideId.delete(key)
  }
  clearQuizFinalScores(presentationId)
}

const canAcceptQuizAggregateMessage = (message) => {
  const activePresentationId = currentState.presentation?.id
  if (!activePresentationId || message.presentationId !== activePresentationId) {
    return 'Quiz message does not match the active presentation'
  }
  if (message.type === 'QUIZ_ANSWER_AGGREGATE' || message.type === 'QUIZ_QUESTION_RESULT_AGGREGATE') {
    const slideKey = quizScopedKey(activePresentationId, message.slideId)
    const store = message.type === 'QUIZ_ANSWER_AGGREGATE'
      ? quizAggregateState.answerSubmissionHashesBySlideId
      : quizAggregateState.resultSubmissionHashesBySlideId
    const submissions = store.get(slideKey)
    const hash = hashQuizSubmissionId(activePresentationId, message.type, message.slideId, message.submissionId)
    if (submissions && !submissions.has(hash) && submissions.size >= maxQuizSubmissionsPerAggregate) {
      return 'Quiz aggregate capacity reached'
    }
  }
  if (message.type === 'QUIZ_FINAL_SCORE_AGGREGATE') {
    const currentRequestId = quizAggregateState.finalScoreRequestIds.get(activePresentationId)
    if (currentRequestId !== undefined && message.requestId < currentRequestId) return 'Stale quiz result request'
    const requestKey = quizScopedKey(activePresentationId, `result:${message.requestId}`)
    const submissions = quizAggregateState.finalScoreSubmissionHashes.get(requestKey)
    const hash = hashQuizSubmissionId(activePresentationId, message.type, String(message.requestId), message.submissionId)
    if (submissions && !submissions.has(hash) && submissions.size >= maxQuizSubmissionsPerAggregate) {
      return 'Quiz aggregate capacity reached'
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

  if (message.type === 'QUIZ_ANSWER_AGGREGATE') {
    if (typeof message.submissionId !== 'string' || typeof message.slideId !== 'string') return
    const slideKey = quizScopedKey(presentationId, message.slideId)
    const hash = hashQuizSubmissionId(presentationId, message.type, message.slideId, message.submissionId)
    const submissions = quizAggregateState.answerSubmissionHashesBySlideId.get(slideKey) || new Set()
    if (submissions.has(hash)) return
    submissions.add(hash)
    quizAggregateState.answerSubmissionHashesBySlideId.set(slideKey, submissions)
    const aggregate = quizAggregateState.slides.get(slideKey) || {
      submittedCount: 0,
      optionCounts: {},
      citaHits: 0,
      citaMisses: 0,
    }
    const optionCounts = { ...aggregate.optionCounts }
    for (const optionId of new Set(message.selectedOptionIds)) {
      optionCounts[optionId] = (optionCounts[optionId] || 0) + 1
    }
    quizAggregateState.slides.set(slideKey, {
      ...aggregate,
      submittedCount: aggregate.submittedCount + 1,
      optionCounts,
    })
    quizAggregateState.updatedAt = now
    return
  }

  if (message.type === 'QUIZ_QUESTION_RESULT_AGGREGATE') {
    if (typeof message.submissionId !== 'string' || typeof message.slideId !== 'string') return
    const slideKey = quizScopedKey(presentationId, message.slideId)
    const hash = hashQuizSubmissionId(presentationId, message.type, message.slideId, message.submissionId)
    const submissions = quizAggregateState.resultSubmissionHashesBySlideId.get(slideKey) || new Set()
    if (submissions.has(hash)) return
    submissions.add(hash)
    quizAggregateState.resultSubmissionHashesBySlideId.set(slideKey, submissions)
    const aggregate = quizAggregateState.slides.get(slideKey) || {
      submittedCount: 0,
      optionCounts: {},
      citaHits: 0,
      citaMisses: 0,
    }
    quizAggregateState.slides.set(slideKey, {
      ...aggregate,
      citaHits: aggregate.citaHits + (message.isCitaCorrect ? 1 : 0),
      citaMisses: aggregate.citaMisses + (message.isCitaCorrect ? 0 : 1),
    })
    quizAggregateState.updatedAt = now
    return
  }

  if (message.type === 'QUIZ_FINAL_SCORE_AGGREGATE') {
    if (typeof message.submissionId !== 'string' || !Number.isInteger(message.requestId) || !Number.isInteger(message.rank)) return
    const currentRequestId = quizAggregateState.finalScoreRequestIds.get(presentationId)
    if (currentRequestId === undefined || message.requestId > currentRequestId) {
      clearQuizFinalScores(presentationId)
      quizAggregateState.finalScoreRequestIds.set(presentationId, message.requestId)
    } else if (message.requestId < currentRequestId) {
      return
    }
    const requestKey = quizScopedKey(presentationId, `result:${message.requestId}`)
    const hash = hashQuizSubmissionId(presentationId, message.type, String(message.requestId), message.submissionId)
    const submissions = quizAggregateState.finalScoreSubmissionHashes.get(requestKey) || new Set()
    if (submissions.has(hash)) return
    submissions.add(hash)
    quizAggregateState.finalScoreSubmissionHashes.set(requestKey, submissions)
    const bucket = quizScopedKey(presentationId, `result:${message.requestId}:rank:${message.rank}`)
    quizAggregateState.finalScoreBuckets.set(bucket, (quizAggregateState.finalScoreBuckets.get(bucket) || 0) + 1)
    quizAggregateState.updatedAt = now
    return
  }

  if (message.type === 'QUIZ_CLEAR_ANSWERS') {
    if (typeof message.slideId === 'string') {
      const slideKey = quizScopedKey(presentationId, message.slideId)
      quizAggregateState.slides.delete(slideKey)
      quizAggregateState.answerSubmissionHashesBySlideId.delete(slideKey)
      quizAggregateState.resultSubmissionHashesBySlideId.delete(slideKey)
      clearQuizFinalScores(presentationId)
    } else {
      clearQuizScope(presentationId)
    }
    quizAggregateState.updatedAt = now
  }
}

const getQuizAggregateSnapshot = () => {
  const presentationId = currentState.presentation?.id
  if (!presentationId) return {
    slides: {},
    submittedAnswersBySlideId: {},
    finalScoreRanges: {},
    totalFinalScores: 0,
    minimumGroupSize: QUIZ_MIN_AGGREGATE_GROUP_SIZE,
    finalScoreRequestId: null,
    updatedAt: quizAggregateState.updatedAt,
  }
  const prefix = quizScopePrefix(presentationId)
  const requestId = quizAggregateState.finalScoreRequestIds.get(presentationId)
  const requestKey = requestId === undefined ? null : quizScopedKey(presentationId, `result:${requestId}`)
  const rankPrefix = requestId === undefined
    ? null
    : quizScopedKey(presentationId, `result:${requestId}:rank:`)
  const slides = Object.fromEntries(
    Array.from(quizAggregateState.slides.entries())
      .filter(([key, aggregate]) => (
        key.startsWith(prefix)
        && isQuizAggregateGroupPublishable(aggregate.submittedCount)
      ))
      .map(([key, aggregate]) => [key.slice(prefix.length), aggregate]),
  )
  const rawTotalFinalScores = requestKey
    ? (quizAggregateState.finalScoreSubmissionHashes.get(requestKey)?.size || 0)
    : 0
  const publishFinalScores = isQuizAggregateGroupPublishable(rawTotalFinalScores)
  return {
    slides,
    submittedAnswersBySlideId: Object.fromEntries(
      Object.entries(slides).map(([slideId, aggregate]) => [slideId, aggregate.submittedCount]),
    ),
    finalScoreRanges: Object.fromEntries(
      Array.from(quizAggregateState.finalScoreBuckets.entries())
        .filter(([key]) => publishFinalScores && rankPrefix !== null && key.startsWith(rankPrefix))
        .map(([key, count]) => [key.slice(key.lastIndexOf(':') + 1), count]),
    ),
    totalFinalScores: publishFinalScores ? rawTotalFinalScores : 0,
    minimumGroupSize: QUIZ_MIN_AGGREGATE_GROUP_SIZE,
    finalScoreRequestId: requestId ?? null,
    updatedAt: quizAggregateState.updatedAt,
  }
}

const getQuizControlSnapshot = (presentationId) => {
  const activePresentationId = currentState.presentation?.id
  const aggregate = presentationId === activePresentationId
    ? getQuizAggregateSnapshot()
    : {
        slides: {},
        submittedAnswersBySlideId: {},
        finalScoreRanges: {},
        totalFinalScores: 0,
        minimumGroupSize: QUIZ_MIN_AGGREGATE_GROUP_SIZE,
        finalScoreRequestId: null,
        updatedAt: quizAggregateState.updatedAt,
      }
  return {
    type: 'QUIZ_AGGREGATE_SNAPSHOT',
    presentationId,
    aggregate,
    updatedAt: aggregate.updatedAt,
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
  currentState = { ...currentState, stateEpoch, stateRevision: ++stateRevision }
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

const reduceRemoteCommandMessage = (message, sourceMeta, beforeSessionReset) => {
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
    try {
      if (beforeSessionReset) beforeSessionReset()
      else wsServer.rotatePresentationSession(message.payload)
    } catch {
      const error = new Error('Presentation session reset could not be persisted')
      error.code = 'SESSION_PERSISTENCE_FAILED'
      throw error
    }
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

const getBearerCredential = (req) => {
  const header = req.headers.authorization
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null
}

const requireControlledAudience = (req, res) => {
  if (getSessionAccessMode() !== 'CONTROLLED') return true
  if (authorizeAudienceCredential(getBearerCredential(req))) return true
  sendJson(res, 401, { error: 'Audience admission required' })
  return false
}

const invalidateAudienceStreams = () => {
  for (const response of audienceClients) response.end()
  audienceClients.clear()
  for (const response of quizClients) {
    if (!response.isControl) {
      response.end()
      quizClients.delete(response)
    }
  }
}

const handleApi = async (req, res, url) => {
  if (url.pathname === '/api/public-config' && req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    sendJson(res, 200, publicI18nConfig)
    return true
  }
  if (url.pathname === '/api/health' && req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    sendJson(res, 200, { healthy: true })
    return true
  }
  if (url.pathname === '/api/voice-scripture/status' && req.method === 'GET') {
    sendJson(res, 200, await voiceScriptureService.getStatus())
    return true
  }
  if (url.pathname === '/api/voice-scripture/token' && req.method === 'POST') {
    sendJson(res, 200, await voiceScriptureService.issueToken())
    return true
  }
  const brandingAsset = brandingAssets.get(url.pathname)
  if (brandingAsset && req.method === 'GET') {
    sendBrandingAsset(req, res, brandingAsset)
    return true
  }

  if (url.pathname === '/api/legal/manifest' && req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store, max-age=0')
    if (legalRepository.status !== 'ACTIVE') {
      sendJson(res, 503, { code: 'LEGAL_NOT_CONFIGURED' })
    } else {
      sendJson(res, 200, legalRepository.publicManifest)
    }
    return true
  }

  if (url.pathname === '/api/audience/access/bootstrap' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      sendJson(res, 200, bootstrapAudienceAccess(body.credential))
    } catch {
      sendJson(res, 400, { error: 'Invalid audience bootstrap request' })
    }
    return true
  }

  if (url.pathname === '/api/audience/sse-ticket' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const ticket = issueAudienceSseTicket(getBearerCredential(req), body.purpose)
      if (!ticket) sendJson(res, 401, { error: 'Audience admission required' })
      else sendJson(res, 200, { ticket })
    } catch {
      sendJson(res, 400, { error: 'Invalid SSE ticket request' })
    }
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
    if (!requireControlledAudience(req, res)) return true
    sendJson(res, 200, makeAudienceSyncStateMessage(currentState))
    return true
  }

  if (url.pathname === '/api/audience/events' && req.method === 'GET') {
    const access = url.searchParams.has('ticket')
      ? consumeAudienceSseTicket(url.searchParams.get('ticket'), 'STATE')
      : null
    if (getSessionAccessMode() === 'CONTROLLED' && !access) {
      sendJson(res, 401, { error: 'Audience admission required' })
      return true
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    registerSseClient(audienceClients, res)
    writeSse(audienceClients, res, JSON.stringify(makeAudienceSyncStateMessage(currentState)))
    return true
  }

  if (
    (url.pathname === '/api/quiz-events' || url.pathname === '/api/quiz-control-events')
    && req.method === 'GET'
  ) {
    if (url.pathname === '/api/quiz-events') {
      const access = url.searchParams.has('ticket')
        ? consumeAudienceSseTicket(url.searchParams.get('ticket'), 'QUIZ')
        : null
      if (getSessionAccessMode() === 'CONTROLLED' && !access) {
        sendJson(res, 401, { error: 'Audience admission required' })
        return true
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.isControl = url.pathname === '/api/quiz-control-events'
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
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body)
      const validationError = validatePublicQuizMessage(parsed)
      if (validationError) {
        sendJson(res, 400, { error: validationError })
        return true
      }
      if (parsed.type === 'QUIZ_CLEAR_ANSWERS') {
        if (isAuthRequired() && !hasValidBasicAuth(req)) {
          sendJson(res, 401, { error: 'Authentication required to clear quiz answers' })
          return true
        }
        if (!authorizeOperatorCredential(req, { controlOnly: true })) {
          sendJson(res, 403, { code: 'OPERATOR_FORBIDDEN', error: 'An authorized Control connection is required' })
          return true
        }
      } else if (!requireControlledAudience(req, res)) {
        return true
      }
      const aggregateError = canAcceptQuizAggregateMessage(parsed)
      if (aggregateError) {
        sendJson(res, 409, { error: aggregateError })
        return true
      }
      updateQuizAggregate(parsed)
      if (parsed.type === 'QUIZ_CLEAR_ANSWERS') {
        broadcastQuizAnswer(body, parsed)
      }
      const aggregateSnapshot = getQuizControlSnapshot(parsed.presentationId)
      broadcastQuizAnswer(JSON.stringify(aggregateSnapshot), aggregateSnapshot)
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
      const result = reduceRemoteCommandMessage(parsed, req.operatorMeta)
      if (!result.ok) {
        sendJson(res, result.status, { error: result.error })
        return true
      }
      sendJson(res, 200, { success: true, state: result.state })
    } catch (err) {
      if (err.code === 'SESSION_PERSISTENCE_FAILED') {
        sendJson(res, 503, { code: err.code, error: 'Presentation session reset could not be persisted' })
      } else {
        sendJson(res, 400, { error: err.message || 'Invalid JSON' })
      }
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
      seferDataPaths.public,
      /\.(avif|gif|jpe?g|png|svg|webp|mp4|webm)$/i
    )
    sendJson(res, 200, backgrounds)
    return true
  }

  if (url.pathname === '/api/audio' && req.method === 'GET') {
    const audio = walkAssets(
      seferDataPaths.public,
      /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i,
    )
    sendJson(res, 200, audio)
    return true
  }

  if (url.pathname === '/api/audio-sync' && req.method === 'GET') {
    const maps = readAudioSyncMapsCache()
    res.setHeader('ETag', catalogEtag(maps))
    sendJson(res, 200, maps)
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
      if (!requireCatalogRevision(req, res, readAudioSyncMapsCache())) return true
      persistJson(seferDataPaths.audioSync, validation.value)
      audioSyncMapsCache = validation.value
      res.setHeader('ETag', catalogEtag(audioSyncMapsCache))
      writeSseSet(clients, JSON.stringify({ type: 'AUDIO_SYNC_MAPS_UPDATE', maps: audioSyncMapsCache, protocolVersion: 1, messageId: randomUUID(), timestamp: Date.now() }))
      sendJson(res, 200, { success: true })
    } catch (err) {
      const status = err instanceof SyntaxError ? 400 : 500
      sendJson(res, status, { error: status === 400 ? 'Invalid JSON' : 'Unable to persist audio sync data' })
    }
    return true
  }

  if (url.pathname === '/api/presentations' && req.method === 'GET') {
    try {
      const presentations = readPresentationsCache()
      res.setHeader('ETag', catalogEtag(presentations))
      sendJson(res, 200, presentations)
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
      if (!requireCatalogRevision(req, res, readPresentationsCache())) return true
      const presentations = normalizePresentations(validation.value)
      persistJson(seferDataPaths.presentations, presentations)
      presentationsCache = presentations
      publicPresentationsCache = buildPublicPresentations(presentationsCache, getPublicCatalogs(), {
        publicDataDir: seferDataPaths.public,
      })
      res.setHeader('ETag', catalogEtag(presentationsCache))
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
    const filePath = seferDataPaths.audienceCacheAssets
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
  const requestPath = new URL(req.url || '/', 'http://localhost').pathname

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'File not found' }))
    return
  }

  const stat = fs.statSync(filePath)
  const cacheHeaders = getStaticCacheHeaders(requestPath, stat, ext)
  
  const totalSize = stat.size
  const range = req.headers.range
  const etag = `W/"${totalSize.toString(16)}-${stat.mtime.getTime().toString(16)}"`
  cacheHeaders['ETag'] = etag
  
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, cacheHeaders)
    res.end()
    return
  }

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
      ...cacheHeaders,
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    })
    file.pipe(res)
  } else {
    res.writeHead(200, {
      ...cacheHeaders,
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
  const legalDocument = legalDocuments.get(cleanPath)
  if (legalDocument) {
    serveFile(req, res, legalDocument)
    return true
  }
  const candidate = resolvePathInsideRoot(staticDir, cleanPath)

  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    serveFile(req, res, candidate)
    return true
  }

  const productCandidate = resolvePathInsideRoot(productStaticDir, cleanPath)
  if (productCandidate && fs.existsSync(productCandidate) && fs.statSync(productCandidate).isFile()) {
    serveFile(req, res, productCandidate)
    return true
  }

  const operatorCandidate = resolvePathInsideRoot(seferDataPaths.public, cleanPath)
  if (operatorCandidate && fs.existsSync(operatorCandidate) && fs.statSync(operatorCandidate).isFile()) {
    serveFile(req, res, operatorCandidate)
    return true
  }

  if (cleanPath.startsWith('/legal/')) return false

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
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss: https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET') && !hasAllowedRequestOrigin(req)) {
    sendJson(res, 403, { error: 'Request origin is not allowed' })
    return
  }

  if (requireAuth(req, res, url)) return
  const operatorPaths = ['/api/command', '/api/state', '/api/audio-telemetry', '/api/video-telemetry', '/api/display-telemetry'];
  if (req.method === 'POST' && operatorPaths.includes(url.pathname)) {
    req.operatorMeta = authorizeOperatorCredential(req, { controlOnly: url.pathname === '/api/command' });
    if (!req.operatorMeta) {
      sendJson(res, 403, { code: 'OPERATOR_FORBIDDEN', error: 'An authorized operator connection is required' });
      return;
    }
  }

  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, url)
    if (!handled) sendJson(res, 404, { error: 'Not found' })
    return
  }

  if (handleStatic(req, res, url)) return

  sendJson(res, 404, { error: 'Static file not found' })
})

const voiceScriptureService = createVoiceScriptureService(server)

const handleWsMessageFromClient = (msg, meta, beforeSessionReset) => {
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
    const result = reduceRemoteCommandMessage(msg, meta, beforeSessionReset)
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
  voiceScriptureService.close()
})

liveKitApi = createLiveKitApi({
  getLiveAudioControlSnapshot,
  getLiveAudioParticipantState,
  isLiveAudioControlAuthorized,
  authorizeAudienceCredential,
  authorizeOperatorCredential,
  getSessionAccessMode,
})

let wsServer

server.listen(port, () => {
  readAudioSyncMapsCache()
  readPresentationsCache()
  const staticLabel = staticDir ? `, serving ${path.relative(rootDir, staticDir)}` : ''
  wsServer = createWsServer(server, handleWsMessageFromClient, {
    presentationSessionStore,
    getLiveKitState: () => liveKitApi?.getState?.() || {
      enabled: false,
      available: false,
      participants: [],
      speakers: [],
      muted: [],
      kicked: [],
    },
    getQuizAggregateSnapshot,
    revokeAllLiveKitSpeakers: () => liveKitApi?.revokeAllSpeakers?.(),
    recordExternalBroadcastTransition: (transition) =>
      privacySessionManifestRecorder.recordTransition(transition),
    invalidateAudienceStreams,
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
  server.close(() => {
    privacySessionManifestRecorder.flush().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref?.()
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
