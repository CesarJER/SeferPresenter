import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLiveKitApi } from './livekit-server.mjs'
import {
  createWsServer,
  getLiveAudioControlSnapshot,
  getLiveAudioParticipantState,
  isLiveAudioControlAuthorized,
} from './ws-server.mjs'
import { isAuthRequired, hasValidBasicAuth } from './authUtils.mjs'
import {
  getDefaultProjectionState,
  makeProjectionSyncStateMessage,
  normalizeProjectionState,
  reduceProjectionCommand,
} from './projection-state-reducer.mjs'
import { hasActivePresenter, broadcastWs } from './ws-server.mjs'
import { getTimeline, applyAction } from './timelineManager.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const publicDir = path.join(rootDir, 'public')
const port = Number(process.env.SEFER_PORT || 8787)
const staticArgIndex = process.argv.indexOf('--static')
const staticDir = path.resolve(rootDir, staticArgIndex >= 0 ? process.argv[staticArgIndex + 1] || 'dist' : 'dist')
const sseHeartbeatMs = 30_000

let currentState = makeProjectionSyncStateMessage(getDefaultProjectionState(), {
  clientId: 'server',
  origin: 'control',
})

let clients = new Set()
let audienceClients = new Set()
let quizClients = new Set()
let liveKitApi = null
let audioSyncMapsCache = []

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
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

  try {
    client.write(`data: ${body}\n\n`, (err) => {
      if (err) clientSet.delete(client)
    })
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
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Body too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

const readJsonFile = (filePath, fallback) => {
  if (!fs.existsSync(filePath)) return fallback
  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
  return JSON.parse(content)
}

const writeJsonAtomic = (filePath, value) => {
  const tmpPath = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
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

const broadcast = (body) => {
  writeSseSet(clients, body)
  const audienceBody = JSON.stringify(deriveAudienceState(currentState))
  writeSseSet(audienceClients, audienceBody)
}

const broadcastQuizAnswer = (body) => {
  writeSseSet(quizClients, body)
}

const logStateChange = (state) => {
  console.log(`[SERVER DBG - STATE] clientId=${state.clientId} origin=${state.origin} slideIndex=${state.slideIndex} appMode=${state.appMode} scriptureBook=${state.scriptureState?.bookAbbrevEs || state.scriptureState?.bookEs || ''}`);
}

const commitState = (state, metadata = {}) => {
  currentState = makeProjectionSyncStateMessage(state, {
    clientId: metadata.clientId,
    origin: metadata.origin,
    now: metadata.now,
    messageId: metadata.messageId,
  })
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

  return {
    ok: true,
    state: commitState(result.state, {
      clientId: message.clientId,
      origin: 'control',
      now,
    }),
  }
}

const heartbeatSseClients = () => {
  writeSseSet(clients, 'heartbeat')
  writeSseSet(audienceClients, 'heartbeat')
  writeSseSet(quizClients, 'heartbeat')
}

const isVideoAsset = (value) => /\.(mp4|webm)$/i.test(value || '')
const isImageAsset = (value) => /\.(png|jpe?g|gif|webp|svg)$/i.test(value || '')

const deriveBackground = (state, slide) => {
  const value = state.userSelectedBackground || slide?.background || state.presentation?.background || ''
  if (isImageAsset(value) && !isVideoAsset(value)) return { kind: 'image', value }
  return { kind: 'color', value: '#07111f' }
}

const deriveAudienceState = (state) => {
  const presentation = state.presentation || null
  const slideIndex = Number.isInteger(state.slideIndex) ? state.slideIndex : -1
  const slide = presentation && slideIndex >= 0 ? presentation.slides?.[slideIndex] || null : null
  const scripture = state.scriptureState
    ? {
      reference: `${state.scriptureState.bookAbbrevEs || state.scriptureState.bookEs} ${state.scriptureState.chapter}:${state.scriptureState.verse}`,
      verseNikud: state.scriptureState.verseNikud,
      transliteration: state.scriptureState.transliteration,
      translation: state.scriptureState.translation,
    }
    : null
  const isMediaSlide = slide?.type === 'video' || slide?.lines?.[0]?.trim() === '[IMAGE]'

  return {
    mode: state.appMode || 'slides',
    presentationTitle: presentation?.title || '',
    slide: slide
      ? {
        id: slide.id,
        label: slide.label,
        lines: isMediaSlide ? [] : slide.lines || [],
        type: isMediaSlide ? 'media' : scripture ? 'scripture' : 'text',
      }
      : null,
    scripture,
    background: deriveBackground(state, slide),
    updatedAt: Date.now(),
  }
}

const isProtectedPath = (url, method) => {
  if (!isAuthRequired()) return false
  if (url.pathname.startsWith('/audience') || url.pathname === '/proteccion-datos' || url.pathname === '/') return false
  if (url.pathname === '/control' || url.pathname === '/audio-editor' || url.pathname === '/presenter') return true
  if (url.pathname.startsWith('/api/livekit/')) return false
  if (url.pathname.startsWith('/api/') && method !== 'GET') return true
  return false
}

const requireAuth = (req, res, url) => {
  if (!isProtectedPath(url, req.method || 'GET')) return false
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
    sendJson(res, 200, deriveAudienceState(currentState))
    return true
  }

  if (url.pathname === '/api/audience/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    registerSseClient(audienceClients, res)
    writeSse(audienceClients, res, JSON.stringify(deriveAudienceState(currentState)))
    return true
  }

  if (url.pathname === '/api/quiz-events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    registerSseClient(quizClients, res)
    return true
  }

  if (url.pathname === '/api/quiz-answer' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      JSON.parse(body)
      broadcastQuizAnswer(body)
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
      /\.(png|jpe?g|mp4|webm)$/i
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
    try {
      sendJson(res, 200, readJsonFile(path.join(rootDir, 'audio_sync.json'), []))
    } catch {
      sendJson(res, 500, { error: 'Invalid audio sync JSON' })
    }
    return true
  }

  if (url.pathname === '/api/audio-sync' && req.method === 'POST') {
    try {
      const parsed = JSON.parse(await readBody(req))
      writeJsonAtomic(path.join(rootDir, 'audio_sync.json'), parsed)
      audioSyncMapsCache = parsed
      sendJson(res, 200, { success: true })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/presentations' && req.method === 'GET') {
    try {
      const presentations = readJsonFile(path.join(rootDir, 'presentations.json'), [])
      sendJson(res, 200, normalizePresentations(presentations))
    } catch {
      sendJson(res, 500, { error: 'Invalid presentations JSON' })
    }
    return true
  }

  if (url.pathname === '/api/presentations' && req.method === 'POST') {
    try {
      const presentations = normalizePresentations(JSON.parse(await readBody(req)))
      writeJsonAtomic(path.join(rootDir, 'presentations.json'), presentations)
      sendJson(res, 200, { success: true })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
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
  const candidate = path.resolve(staticDir, cleanPath.slice(1))

  if (candidate.startsWith(staticDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    serveFile(req, res, candidate)
    return true
  }

  const publicCandidate = path.resolve(publicDir, cleanPath.slice(1))
  if (publicCandidate.startsWith(publicDir) && fs.existsSync(publicCandidate) && fs.statSync(publicCandidate).isFile()) {
    serveFile(req, res, publicCandidate)
    return true
  }

  const htmlFile = cleanPath.startsWith('/presenter')
    ? 'presenter.html'
    : cleanPath.startsWith('/control')
      ? 'control.html'
      : cleanPath.startsWith('/audio-editor')
        ? 'audio-editor.html'
        : 'audience.html'

  const htmlPath = path.join(staticDir, htmlFile)
  if (fs.existsSync(htmlPath)) {
    serveFile(req, res, htmlPath)
    return true
  }

  return false
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

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
    if (meta?.role === 'control' && !canReduceRemoteCommand(meta)) return
    commitState(normalizeProjectionState(msg), {
      clientId: msg.clientId,
      origin: msg.origin === 'presenter' ? 'presenter' : 'control',
      now: msg.timestamp,
      messageId: msg.messageId,
    })
  } else if (msg.type === 'REMOTE_COMMAND') {
    const result = reduceRemoteCommandMessage(msg, meta)
    if (!result.ok) {
      console.warn(`[SERVER DBG - COMMAND] rejected clientId=${msg.clientId || ''} role=${meta?.role || 'http'} error=${result.error}`)
    }
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
        broadcastWs({ type: 'AUDIO_TIMELINE_STATE', timeline: getTimeline() }, (m) => m.role !== 'audience');
      }
    }
  } else if (msg.type === 'VIDEO_TELEMETRY') {
    currentState = { ...currentState, videoState: msg.videoState }
    broadcast(JSON.stringify(msg))
  } else if (msg.type === 'DISPLAY_TELEMETRY') {
    currentState = {
      ...currentState,
      backgroundLock: msg.backgroundLock,
      lockedBackgroundValue: msg.lockedBackgroundValue,
      userSelectedBackground: msg.userSelectedBackground,
    }
    broadcast(JSON.stringify(msg))
  }
}

const sseHeartbeat = setInterval(heartbeatSseClients, sseHeartbeatMs)
sseHeartbeat.unref?.()

let lastActiveCueIndex = -1
let lastSyncMapId = null

const evaluateServerCues = () => {
  if (hasActivePresenter()) return
  const tl = getTimeline()
  if (tl.status !== 'playing' || tl.syncMode === 'none' || !tl.syncMapId) return

  const syncMap = audioSyncMapsCache.find(m => m.id === tl.syncMapId)
  if (!syncMap || !syncMap.cues || syncMap.cues.length === 0) return

  const now = Date.now()
  const elapsedSec = (now - tl.baseServerTimeMs) / 1000
  const currentPos = tl.basePositionSec + elapsedSec * tl.playbackRate

  let activeCueIdx = -1
  for (let i = syncMap.cues.length - 1; i >= 0; i--) {
    if (currentPos >= syncMap.cues[i].timeSec) {
      activeCueIdx = i
      break
    }
  }

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
        presentationId: cue.presentationId,
        slideIndex: cue.slideIndex,
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
  getLiveAudioControlSnapshot,
  getLiveAudioParticipantState,
  isLiveAudioControlAuthorized,
})

server.listen(port, () => {
  audioSyncMapsCache = readJsonFile(path.join(rootDir, 'audio_sync.json'), [])
  const staticLabel = staticDir ? `, serving ${path.relative(rootDir, staticDir)}` : ''
  createWsServer(server, handleWsMessageFromClient)
  console.log(`SeferPresenter local backend listening on http://localhost:${port}${staticLabel}`)
  console.log(`SeferPresenter WebSocket disponible en ws://localhost:${port}/ws`)
})
