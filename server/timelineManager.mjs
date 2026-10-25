import { randomUUID } from 'node:crypto'

const createInitialTimeline = () => ({
  timelineId: randomUUID(),
  version: 0,
  presentationId: null,
  audioSrc: null,
  syncMapId: null,
  status: 'idle',
  basePositionSec: 0,
  baseServerTimeMs: Date.now(),
  playbackRate: 1,
  volume: 1,
  durationSec: null,
  loop: false,
  syncMode: 'none',
  activeCueIndex: null,
  nextCueIndex: null,
  updatedBy: 'server',
})

let timeline = createInitialTimeline()

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const validSyncModes = new Set(['none', 'unilateral', 'bilateral'])

const getEstimatedPosition = (now) => {
  const normalizePosition = (position) => {
    const safePosition = Math.max(0, position)
    if (!Number.isFinite(timeline.durationSec) || timeline.durationSec <= 0) return safePosition
    if (timeline.loop) return safePosition % timeline.durationSec
    return Math.min(safePosition, timeline.durationSec)
  }

  if (timeline.status !== 'playing') return normalizePosition(timeline.basePositionSec)
  const elapsedSec = (now - timeline.baseServerTimeMs) / 1000
  return normalizePosition(timeline.basePositionSec + elapsedSec * timeline.playbackRate)
}

const normalizeDuration = (durationSec) => (
  Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null
)

const applyAction = (action) => {
  if (!action || typeof action.type !== 'string') return timeline

  const now = Date.now()
  const next = {
    ...timeline,
    version: timeline.version + 1,
    basePositionSec: getEstimatedPosition(now),
    baseServerTimeMs: now,
  }

  switch (action.type) {
    case 'SET_TRACK':
      next.timelineId = randomUUID()
      next.version = 1
      next.presentationId = action.presentationId || null
      next.audioSrc = action.audioSrc || null
      next.syncMapId = action.syncMapId || null
      next.syncMode = validSyncModes.has(action.syncMode) ? action.syncMode : 'none'
      next.volume = clamp(Number.isFinite(action.volume) ? action.volume : next.volume, 0, 1)
      next.durationSec = null
      next.loop = false
      next.status = 'idle'
      next.basePositionSec = 0
      next.activeCueIndex = null
      next.nextCueIndex = null
      next.updatedBy = 'control'
      break
    case 'PLAY':
      next.status = 'playing'
      if (timeline.status === 'ended' && !Number.isFinite(action.positionSec)) {
        next.basePositionSec = 0
      } else if (Number.isFinite(action.positionSec)) {
        next.basePositionSec = Math.max(0, action.positionSec)
      }
      next.updatedBy = 'control'
      break
    case 'PAUSE':
      next.status = 'paused'
      next.updatedBy = 'control'
      break
    case 'SEEK':
      if (!Number.isFinite(action.positionSec)) return timeline
      next.basePositionSec = Math.max(0, action.positionSec)
      if (next.status === 'ended') next.status = 'paused'
      next.updatedBy = 'control'
      break
    case 'SET_RATE':
      next.playbackRate = clamp(Number.isFinite(action.rate) ? action.rate : 1, 0.1, 4)
      next.updatedBy = 'control'
      break
    case 'SET_VOLUME':
      next.volume = clamp(Number.isFinite(action.volume) ? action.volume : 1, 0, 1)
      next.updatedBy = 'control'
      break
    case 'SET_DURATION': {
      const durationSec = normalizeDuration(action.durationSec)
      if (timeline.durationSec === durationSec) return timeline
      next.durationSec = durationSec
      if (durationSec !== null && next.basePositionSec > durationSec) {
        next.basePositionSec = durationSec
      }
      next.updatedBy = 'control'
      break
    }
    case 'SET_LOOP':
      if (timeline.loop === action.loop) return timeline
      next.loop = Boolean(action.loop)
      next.updatedBy = 'control'
      break
    case 'SET_SYNC_MODE':
      next.syncMode = validSyncModes.has(action.mode)
        ? action.mode
        : (validSyncModes.has(action.syncMode) ? action.syncMode : 'none')
      if (typeof action.syncMapId === 'string' && action.syncMapId) {
        next.syncMapId = action.syncMapId
      } else if (action.syncMapId === null) {
        next.syncMapId = null
      }
      if (typeof action.presentationId === 'string' && action.presentationId) {
        next.presentationId = action.presentationId
      }
      next.updatedBy = 'control'
      break
    case 'END':
      if (timeline.loop) return timeline
      if (timeline.status === 'ended') return timeline
      next.status = 'ended'
      next.basePositionSec = Number.isFinite(action.positionSec)
        ? Math.max(0, action.positionSec)
        : getEstimatedPosition(now)
      next.updatedBy = 'control'
      break
    case 'STOP':
      next.status = 'idle'
      next.basePositionSec = 0
      next.updatedBy = 'control'
      break
    default:
      return timeline
  }

  timeline = next
  return timeline
}

const getTimeline = () => timeline

const reset = () => {
  timeline = createInitialTimeline()
}

export { applyAction, getTimeline, reset }
