export const estimateTimelinePositionSec = (timeline, now = Date.now()) => {
  if (!timeline || typeof timeline !== 'object') return 0
  const basePositionSec = Number.isFinite(timeline.basePositionSec) ? timeline.basePositionSec : 0
  const normalizePosition = (positionSec) => {
    const safePositionSec = Math.max(0, positionSec)
    if (!Number.isFinite(timeline.durationSec) || timeline.durationSec <= 0) return safePositionSec
    if (timeline.loop === true) return safePositionSec % timeline.durationSec
    return Math.min(safePositionSec, timeline.durationSec)
  }
  if (timeline.status !== 'playing') return normalizePosition(basePositionSec)
  const baseServerTimeMs = Number.isFinite(timeline.baseServerTimeMs) ? timeline.baseServerTimeMs : now
  const playbackRate = Number.isFinite(timeline.playbackRate) ? timeline.playbackRate : 1
  return normalizePosition(basePositionSec + ((now - baseServerTimeMs) / 1000) * playbackRate)
}

export const findActiveCueIndex = (cues, positionSec) => {
  if (!Array.isArray(cues) || cues.length === 0 || !Number.isFinite(positionSec)) return -1
  for (let i = cues.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(cues[i]?.timeSec) && positionSec >= cues[i].timeSec) {
      return i
    }
  }
  return -1
}

export const findCueForSlideSelection = (syncMap, slideIndex, targetVerse) => {
  const cues = Array.isArray(syncMap?.cues) ? syncMap.cues : []
  const normalizedVerse = typeof targetVerse === 'string' && targetVerse.trim()
    ? targetVerse.trim()
    : null

  const slideMatches = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => cue?.slideIndex === slideIndex)

  if (slideMatches.length === 0) return null

  if (normalizedVerse) {
    const exactVerse = slideMatches.find(({ cue }) => cue.verse === normalizedVerse)
    if (exactVerse) return exactVerse
  }

  return slideMatches.find(({ cue }) => !cue.verse) || slideMatches[0]
}
