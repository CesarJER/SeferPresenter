import { describe, expect, it } from 'vitest';
import { validatePublicQuizMessage } from '../server/quiz-message-validation.mjs';

describe('public quiz message validation', () => {
  const validAnswer = {
    type: 'QUIZ_ANSWER',
    presentationId: 'presentation-1',
    sessionId: 'session-1',
    slideId: 'slide-1',
    answer: { submitted: true, selectedOptionIds: ['answer-a'] },
  };

  it('accepts bounded audience answers and final scores', () => {
    expect(validatePublicQuizMessage(validAnswer)).toBeNull();
    expect(validatePublicQuizMessage({
      type: 'QUIZ_FINAL_SCORE',
      presentationId: 'presentation-1',
      sessionId: 'session-1',
      totalCentipunts: 1200,
    })).toBeNull();
  });

  it.each([
    [{ ...validAnswer, type: 'UNKNOWN' }, 'Unsupported quiz message type'],
    [{ ...validAnswer, slideId: '__proto__' }, 'Invalid slideId'],
    [{ ...validAnswer, answer: { submitted: true, selectedOptionIds: Array(21).fill('a') } }, 'Invalid selectedOptionIds'],
    [{ ...validAnswer, answer: { submitted: true, selectedOptionIds: ['<script>'] } }, 'Invalid selectedOptionIds'],
    [{ ...validAnswer, displayName: 'x'.repeat(81) }, 'Invalid displayName'],
    [{ type: 'QUIZ_FINAL_SCORE', presentationId: 'p', sessionId: 's', totalCentipunts: 100_000_001 }, 'Invalid totalCentipunts'],
  ])('rejects malformed or unbounded messages', (message, error) => {
    expect(validatePublicQuizMessage(message)).toBe(error);
  });

  it('only accepts a bounded clear command shape for authorization upstream', () => {
    expect(validatePublicQuizMessage({
      type: 'QUIZ_CLEAR_ANSWERS',
      presentationId: 'presentation-1',
      slideId: 'slide-1',
    })).toBeNull();
    expect(validatePublicQuizMessage({
      type: 'QUIZ_CLEAR_ANSWERS',
      presentationId: 'presentation-1',
      slideId: '../all',
    })).toBe('Invalid slideId');
  });
});
