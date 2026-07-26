const identifierPattern = /^[A-Za-z0-9._:-]{1,160}$/
const forbiddenObjectKeys = new Set(['__proto__', 'constructor', 'prototype'])

const isSafeIdentifier = (value) =>
  typeof value === 'string' && identifierPattern.test(value) && !forbiddenObjectKeys.has(value)

const isOptionalBoundedString = (value, maxLength) =>
  value === undefined || (typeof value === 'string' && value.length <= maxLength)

export const validatePublicQuizMessage = (message) => {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return 'Quiz payload must be an object'
  }

  if (!isSafeIdentifier(message.presentationId)) return 'Invalid presentationId'

  if (message.type === 'QUIZ_ANSWER') {
    if (!isSafeIdentifier(message.sessionId)) return 'Invalid sessionId'
    if (!isSafeIdentifier(message.slideId)) return 'Invalid slideId'
    if (message.answer === null || typeof message.answer !== 'object' || Array.isArray(message.answer)) {
      return 'Invalid answer'
    }
    if (message.answer.submitted !== true) return 'Answer must be submitted'
    if (!Array.isArray(message.answer.selectedOptionIds) || message.answer.selectedOptionIds.length > 20) {
      return 'Invalid selectedOptionIds'
    }
    if (!message.answer.selectedOptionIds.every(isSafeIdentifier)) return 'Invalid selectedOptionIds'
    if (!isOptionalBoundedString(message.displayName, 80)) return 'Invalid displayName'
    for (const field of ['citaBook', 'citaChapter', 'citaVerseStart', 'citaVerseEnd']) {
      if (!isOptionalBoundedString(message.answer[field], field === 'citaBook' ? 80 : 16)) {
        return `Invalid ${field}`
      }
    }
    if (
      message.answer.submittedAt !== undefined &&
      (!Number.isFinite(message.answer.submittedAt) || message.answer.submittedAt < 0)
    ) return 'Invalid submittedAt'
    return null
  }

  if (message.type === 'QUIZ_FINAL_SCORE') {
    if (!isSafeIdentifier(message.sessionId)) return 'Invalid sessionId'
    if (
      !Number.isFinite(message.totalCentipunts) ||
      message.totalCentipunts < 0 ||
      message.totalCentipunts > 100_000_000
    ) return 'Invalid totalCentipunts'
    return null
  }

  if (message.type === 'QUIZ_CLEAR_ANSWERS') {
    if (message.slideId !== undefined && !isSafeIdentifier(message.slideId)) return 'Invalid slideId'
    return null
  }

  return 'Unsupported quiz message type'
}
