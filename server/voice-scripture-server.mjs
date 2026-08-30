import { WebSocket, WebSocketServer } from 'ws'
import { hasAllowedRequestOrigin, hasValidBasicAuth } from './authUtils.mjs'

const MAX_VOICE_FRAME_BYTES = 512 * 1024

const parseEnabled = (value) => String(value || '').trim().toLowerCase() === 'true'

export const getVoiceScriptureConfig = () => ({
  enabled: parseEnabled(process.env.SEFER_VOICE_SCRIPTURE_ENABLED),
  sttUrl: String(process.env.SEFER_VOICE_SCRIPTURE_STT_URL || '').trim(),
  readyUrl: String(process.env.SEFER_VOICE_SCRIPTURE_READY_URL || '').trim(),
  apiKey: String(process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY || '').trim(),
  controlPasswordConfigured: Boolean(String(process.env.SEFER_CONTROL_PASSWORD || '').trim()),
})

const isConfigured = (config) => (
  config.enabled &&
  /^wss?:\/\//.test(config.sttUrl) &&
  /^https?:\/\//.test(config.readyUrl) &&
  Boolean(config.apiKey) &&
  config.controlPasswordConfigured
)

export const getVoiceScriptureStatus = async ({ fetchImpl = fetch } = {}) => {
  const config = getVoiceScriptureConfig()
  if (!config.enabled) return { enabled: false, available: false }
  if (!isConfigured(config)) return { enabled: true, available: false }

  try {
    const response = await fetchImpl(config.readyUrl, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) return { enabled: true, available: false }
    const payload = await response.json()
    return { enabled: true, available: payload?.ready === true || payload?.status === 'ok' }
  } catch {
    return { enabled: true, available: false }
  }
}

const rejectUpgrade = (socket, status, message) => {
  if (!socket.writable) return
  const body = `${message}\n`
  socket.end(
    `HTTP/1.1 ${status}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  )
}

export const createVoiceScriptureService = (httpServer) => {
  const downstreamServer = new WebSocketServer({ noServer: true, maxPayload: MAX_VOICE_FRAME_BYTES })
  let activeSession = null
  let connecting = false

  const handleUpgrade = (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (url.pathname !== '/voice-scripture/ws') return

    const config = getVoiceScriptureConfig()
    if (!isConfigured(config)) {
      rejectUpgrade(socket, '503 Service Unavailable', 'Voice Scripture unavailable')
      return
    }
    if (!hasAllowedRequestOrigin(request) || !hasValidBasicAuth(request)) {
      rejectUpgrade(socket, '401 Unauthorized', 'Authentication required')
      return
    }
    if (activeSession || connecting) {
      rejectUpgrade(socket, '409 Conflict', 'Voice Scripture already in use')
      return
    }

    connecting = true
    const upstream = new WebSocket(config.sttUrl, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      maxPayload: MAX_VOICE_FRAME_BYTES,
      handshakeTimeout: 5_000,
    })

    const failBeforeUpgrade = () => {
      connecting = false
      rejectUpgrade(socket, '503 Service Unavailable', 'STT unavailable')
    }
    upstream.once('error', failBeforeUpgrade)
    upstream.once('open', () => {
      upstream.off('error', failBeforeUpgrade)
      downstreamServer.handleUpgrade(request, socket, head, (client) => {
        connecting = false
        activeSession = { client, upstream }

        const closeBoth = () => {
          if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close()
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close()
          if (activeSession?.client === client) activeSession = null
        }

        client.on('message', (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
        })
        upstream.on('message', (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
        })
        client.once('close', closeBoth)
        client.once('error', closeBoth)
        upstream.once('close', closeBoth)
        upstream.once('error', closeBoth)
      })
    })
  }

  httpServer.on('upgrade', handleUpgrade)

  return {
    getStatus: getVoiceScriptureStatus,
    close: () => {
      httpServer.off('upgrade', handleUpgrade)
      activeSession?.client.close()
      activeSession?.upstream.close()
      downstreamServer.close()
      activeSession = null
      connecting = false
    },
  }
}

