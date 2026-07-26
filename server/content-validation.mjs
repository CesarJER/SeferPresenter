const LIMITS = Object.freeze({
  presentations: 500,
  slidesPerPresentation: 5_000,
  tagsPerPresentation: 100,
  linesPerSlide: 20,
  textLength: 200_000,
  pathLength: 4_096,
  scriptureVerses: 2_000,
  audioMaps: 1_000,
  cuesPerMap: 20_000,
  maxMediaSeconds: 7 * 24 * 60 * 60,
})

const slideTypes = new Set(['text', 'media', 'tanaj', 'sefer', 'quiz'])
const presentationModes = new Set(['standard', 'trilingual'])
const mediaFits = new Set(['cover', 'contain', 'fill'])
const syncModes = new Set(['none', 'unilateral', 'bilateral'])
const quizOptionIds = new Set(['A', 'B', 'C', 'D'])

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const validateString = (value, path, errors, { nonEmpty = false, max = LIMITS.textLength } = {}) => {
  if (typeof value !== 'string') {
    errors.push(`${path} must be text`)
    return false
  }
  if (nonEmpty && value.trim() === '') errors.push(`${path} must not be empty`)
  if (value.length > max) errors.push(`${path} exceeds ${max} characters`)
  return true
}

const validateOptionalString = (value, path, errors, options) => {
  if (value !== undefined) validateString(value, path, errors, options)
}

const validateQuizData = (value, path, errors) => {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }

  validateString(value.question, `${path}.question`, errors)
  if (!Array.isArray(value.options)) {
    errors.push(`${path}.options must be an array`)
  } else {
    const expectedLengthOk = value.isResultsSlide === true
      ? value.options.length === 0
      : value.options.length >= 2 && value.options.length <= 4
    if (!expectedLengthOk) errors.push(`${path}.options has an invalid length`)
    const optionIds = new Set()
    value.options.forEach((option, index) => {
      const optionPath = `${path}.options[${index}]`
      if (!isRecord(option)) {
        errors.push(`${optionPath} must be an object`)
        return
      }
      if (!quizOptionIds.has(option.id)) errors.push(`${optionPath}.id must be A, B, C, or D`)
      if (optionIds.has(option.id)) errors.push(`${optionPath}.id is duplicated`)
      optionIds.add(option.id)
      validateString(option.text, `${optionPath}.text`, errors)
      if (typeof option.isCorrect !== 'boolean') errors.push(`${optionPath}.isCorrect must be boolean`)
    })
  }

  if (!isFiniteNumber(value.timerSeconds) || value.timerSeconds < 1 || value.timerSeconds > 3_600) {
    errors.push(`${path}.timerSeconds must be between 1 and 3600`)
  }
  if (typeof value.randomize !== 'boolean') errors.push(`${path}.randomize must be boolean`)
  if (typeof value.multiSelect !== 'boolean') errors.push(`${path}.multiSelect must be boolean`)
  if (value.isResultsSlide !== undefined && typeof value.isResultsSlide !== 'boolean') {
    errors.push(`${path}.isResultsSlide must be boolean`)
  }
  validateOptionalString(value.citaRef, `${path}.citaRef`, errors, { max: 500 })
  validateOptionalString(value.citaReviewRef, `${path}.citaReviewRef`, errors, { max: 500 })
  if (value.citaRef && value.citaReviewRef) errors.push(`${path} cannot contain both citaRef and citaReviewRef`)

  if (value.resultProfiles !== undefined) {
    if (!Array.isArray(value.resultProfiles) || value.resultProfiles.length < 1 || value.resultProfiles.length > 9) {
      errors.push(`${path}.resultProfiles must contain between 1 and 9 profiles`)
    } else {
      const ranks = new Set()
      value.resultProfiles.forEach((profile, index) => {
        const profilePath = `${path}.resultProfiles[${index}]`
        if (!isRecord(profile)) {
          errors.push(`${profilePath} must be an object`)
          return
        }
        if (!Number.isInteger(profile.rank) || profile.rank < 1 || profile.rank > 9) {
          errors.push(`${profilePath}.rank must be an integer between 1 and 9`)
        }
        if (ranks.has(profile.rank)) errors.push(`${profilePath}.rank is duplicated`)
        ranks.add(profile.rank)
        validateString(profile.title, `${profilePath}.title`, errors, { max: 500 })
        validateString(profile.description, `${profilePath}.description`, errors)
        validateString(profile.giftText, `${profilePath}.giftText`, errors)
      })
    }
  } else if (value.isResultsSlide === true) {
    errors.push(`${path}.resultProfiles is required for a results slide`)
  }
}

const validateSlide = (value, path, errors) => {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  validateString(value.id, `${path}.id`, errors, { nonEmpty: true, max: 200 })
  validateString(value.label, `${path}.label`, errors, { max: 500 })
  if (!Array.isArray(value.lines) || value.lines.length > LIMITS.linesPerSlide) {
    errors.push(`${path}.lines must be an array with at most ${LIMITS.linesPerSlide} entries`)
  } else {
    value.lines.forEach((line, index) => validateString(line, `${path}.lines[${index}]`, errors))
  }
  if (value.type !== undefined && !slideTypes.has(value.type)) errors.push(`${path}.type is invalid`)
  validateOptionalString(value.background, `${path}.background`, errors, { max: LIMITS.pathLength })
  validateOptionalString(value.mediaSrc, `${path}.mediaSrc`, errors, { max: LIMITS.pathLength })
  if (value.mediaFit !== undefined && !mediaFits.has(value.mediaFit)) errors.push(`${path}.mediaFit is invalid`)
  for (const field of ['mediaLoop', 'mediaPresenterNav', 'mediaShowBg']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') errors.push(`${path}.${field} must be boolean`)
  }
  if (value.mediaVolume !== undefined && (!isFiniteNumber(value.mediaVolume) || value.mediaVolume < 0 || value.mediaVolume > 1)) {
    errors.push(`${path}.mediaVolume must be between 0 and 1`)
  }
  if (value.mediaSpeed !== undefined && (!isFiniteNumber(value.mediaSpeed) || value.mediaSpeed < 0.1 || value.mediaSpeed > 16)) {
    errors.push(`${path}.mediaSpeed must be between 0.1 and 16`)
  }
  for (const field of ['mediaStart', 'mediaEnd']) {
    if (value[field] !== undefined && (!isFiniteNumber(value[field]) || value[field] < 0 || value[field] > LIMITS.maxMediaSeconds)) {
      errors.push(`${path}.${field} is outside the supported range`)
    }
  }
  if (isFiniteNumber(value.mediaStart) && isFiniteNumber(value.mediaEnd) && value.mediaEnd < value.mediaStart) {
    errors.push(`${path}.mediaEnd must not be before mediaStart`)
  }
  for (const field of ['scriptureBook', 'scriptureChapter', 'scriptureVerseStart', 'scriptureVerseEnd']) {
    validateOptionalString(value[field], `${path}.${field}`, errors, { max: 500 })
  }
  if (value.scriptureVerses !== undefined) {
    if (!Array.isArray(value.scriptureVerses) || value.scriptureVerses.length > LIMITS.scriptureVerses) {
      errors.push(`${path}.scriptureVerses is too large or is not an array`)
    } else {
      value.scriptureVerses.forEach((verse, verseIndex) => {
        if (!Array.isArray(verse) || verse.length > LIMITS.linesPerSlide) {
          errors.push(`${path}.scriptureVerses[${verseIndex}] must be a bounded string array`)
          return
        }
        verse.forEach((line, lineIndex) => validateString(line, `${path}.scriptureVerses[${verseIndex}][${lineIndex}]`, errors))
      })
    }
  }
  if (value.scriptureVerseBackgrounds !== undefined) {
    if (!isRecord(value.scriptureVerseBackgrounds) || Object.keys(value.scriptureVerseBackgrounds).length > LIMITS.scriptureVerses) {
      errors.push(`${path}.scriptureVerseBackgrounds must be a bounded object`)
    } else {
      Object.entries(value.scriptureVerseBackgrounds).forEach(([key, background]) => {
        validateString(key, `${path}.scriptureVerseBackgrounds key`, errors, { nonEmpty: true, max: 100 })
        validateString(background, `${path}.scriptureVerseBackgrounds.${key}`, errors, { max: LIMITS.pathLength })
      })
    }
  }
  if (value.quizData !== undefined) validateQuizData(value.quizData, `${path}.quizData`, errors)
  if (value.type === 'quiz' && value.quizData === undefined) errors.push(`${path}.quizData is required for quiz slides`)
}

export const validatePresentationsPayload = (value) => {
  const errors = []
  if (!Array.isArray(value) || value.length > LIMITS.presentations) {
    return { ok: false, errors: [`presentations must be an array with at most ${LIMITS.presentations} entries`] }
  }
  const presentationIds = new Set()
  value.forEach((presentation, index) => {
    const itemPath = `presentations[${index}]`
    if (!isRecord(presentation)) {
      errors.push(`${itemPath} must be an object`)
      return
    }
    validateString(presentation.id, `${itemPath}.id`, errors, { nonEmpty: true, max: 200 })
    if (presentationIds.has(presentation.id)) errors.push(`${itemPath}.id is duplicated`)
    presentationIds.add(presentation.id)
    validateString(presentation.title, `${itemPath}.title`, errors, { max: 1_000 })
    validateOptionalString(presentation.background, `${itemPath}.background`, errors, { max: LIMITS.pathLength })
    if (presentation.mode !== undefined && !presentationModes.has(presentation.mode)) errors.push(`${itemPath}.mode is invalid`)
    if (presentation.fontScale !== undefined && (!isFiniteNumber(presentation.fontScale) || presentation.fontScale < 0.25 || presentation.fontScale > 4)) {
      errors.push(`${itemPath}.fontScale must be between 0.25 and 4`)
    }
    if (presentation.tags !== undefined) {
      if (!Array.isArray(presentation.tags) || presentation.tags.length > LIMITS.tagsPerPresentation) {
        errors.push(`${itemPath}.tags must be a bounded array`)
      } else {
        presentation.tags.forEach((tag, tagIndex) => validateString(tag, `${itemPath}.tags[${tagIndex}]`, errors, { max: 100 }))
      }
    }
    if (!Array.isArray(presentation.slides) || presentation.slides.length > LIMITS.slidesPerPresentation) {
      errors.push(`${itemPath}.slides must be an array with at most ${LIMITS.slidesPerPresentation} entries`)
      return
    }
    const slideIds = new Set()
    presentation.slides.forEach((slide, slideIndex) => {
      validateSlide(slide, `${itemPath}.slides[${slideIndex}]`, errors)
      if (isRecord(slide)) {
        if (slideIds.has(slide.id)) errors.push(`${itemPath}.slides[${slideIndex}].id is duplicated`)
        slideIds.add(slide.id)
      }
    })
  })
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}

export const validateAudioSyncPayload = (value) => {
  const errors = []
  if (!Array.isArray(value) || value.length > LIMITS.audioMaps) {
    return { ok: false, errors: [`audio sync maps must be an array with at most ${LIMITS.audioMaps} entries`] }
  }
  const mapIds = new Set()
  value.forEach((map, index) => {
    const itemPath = `audioSyncMaps[${index}]`
    if (!isRecord(map)) {
      errors.push(`${itemPath} must be an object`)
      return
    }
    validateString(map.id, `${itemPath}.id`, errors, { nonEmpty: true, max: 200 })
    if (mapIds.has(map.id)) errors.push(`${itemPath}.id is duplicated`)
    mapIds.add(map.id)
    validateString(map.name, `${itemPath}.name`, errors, { max: 1_000 })
    validateString(map.audioSrc, `${itemPath}.audioSrc`, errors, { nonEmpty: true, max: LIMITS.pathLength })
    validateString(map.presentationId, `${itemPath}.presentationId`, errors, { nonEmpty: true, max: 200 })
    if (!syncModes.has(map.defaultSyncMode)) errors.push(`${itemPath}.defaultSyncMode is invalid`)
    if (!isFiniteNumber(map.defaultVolume) || map.defaultVolume < 0 || map.defaultVolume > 1) {
      errors.push(`${itemPath}.defaultVolume must be between 0 and 1`)
    }
    if (!Array.isArray(map.cues) || map.cues.length > LIMITS.cuesPerMap) {
      errors.push(`${itemPath}.cues must be an array with at most ${LIMITS.cuesPerMap} entries`)
      return
    }
    let previousTime = -1
    map.cues.forEach((cue, cueIndex) => {
      const cuePath = `${itemPath}.cues[${cueIndex}]`
      if (!isRecord(cue)) {
        errors.push(`${cuePath} must be an object`)
        return
      }
      if (!isFiniteNumber(cue.timeSec) || cue.timeSec < 0 || cue.timeSec > LIMITS.maxMediaSeconds) {
        errors.push(`${cuePath}.timeSec is outside the supported range`)
      } else if (cue.timeSec < previousTime) {
        errors.push(`${cuePath}.timeSec must be sorted in ascending order`)
      }
      if (isFiniteNumber(cue.timeSec)) previousTime = cue.timeSec
      if (!Number.isInteger(cue.slideIndex) || cue.slideIndex < 0 || cue.slideIndex >= LIMITS.slidesPerPresentation) {
        errors.push(`${cuePath}.slideIndex is outside the supported range`)
      }
      validateOptionalString(cue.verse, `${cuePath}.verse`, errors, { max: 100 })
    })
  })
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}

export const formatValidationError = (result) =>
  result.errors.slice(0, 8).join('; ')

export { LIMITS }
