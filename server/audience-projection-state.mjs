const SLIDE_FIELDS = [
  'id',
  'label',
  'lines',
  'background',
  'type',
  'mediaSrc',
  'mediaFit',
  'mediaShowBg',
  'mediaVolume',
  'mediaSpeed',
  'mediaLoop',
  'mediaPresenterNav',
  'mediaStart',
  'mediaEnd',
  'scriptureBook',
  'scriptureChapter',
  'scriptureVerseStart',
  'scriptureVerseEnd',
  'scriptureVerses',
  'scriptureVerseBackgrounds',
  'quizData',
]

const clone = (value) => {
  if (value === undefined) return undefined
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

const sanitizeCurrentSlide = (slide) => {
  if (!slide || typeof slide !== 'object') return null

  const safeSlide = {}
  for (const field of SLIDE_FIELDS) {
    if (slide[field] !== undefined) safeSlide[field] = clone(slide[field])
  }
  return safeSlide
}

/**
 * Produces the complete functional state Audience needs without disclosing the
 * presentation catalogue, future slides, tags, or control-only metadata.
 */
export const deriveAudienceProjectionState = (state = {}) => {
  const sourcePresentation = state.presentation && typeof state.presentation === 'object'
    ? state.presentation
    : null
  const sourceSlideIndex = Number.isInteger(state.slideIndex) ? state.slideIndex : -1
  const currentSlide = sourceSlideIndex >= 0
    ? sanitizeCurrentSlide(sourcePresentation?.slides?.[sourceSlideIndex])
    : null
  const presentation = sourcePresentation
    ? {
      id: typeof sourcePresentation.id === 'string' ? sourcePresentation.id : '',
      title: typeof sourcePresentation.title === 'string' ? sourcePresentation.title : '',
      background: typeof sourcePresentation.background === 'string' ? sourcePresentation.background : '',
      mode: sourcePresentation.mode === 'trilingual' ? 'trilingual' : 'standard',
      ...(typeof sourcePresentation.fontScale === 'number' ? { fontScale: sourcePresentation.fontScale } : {}),
      slides: currentSlide ? [currentSlide] : [],
    }
    : null

  return {
    presentation,
    slideIndex: currentSlide ? 0 : -1,
    stepIndex: Number.isFinite(state.stepIndex) ? state.stepIndex : 0,
    backgroundLock: state.backgroundLock === true,
    lockedBackgroundValue: typeof state.lockedBackgroundValue === 'string' ? state.lockedBackgroundValue : null,
    userSelectedBackground: typeof state.userSelectedBackground === 'string' ? state.userSelectedBackground : null,
    videoState: clone(state.videoState ?? null),
    appMode: state.appMode === 'scripture' || state.appMode === 'seferManual' ? state.appMode : 'slides',
    scriptureState: clone(state.scriptureState ?? null),
    audioState: clone(state.audioState),
    quizState: clone(state.quizState ?? null),
    autoduckState: clone(state.autoduckState),
    updatedAt: Date.now(),
  }
}
