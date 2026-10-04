import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { WebSocket } from 'ws'
import { getSeferDataPaths, resolveSeferDataDir } from '../server/data-directory.mjs'
import { createPresentationSessionStore } from '../server/presentation-session.mjs'

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const readActivePresentationSession = (address, { timeoutMs = 5_000 } = {}) => {
  const url = new URL(address)
  if (!['ws:', 'wss:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/ws') {
    throw new Error('A local backend WebSocket URL is required')
  }
  url.search = '?role=audience'
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { maxPayload: 64 * 1024 })
    let finished = false
    const finish = (error, sessionId) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      ws.removeAllListeners('message')
      if (ws.readyState === WebSocket.OPEN) ws.close()
      else ws.terminate()
      if (error) reject(error)
      else resolve(sessionId)
    }
    const timer = setTimeout(() => finish(new Error('Backend session handshake timed out')), timeoutMs)
    ws.once('error', () => finish(new Error('Backend session handshake failed')))
    ws.once('close', () => finish(new Error('Backend closed before its session was received')))
    ws.on('message', (raw) => {
      let message
      try { message = JSON.parse(raw.toString()) } catch { return }
      if (message?.type !== 'WELCOME') return
      if (typeof message.presentationSessionId !== 'string' || !uuidV4Pattern.test(message.presentationSessionId)) {
        finish(new Error('Backend returned an invalid presentation session'))
        return
      }
      finish(null, message.presentationSessionId)
    })
  })
}

export const seedPresentationSessionFromBackend = async ({ url = 'ws://127.0.0.1:8787/ws', dataDir }) => {
  if (!dataDir) throw new Error('The private data directory is required')
  const stat = fs.lstatSync(dataDir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The private data directory must be a real directory')
  const sessionId = await readActivePresentationSession(url)
  const storedSessionId = createPresentationSessionStore({
    filePath: getSeferDataPaths(dataDir).presentationSession,
    initialSessionId: sessionId,
  }).getSessionId()
  if (storedSessionId !== sessionId) throw new Error('Existing presentation marker differs from the active backend')
  return storedSessionId
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { url: { type: 'string' }, 'data-dir': { type: 'string' } } })
    const configuredPath = values['data-dir'] || process.env.SEFER_DATA_DIR
    if (!configuredPath) throw new Error('Private data directory is required')
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    await seedPresentationSessionFromBackend({
      url: values.url,
      dataDir: resolveSeferDataDir({ rootDir, configuredPath }),
    })
    console.log('Presentation session marker ready for upgrade; no audience or quiz data stored')
  } catch {
    console.error('Presentation session migration failed; verify the local backend and private data directory')
    process.exitCode = 1
  }
}
