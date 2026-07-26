import { describe, expect, it } from 'vitest';
import {
  clearQuizAggregateState,
  quizSessionMatchesAudience,
} from '../server/quiz-aggregate-state.mjs';

describe('quiz aggregate session lifecycle', () => {
  it('purges every presentation scope and nominal field on session rotation', () => {
    const state = {
      submittedSessionsBySlideId: new Map([
        ['presentation-a::slide-1', new Set(['participant-a'])],
        ['presentation-b::slide-2', new Set(['participant-b'])],
      ]),
      finalScoreBuckets: new Map([['presentation-a::100-199', 1]]),
      finalScoreSessions: new Map([['presentation-b::participant-b', 'presentation-b::100-199']]),
      answerSessions: new Map([
        ['presentation-a::participant-a', { displayName: 'Alias A', answers: {} }],
        ['presentation-b::participant-b', { displayName: 'Alias B', answers: {} }],
      ]),
      finalScoreValues: new Map([['presentation-a::participant-a', 150]]),
      updatedAt: Date.now(),
    };

    clearQuizAggregateState(state);

    expect(state.submittedSessionsBySlideId.size).toBe(0);
    expect(state.finalScoreBuckets.size).toBe(0);
    expect(state.finalScoreSessions.size).toBe(0);
    expect(state.answerSessions.size).toBe(0);
    expect(state.finalScoreValues.size).toBe(0);
    expect(state.updatedAt).toBeNull();
  });

  it('binds answer and score identities to the admitted credential', () => {
    const access = { participantId: 'participant-a' };
    expect(quizSessionMatchesAudience({
      type: 'QUIZ_ANSWER',
      sessionId: 'participant-a',
    }, access)).toBe(true);
    expect(quizSessionMatchesAudience({
      type: 'QUIZ_FINAL_SCORE',
      sessionId: 'participant-b',
    }, access)).toBe(false);
    expect(quizSessionMatchesAudience({
      type: 'QUIZ_CLEAR_ANSWERS',
    }, access)).toBe(true);
  });
});
