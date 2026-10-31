import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeJsonSafely } from './json-persistence.mjs'

export const PRESENTATION_SESSION_TTL_MS = 24 * 60 * 60 * 1000
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const readMarker = (filePath, now) => {
  let contents
  try {
    const stat = fs.lstatSync(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Presentation session marker must be a real file')
    contents = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  let marker
  try {
    marker = JSON.parse(contents)
  } catch {
    return null
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) ||
      Object.keys(marker).length !== 2 || !uuidV4Pattern.test(marker.sessionId) ||
      !Number.isFinite(marker.expiresAt) ||
      marker.expiresAt > now + PRESENTATION_SESSION_TTL_MS) return null
  return { sessionId: marker.sessionId, expiresAt: marker.expiresAt }
}

// This marker preserves the session boundary, never audience or quiz data.
export const createPresentationSessionStore = ({ filePath, now = Date.now, write = writeJsonSafely, initialSessionId }) => {
  if (!filePath) throw new Error('Presentation session marker path is required')
  const startedAt = now()
  const stored = readMarker(filePath, startedAt)
  const retiredSessionId = stored && stored.expiresAt <= startedAt ? stored.sessionId : undefined
  let marker = retiredSessionId ? null : stored
  const rotate = () => {
    const next = { sessionId: randomUUID(), expiresAt: now() + PRESENTATION_SESSION_TTL_MS }
    write(filePath, next)
    marker = next
    return marker.sessionId
  }
  if (!marker && initialSessionId !== undefined) {
    if (typeof initialSessionId !== 'string' || !uuidV4Pattern.test(initialSessionId)) {
      throw new Error('Initial presentation session must be a UUID')
    }
    const seeded = { sessionId: initialSessionId, expiresAt: now() + PRESENTATION_SESSION_TTL_MS }
    write(filePath, seeded)
    marker = seeded
  }
  if (!marker) rotate()
  return Object.freeze({ getSessionId: () => marker.sessionId, getRetiredSessionId: () => retiredSessionId, rotate })
}
