export const clearQuizAggregateState = (state) => {
  state.submittedSessionsBySlideId.clear()
  state.finalScoreBuckets.clear()
  state.finalScoreSessions.clear()
  state.answerSessions.clear()
  state.finalScoreValues.clear()
  state.updatedAt = null
}

export const quizSessionMatchesAudience = (message, audienceAccess) => {
  if (!audienceAccess) return true
  if (message?.type !== 'QUIZ_ANSWER' && message?.type !== 'QUIZ_FINAL_SCORE') return true
  return message.sessionId === audienceAccess.participantId
}
