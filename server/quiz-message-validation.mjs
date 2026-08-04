const identifierPattern = /^[A-Za-z0-9._:-]{1,160}$/
const forbiddenObjectKeys = new Set(['__proto__', 'constructor', 'prototype'])

export const QUIZ_MIN_AGGREGATE_GROUP_SIZE = 3

export const isQuizAggregateGroupPublishable = (count) =>
  Number.isInteger(count) && count >= QUIZ_MIN_AGGREGATE_GROUP_SIZE

const isSafeIdentifier = (value) =>
  typeof value === 'string' && identifierPattern.test(value) && !forbiddenObjectKeys.has(value)

export const validatePublicQuizMessage = (message) => {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return 'Quiz payload must be an object'
  }

  if (!isSafeIdentifier(message.presentationId)) return 'Invalid presentationId'

  if (message.type === 'QUIZ_ANSWER_AGGREGATE') {
    if (!isSafeIdentifier(message.submissionId)) return 'Invalid submissionId'
    if (!isSafeIdentifier(message.slideId)) return 'Invalid slideId'
    if (!Array.isArray(message.selectedOptionIds) || message.selectedOptionIds.length > 20) {
      return 'Invalid selectedOptionIds'
    }
    if (!message.selectedOptionIds.every(isSafeIdentifier)) return 'Invalid selectedOptionIds'
    return null
  }

  if (message.type === 'QUIZ_QUESTION_RESULT_AGGREGATE') {
    if (!isSafeIdentifier(message.submissionId)) return 'Invalid submissionId'
    if (!isSafeIdentifier(message.slideId)) return 'Invalid slideId'
    if (typeof message.isCitaCorrect !== 'boolean') return 'Invalid isCitaCorrect'
    return null
  }

  if (message.type === 'QUIZ_FINAL_SCORE_AGGREGATE') {
    if (!isSafeIdentifier(message.submissionId)) return 'Invalid submissionId'
    if (!Number.isInteger(message.requestId) || message.requestId < 0) return 'Invalid requestId'
    if (!Number.isInteger(message.rank) || message.rank < 1 || message.rank > 100) return 'Invalid rank'
    return null
  }

  if (message.type === 'QUIZ_CLEAR_ANSWERS') {
    if (message.slideId !== undefined && !isSafeIdentifier(message.slideId)) return 'Invalid slideId'
    return null
  }

  return 'Unsupported quiz message type'
}
