import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { applyAction, getTimeline } from './timelineManager.mjs'
import { isAuthRequired, hasValidBasicAuth } from './authUtils.mjs'

const wsClients = new Map()
const roles = new Set(['presenter', 'control', 'audience', 'unknown'])

const makeRole = (value) => roles.has(value) ? value : 'unknown'

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

  wss.on('connection', (ws, req) => {
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
    wsClients.set(ws, { role, clientId })

    ws.send(JSON.stringify({
      type: 'WELCOME',
      clientId,
      serverTimeMs: Date.now(),
      role,
    }))

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
      if (meta?.role === 'audience' && msg.type !== 'SERVER_TIME_PING') {
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

        case 'SYNC_STATE':
        case 'REMOTE_COMMAND':
        case 'AUDIO_TELEMETRY':
        case 'VIDEO_TELEMETRY':
        case 'DISPLAY_TELEMETRY':
          if (meta?.role === 'audience') break
          if (onFallbackMessage) {
            onFallbackMessage(msg)
          }
          break

        default:
          break
      }
    })

    ws.on('close', () => wsClients.delete(ws))
    ws.on('error', () => wsClients.delete(ws))
  })

  const heartbeat = setInterval(() => {
    for (const [client] of wsClients) {
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
  }, 25_000)
  heartbeat.unref?.()

  wss.on('close', () => clearInterval(heartbeat))

  return wss
}

export { createWsServer }
