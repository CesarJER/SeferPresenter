import { WebSocket, WebSocketServer } from 'ws'
import crypto from 'crypto'
import { hasAllowedRequestOrigin, hasValidBasicAuth } from './authUtils.mjs'

const MAX_VOICE_FRAME_BYTES = 512 * 1024
const MAX_VOICE_QUEUE_BYTES = 256 * 1024
const TOKEN_TTL_MS = 10_000

const parseEnabled = (value) => String(value || '').trim().toLowerCase() === 'true'

export const getVoiceScriptureConfig = () => ({
  enabled: parseEnabled(process.env.SEFER_VOICE_SCRIPTURE_ENABLED),
  debug: parseEnabled(process.env.SEFER_VOICE_SCRIPTURE_DEBUG),
  sttUrl: String(process.env.SEFER_VOICE_SCRIPTURE_STT_URL || '').trim(),
  readyUrl: String(process.env.SEFER_VOICE_SCRIPTURE_READY_URL || '').trim(),
  apiKey: String(process.env.SEFER_VOICE_SCRIPTURE_STT_API_KEY || '').trim(),
  controlPasswordConfigured: Boolean(String(process.env.SEFER_CONTROL_PASSWORD || '').trim()),
})

const debugLog = (config, event, details = {}) => {
  if (!config.debug) return
  console.log(`[VOICE_SCRIPTURE_DEBUG] ${JSON.stringify({ event, ...details })}`)
}

const isConfigured = (config) => (
  config.enabled &&
  /^wss?:\/\//.test(config.sttUrl) &&
  /^https?:\/\//.test(config.readyUrl) &&
  Boolean(config.apiKey) &&
  config.controlPasswordConfigured
)

export const getVoiceScriptureStatus = async ({ fetchImpl = fetch } = {}) => {
  const config = getVoiceScriptureConfig()
  if (!config.enabled) return { enabled: false, available: false, debug: config.debug }
  if (!isConfigured(config)) {
    debugLog(config, 'status.misconfigured', {
      hasSttUrl: Boolean(config.sttUrl),
      hasReadyUrl: Boolean(config.readyUrl),
      hasApiKey: Boolean(config.apiKey),
      hasControlPassword: config.controlPasswordConfigured,
    })
    return { enabled: true, available: false, debug: config.debug }
  }

  try {
    const response = await fetchImpl(config.readyUrl, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) {
      debugLog(config, 'status.not-ready', { status: response.status })
      return { enabled: true, available: false, debug: config.debug }
    }
    const payload = await response.json()
    const available = payload?.ready === true || payload?.status === 'ok'
    debugLog(config, 'status.ready', { available, payload })
    return { enabled: true, available, debug: config.debug }
  } catch (error) {
    debugLog(config, 'status.error', { message: error instanceof Error ? error.message : String(error) })
    return { enabled: true, available: false, debug: config.debug }
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
  const pendingTokens = new Map()
  let closed = false
  let activeSession = null
  let connecting = null

  const handleUpgrade = (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (url.pathname !== '/voice-scripture/ws') return

    const config = getVoiceScriptureConfig()
    if (!isConfigured(config)) {
      rejectUpgrade(socket, '503 Service Unavailable', 'Voice Scripture unavailable')
      return
    }
    const protocols = String(request.headers['sec-websocket-protocol'] || '')
      .split(',')
      .map((value) => value.trim())
    const token = protocols.find((value) => pendingTokens.has(value))
    const isValidToken = Boolean(token && pendingTokens.has(token))
    if (isValidToken) {
      clearTimeout(pendingTokens.get(token))
      pendingTokens.delete(token)
    }
    const sameOrigin = hasAllowedRequestOrigin(request)
    const basicAuthValid = hasValidBasicAuth(request)

    debugLog(config, 'upgrade.received', {
      sameOrigin,
      capabilityValid: isValidToken,
      basicAuthValid,
      active: Boolean(activeSession || connecting),
    })

    if (!sameOrigin || (!isValidToken && !basicAuthValid)) {
      debugLog(config, 'upgrade.rejected', { reason: 'authentication' })
      rejectUpgrade(socket, '401 Unauthorized', 'Authentication required')
      return
    }
    if (activeSession || connecting) {
      debugLog(config, 'upgrade.rejected', { reason: 'already-in-use' })
      rejectUpgrade(socket, '409 Conflict', 'Voice Scripture already in use')
      return
    }

    const upstream = new WebSocket(config.sttUrl, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      maxPayload: MAX_VOICE_FRAME_BYTES,
      handshakeTimeout: 5_000,
    })
    connecting = { upstream, socket }

    const cancelPending = () => {
      if (connecting?.upstream !== upstream) return
      connecting = null
      upstream.terminate()
      socket.destroy()
    }
    socket.once('close', cancelPending)
    socket.once('end', cancelPending)
    socket.once('error', cancelPending)

    const failBeforeUpgrade = () => {
      if (connecting?.upstream !== upstream) return
      connecting = null
      debugLog(config, 'upstream.error-before-open')
      rejectUpgrade(socket, '503 Service Unavailable', 'STT unavailable')
    }
    upstream.once('error', failBeforeUpgrade)
    upstream.once('open', () => {
      if (closed || socket.destroyed || connecting?.upstream !== upstream) {
        upstream.terminate()
        return
      }
      socket.off('close', cancelPending)
      socket.off('end', cancelPending)
      socket.off('error', cancelPending)
      upstream.off('error', failBeforeUpgrade)
      downstreamServer.handleUpgrade(request, socket, head, (client) => {
        connecting = null
        activeSession = { client, upstream, frames: 0, bytes: 0 }
        debugLog(config, 'session.open')

        const closeBoth = () => {
          if (activeSession?.client === client) {
            debugLog(config, 'session.close', { frames: activeSession.frames, bytes: activeSession.bytes })
          }
          if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close()
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close()
          if (activeSession?.client === client) activeSession = null
        }

        client.on('message', (data, isBinary) => {
          if (config.debug && activeSession?.client === client) {
            if (isBinary) {
              activeSession.frames += 1
              activeSession.bytes += data.length
              if (activeSession.frames === 1 || activeSession.frames % 16 === 0) {
                debugLog(config, 'audio.forwarded', { frames: activeSession.frames, bytes: activeSession.bytes })
              }
            } else {
              debugLog(config, 'client.event', { payload: data.toString().slice(0, 8_000) })
            }
          }
          if (upstream.bufferedAmount + data.length > MAX_VOICE_QUEUE_BYTES) {
            client.close(1013, 'Voice audio queue exceeded')
            closeBoth()
            return
          }
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
        })
        upstream.on('message', (data, isBinary) => {
          if (config.debug && !isBinary) {
            debugLog(config, 'stt.event', { payload: data.toString().slice(0, 8_000) })
          }
          if (client.bufferedAmount + data.length > MAX_VOICE_QUEUE_BYTES) {
            client.close(1013, 'Voice result queue exceeded')
            closeBoth()
            return
          }
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
    getStatus: (options) => getVoiceScriptureStatus(options),
    issueToken: async ({ fetchImpl = fetch } = {}) => {
      const status = await getVoiceScriptureStatus({ fetchImpl })
      if (closed) return { ...status, available: false }
      if (!status.available) return status
      const token = crypto.randomUUID()
      const expiryTimer = setTimeout(() => pendingTokens.delete(token), TOKEN_TTL_MS)
      expiryTimer.unref?.()
      pendingTokens.set(token, expiryTimer)
      const config = getVoiceScriptureConfig()
      debugLog(config, 'capability.issued', { expiresInMs: TOKEN_TTL_MS })
      return { ...status, token, expiresInMs: TOKEN_TTL_MS }
    },
    close: () => {
      if (closed) return
      closed = true
      for (const timer of pendingTokens.values()) clearTimeout(timer)
      pendingTokens.clear()
      httpServer.off('upgrade', handleUpgrade)
      connecting?.upstream.terminate()
      connecting?.socket.destroy()
      activeSession?.client.close()
      activeSession?.upstream.close()
      downstreamServer.close()
      activeSession = null
      connecting = null
    },
  }
}

