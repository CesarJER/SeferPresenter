import { describe, expect, it } from 'vitest';
import {
  isQuizAggregateGroupPublishable,
  QUIZ_MIN_AGGREGATE_GROUP_SIZE,
  validatePublicQuizMessage,
} from '../server/quiz-message-validation.mjs';

describe('public quiz message validation', () => {
  const validAnswer = {
    type: 'QUIZ_ANSWER_AGGREGATE',
    presentationId: 'presentation-1',
    submissionId: 'submission-1',
    slideId: 'slide-1',
    selectedOptionIds: ['answer-a'],
  };

  it('accepts bounded unlinkable aggregate contributions', () => {
    expect(validatePublicQuizMessage(validAnswer)).toBeNull();
    expect(validatePublicQuizMessage({
      type: 'QUIZ_QUESTION_RESULT_AGGREGATE',
      presentationId: 'presentation-1',
      submissionId: 'result-1',
      slideId: 'slide-1',
      isCitaCorrect: true,
    })).toBeNull();
    expect(validatePublicQuizMessage({
      type: 'QUIZ_FINAL_SCORE_AGGREGATE',
      presentationId: 'presentation-1',
      submissionId: 'final-1',
      requestId: 2,
      rank: 1,
    })).toBeNull();
  });

  it('publishes aggregate groups only from the minimum threshold', () => {
    expect(QUIZ_MIN_AGGREGATE_GROUP_SIZE).toBe(3);
    expect(isQuizAggregateGroupPublishable(2)).toBe(false);
    expect(isQuizAggregateGroupPublishable(3)).toBe(true);
  });

  it.each([
    [{ ...validAnswer, type: 'UNKNOWN' }, 'Unsupported quiz message type'],
    [{ ...validAnswer, slideId: '__proto__' }, 'Invalid slideId'],
    [{ ...validAnswer, selectedOptionIds: Array(21).fill('a') }, 'Invalid selectedOptionIds'],
    [{ ...validAnswer, selectedOptionIds: ['<script>'] }, 'Invalid selectedOptionIds'],
    [{ ...validAnswer, sessionId: 'forbidden', submissionId: undefined }, 'Invalid submissionId'],
    [{ type: 'QUIZ_FINAL_SCORE_AGGREGATE', presentationId: 'p', submissionId: 's', requestId: 1, rank: 101 }, 'Invalid rank'],
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
