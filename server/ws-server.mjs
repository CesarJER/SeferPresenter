import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { applyAction, getTimeline } from './timelineManager.mjs'
import { isAuthRequired, hasValidBasicAuth } from './authUtils.mjs'

const wsClients = new Map()
const roles = new Set(['presenter', 'control', 'audience', 'unknown'])
const liveAudioControls = new Map()

const makeRole = (value) => roles.has(value) ? value : 'unknown'

const getControlCodeTtlMs = () => {
  const raw = Number.parseInt(process.env.SEFER_LIVE_AUDIO_CONTROL_CODE_TTL_SECONDS || '90', 10)
  const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120) : 90
  return seconds * 1000
}

const allowDelegatedModerators = () =>
  String(process.env.SEFER_LIVE_AUDIO_ALLOW_DELEGATED_MODERATORS || 'true').toLowerCase() !== 'false'

const generateVerificationCode = () => {
  const number = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')
  return `${number.slice(0, 3)}-${number.slice(3)}`
}

const isControlAuthorized = (control) =>
  control?.controlState === 'PRINCIPAL' || control?.controlState === 'AUTHORIZED'

const findPrincipalControl = () =>
  Array.from(liveAudioControls.values()).find((control) => control.controlState === 'PRINCIPAL') || null

const getPendingControls = () => {
  const now = Date.now()
  return Array.from(liveAudioControls.values())
    .filter((control) => control.controlState === 'PENDING' && control.codeExpiresAt > now)
    .map((control) => ({
      controlSessionId: control.controlSessionId,
      verificationCode: control.verificationCode,
      codeExpiresAt: control.codeExpiresAt,
      connectedAt: control.connectedAt,
    }))
}

const canAuthorizeControls = (control) => {
  if (!control) return false
  if (control.controlState === 'PRINCIPAL') return true
  return allowDelegatedModerators() && control.controlState === 'AUTHORIZED'
}

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

  const sendJson = (client, message) => {
    if (client.readyState !== WebSocket.OPEN) return false
    try {
      client.send(JSON.stringify(message))
      return true
    } catch {
      wsClients.delete(client)
      return false
    }
  }

  const sendError = (client, code, message) => {
    sendJson(client, { type: 'ERROR', code, message })
  }

  const sendAuthorizationState = (control) => {
    const principal = findPrincipalControl()
    const message = {
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE',
      controlSessionId: control.controlSessionId,
      controlState: control.controlState,
      principalControlSessionId: principal?.controlSessionId,
      allowDelegatedModerators: allowDelegatedModerators(),
      updatedAt: Date.now(),
    }

    if (control.controlState === 'PENDING') {
      message.verificationCode = control.verificationCode
      message.codeExpiresAt = control.codeExpiresAt
    }

    if (canAuthorizeControls(control)) {
      message.pendingControls = getPendingControls()
    }

    sendJson(control.ws, message)
  }

  const broadcastAuthorizationState = () => {
    for (const control of liveAudioControls.values()) {
      sendAuthorizationState(control)
    }
  }

  const resetPrivateControlSession = () => {
    broadcast({
      type: 'CONTROL_KEY_ROTATED',
      keyId: `server-reset-${Date.now()}`,
      reason: 'NO_AUTHORIZED_CONTROLS',
      createdAt: Date.now(),
    })
  }

  const promoteSuccessorIfNeeded = () => {
    if (findPrincipalControl()) return

    const authorized = Array.from(liveAudioControls.values())
      .filter((control) => control.controlState === 'AUTHORIZED')
      .sort((left, right) => left.authorizedAt - right.authorizedAt)

    if (authorized[0]) {
      authorized[0].controlState = 'PRINCIPAL'
      broadcastAuthorizationState()
      return
    }

    const pending = Array.from(liveAudioControls.values())
      .filter((control) => control.controlState === 'PENDING')
      .sort((left, right) => left.connectedAt - right.connectedAt)

    resetPrivateControlSession()

    if (pending[0]) {
      pending[0].controlState = 'PRINCIPAL'
      pending[0].verificationCode = undefined
      pending[0].codeExpiresAt = undefined
      pending[0].authorizedAt = Date.now()
    }

    broadcastAuthorizationState()
  }

  const removeControl = (controlSessionId) => {
    const control = liveAudioControls.get(controlSessionId)
    if (!control) return
    const wasPrincipal = control.controlState === 'PRINCIPAL'
    liveAudioControls.delete(controlSessionId)
    if (wasPrincipal) {
      promoteSuccessorIfNeeded()
    } else {
      broadcastAuthorizationState()
    }
  }

  const expirePendingControl = (controlSessionId) => {
    const control = liveAudioControls.get(controlSessionId)
    if (!control || control.controlState !== 'PENDING') return
    control.verificationCode = undefined
    control.codeExpiresAt = Date.now()
    sendAuthorizationState(control)
    broadcastAuthorizationState()
  }

  const registerControl = (ws, clientId, requestedControlSessionId) => {
    const connectedAt = Date.now()
    const controlSessionId = requestedControlSessionId || `control-${randomUUID()}`
    const hasPrincipal = Boolean(findPrincipalControl())
    const control = {
      ws,
      clientId,
      controlSessionId,
      connectedAt,
      authorizedAt: hasPrincipal ? 0 : connectedAt,
      controlState: hasPrincipal ? 'PENDING' : 'PRINCIPAL',
      verificationCode: undefined,
      codeExpiresAt: undefined,
    }

    if (control.controlState === 'PENDING') {
      control.verificationCode = generateVerificationCode()
      control.codeExpiresAt = connectedAt + getControlCodeTtlMs()
      control.expiryTimer = setTimeout(() => expirePendingControl(controlSessionId), getControlCodeTtlMs())
      control.expiryTimer.unref?.()
    }

    liveAudioControls.set(controlSessionId, control)
    return control
  }

  const isAuthorizedToDecide = (control) => canAuthorizeControls(control)

  const handleAuthorizationDecision = (meta, msg) => {
    const issuer = liveAudioControls.get(meta?.controlSessionId)
    const target = liveAudioControls.get(msg.targetControlSessionId)

    if (!isAuthorizedToDecide(issuer)) {
      sendError(meta.ws, 'CONTROL_AUTH_FORBIDDEN', 'Control is not allowed to authorize other controls')
      return
    }

    if (!target || target.controlState !== 'PENDING') {
      sendError(meta.ws, 'CONTROL_AUTH_TARGET_INVALID', 'Pending control was not found')
      return
    }

    if (!target.codeExpiresAt || target.codeExpiresAt <= Date.now()) {
      sendError(meta.ws, 'CONTROL_AUTH_CODE_EXPIRED', 'Verification code expired')
      sendAuthorizationState(target)
      broadcastAuthorizationState()
      return
    }

    if (msg.decision === 'APPROVE') {
      clearTimeout(target.expiryTimer)
      target.controlState = 'AUTHORIZED'
      target.authorizedAt = Date.now()
      target.verificationCode = undefined
      target.codeExpiresAt = undefined
    } else {
      clearTimeout(target.expiryTimer)
      sendJson(target.ws, {
        type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE',
        controlSessionId: target.controlSessionId,
        controlState: 'PENDING',
        allowDelegatedModerators: allowDelegatedModerators(),
        verificationCode: undefined,
        codeExpiresAt: Date.now(),
        updatedAt: Date.now(),
      })
      liveAudioControls.delete(target.controlSessionId)
      wsClients.delete(target.ws)
      target.ws.close(4003, 'Control authorization rejected')
    }

    broadcastAuthorizationState()
  }

  const forwardToAuthorizingControls = (msg, sourceControl) => {
    const enriched = {
      ...msg,
      controlSessionId: sourceControl.controlSessionId,
      verificationCode: sourceControl.verificationCode,
      createdAt: msg.createdAt || Date.now(),
    }
    for (const control of liveAudioControls.values()) {
      if (control.controlSessionId === sourceControl.controlSessionId) continue
      if (!canAuthorizeControls(control)) continue
      sendJson(control.ws, enriched)
    }
  }

  const forwardAuthorizedControlMessage = (msg, issuer) => {
    const target = liveAudioControls.get(msg.controlSessionId)
    if (!isControlAuthorized(issuer) || !target) return
    sendJson(target.ws, {
      ...msg,
      authorizedByControlSessionId: issuer.controlSessionId,
      createdAt: msg.createdAt || Date.now(),
    })
  }

  const routePrivateControlSignal = (msg) => {
    broadcast(msg, (meta) => {
      if (meta.role !== 'control') return false
      const control = liveAudioControls.get(meta.controlSessionId)
      if (!isControlAuthorized(control)) return false
      return !msg.toControlSessionId || msg.toControlSessionId === control.controlSessionId
    })
  }

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
    const control = role === 'control'
      ? registerControl(ws, clientId, url.searchParams.get('controlSessionId'))
      : null
    const meta = {
      role,
      clientId,
      ws,
      controlSessionId: control?.controlSessionId,
    }
    wsClients.set(ws, meta)

    ws.send(JSON.stringify({
      type: 'WELCOME',
      clientId,
      serverTimeMs: Date.now(),
      role,
      controlSessionId: control?.controlSessionId,
      controlState: control?.controlState,
    }))

    if (control) {
      sendAuthorizationState(control)
      broadcastAuthorizationState()
    }

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
      if (meta?.role === 'audience' && msg.type !== 'SERVER_TIME_PING' && msg.type !== 'PRIVATE_CONTROL_SIGNAL') {
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

        case 'PRIVATE_CONTROL_SIGNAL':
          if (meta?.role !== 'audience') break
          routePrivateControlSignal(msg)
          break

        case 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION':
          if (meta?.role !== 'control') break
          handleAuthorizationDecision(meta, msg)
          break

        case 'LIVE_AUDIO_CONTROL_JOIN_REQUEST': {
          if (meta?.role !== 'control') break
          const sourceControl = liveAudioControls.get(meta.controlSessionId)
          if (!sourceControl || sourceControl.controlState !== 'PENDING') break
          forwardToAuthorizingControls(msg, sourceControl)
          break
        }

        case 'LIVE_AUDIO_CONTROL_AUTHORIZED': {
          if (meta?.role !== 'control') break
          const issuer = liveAudioControls.get(meta.controlSessionId)
          forwardAuthorizedControlMessage(msg, issuer)
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

        case 'LIVE_AUDIO_GRANT_SPEAK':
        case 'LIVE_AUDIO_REVOKE_SPEAK':
        case 'LIVE_AUDIO_MUTE_PARTICIPANT':
        case 'LIVE_AUDIO_MUTE_ALL':
        case 'LIVE_AUDIO_KICK_PARTICIPANT': {
          if (meta?.role !== 'control') break
          const controlMeta = liveAudioControls.get(meta.controlSessionId)
          if (!isControlAuthorized(controlMeta)) {
            sendError(ws, 'CONTROL_PENDING_FORBIDDEN', 'Pending controls cannot send moderation actions')
            break
          }
          broadcast(msg, (targetMeta) => targetMeta.role !== 'audience')
          break
        }

        default:
          break
      }
    })

    ws.on('close', () => {
      const meta = wsClients.get(ws)
      wsClients.delete(ws)
      if (meta?.role === 'control' && meta.controlSessionId) {
        removeControl(meta.controlSessionId)
      }
    })
    ws.on('error', () => {
      const meta = wsClients.get(ws)
      wsClients.delete(ws)
      if (meta?.role === 'control' && meta.controlSessionId) {
        removeControl(meta.controlSessionId)
      }
    })
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
