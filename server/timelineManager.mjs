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
  syncMode: 'none',
  activeCueIndex: null,
  nextCueIndex: null,
  updatedBy: 'server',
})

let timeline = createInitialTimeline()

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const getEstimatedPosition = (now) => {
  if (timeline.status !== 'playing') return timeline.basePositionSec
  const elapsedSec = (now - timeline.baseServerTimeMs) / 1000
  return Math.max(0, timeline.basePositionSec + elapsedSec * timeline.playbackRate)
}

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
      next.presentationId = action.presentationId ?? null
      next.audioSrc = action.audioSrc ?? null
      next.syncMapId = action.syncMapId ?? null
      next.status = 'idle'
      next.basePositionSec = 0
      next.activeCueIndex = null
      next.nextCueIndex = null
      next.updatedBy = 'control'
      break
    case 'PLAY':
      next.status = 'playing'
      if (Number.isFinite(action.positionSec)) next.basePositionSec = Math.max(0, action.positionSec)
      next.updatedBy = 'control'
      break
    case 'PAUSE':
      next.status = 'paused'
      next.updatedBy = 'control'
      break
    case 'SEEK':
      if (!Number.isFinite(action.positionSec)) return timeline
      next.basePositionSec = Math.max(0, action.positionSec)
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
    case 'SET_SYNC_MODE':
      next.syncMode = ['none', 'unilateral', 'bilateral'].includes(action.mode) ? action.mode : 'none'
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
