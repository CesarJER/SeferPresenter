import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const publicDir = path.join(rootDir, 'public')
const port = Number(process.env.SEFER_PORT || 8787)
const serveStatic = process.argv.includes('--static')
const staticArgIndex = process.argv.indexOf('--static')
const staticDir = serveStatic
  ? path.resolve(rootDir, process.argv[staticArgIndex + 1] || 'dist')
  : null

let currentState = {
  presentation: null,
  slideIndex: -1,
  backgroundLock: false,
  lockedBackgroundValue: null,
  userSelectedBackground: null,
}

let clients = new Set()
let audienceClients = new Set()
let quizClients = new Set()

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
  for (const client of clients) {
    client.write(`data: ${body}\n\n`)
  }
  const audienceBody = JSON.stringify(deriveAudienceState(currentState))
  for (const client of audienceClients) {
    client.write(`data: ${audienceBody}\n\n`)
  }
}

const broadcastQuizAnswer = (body) => {
  for (const client of quizClients) {
    client.write(`data: ${body}\n\n`)
  }
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

const isAuthRequired = () => process.env.SEFER_REQUIRE_AUTH === 'true'

const isProtectedPath = (url, method) => {
  if (!isAuthRequired()) return false
  if (url.pathname === '/control' || url.pathname === '/audio-editor') return true
  if (url.pathname.startsWith('/api/') && method !== 'GET') return true
  return false
}

const hasValidBasicAuth = (req) => {
  const expectedPassword = process.env.SEFER_CONTROL_PASSWORD
  if (!expectedPassword) return false
  const header = req.headers.authorization || ''
  if (!header.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8')
  const separatorIndex = decoded.indexOf(':')
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded
  return password === expectedPassword
}

const requireAuth = (req, res, url) => {
  if (!isProtectedPath(url, req.method || 'GET')) return false
  if (hasValidBasicAuth(req)) return false
  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="SeferPresenter"',
  })
  res.end('Authentication required')
  return true
}

const handleApi = async (req, res, url) => {
  if (url.pathname === '/api/state-events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(`data: ${JSON.stringify(currentState)}\n\n`)
    clients.add(res)
    req.on('close', () => {
      clients.delete(res)
    })
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
    res.write(`data: ${JSON.stringify(deriveAudienceState(currentState))}\n\n`)
    audienceClients.add(res)
    req.on('close', () => {
      audienceClients.delete(res)
    })
    return true
  }

  if (url.pathname === '/api/quiz-events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    quizClients.add(res)
    req.on('close', () => {
      quizClients.delete(res)
    })
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
      currentState = parsed
      broadcast(JSON.stringify(parsed))
      sendJson(res, 200, { success: true })
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'Invalid JSON' })
    }
    return true
  }

  if (url.pathname === '/api/audio-telemetry' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      const telemetry = JSON.parse(body)
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

const serveFile = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase()
  const contentType = contentTypes[ext] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType })
  fs.createReadStream(filePath).pipe(res)
}

const handleStatic = (req, res, url) => {
  if (!staticDir) return false
  const requestedPath = decodeURIComponent(url.pathname)
  const cleanPath = requestedPath === '/' ? '/presenter' : requestedPath
  const candidate = path.resolve(staticDir, cleanPath.slice(1))

  if (candidate.startsWith(staticDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    serveFile(res, candidate)
    return true
  }

  const indexPath = path.join(staticDir, 'index.html')
  if (fs.existsSync(indexPath)) {
    serveFile(res, indexPath)
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

  sendJson(res, 404, { error: serveStatic ? 'Static file not found' : 'Backend API is running' })
})

server.listen(port, () => {
  const staticLabel = staticDir ? `, serving ${path.relative(rootDir, staticDir)}` : ''
  console.log(`SeferPresenter local backend listening on http://localhost:${port}${staticLabel}`)
})
