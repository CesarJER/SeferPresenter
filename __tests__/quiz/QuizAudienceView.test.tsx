// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuizAudienceView } from '../../src/components/quiz/QuizAudienceView';
import { QuizResultsController } from '../../src/components/quiz/QuizResultsView';
import { makeEmptyAudienceAnswer } from '../../src/types/quiz';
import type { QuizData } from '../../src/types/presentation';

vi.mock('../../src/utils/metadataCache', () => ({
  getMetadata: () => Promise.resolve(null),
  resolveBookName: () => '',
}));

const quizData: QuizData = {
  question: 'Resultados',
  options: [],
  timerSeconds: 30,
  randomize: false,
  multiSelect: false,
  isResultsSlide: true,
  resultProfiles: [
    { rank: 1, title: 'Resultado', description: '', giftText: '' },
  ],
};

const baseProps = {
  slide: { id: 'results' },
  quizData,
  subslides: [{ kind: 'results' as const, label: 'Resultados' }],
  currentSubslideIndex: 0,
  timerState: {
    status: 'completed' as const,
    timerStartedAt: null,
    timerDurationMs: 30_000,
    pausedRemainingMs: null,
  },
  answer: makeEmptyAudienceAnswer('results'),
  onSelectRadio: vi.fn(),
  onToggleCheckbox: vi.fn(),
  onSetCitaField: vi.fn(),
  onSubmit: vi.fn(),
  onClear: vi.fn(),
  onBonusClaim: vi.fn(),
  allScores: {
    q1: {
      slideId: 'q1', optionCentipunts: 50, citaCentipunts: 0,
      bonusCentipunts: 0, totalCentipunts: 50,
    },
  },
  resultSlideIds: ['q1'],
  maxBaseCentipunts: 50,
};

describe('QuizAudienceView result score requests', () => {
  it('resends the score when Control recalculates the same question cut again', async () => {
    const onSendFinalScore = vi.fn();
    const { rerender } = render(
      <QuizAudienceView {...baseProps} scoreRequestId={1} onSendFinalScore={onSendFinalScore} />,
    );

    await waitFor(() => expect(onSendFinalScore).toHaveBeenCalledTimes(1));
    expect(onSendFinalScore).toHaveBeenLastCalledWith(50);

    rerender(
      <QuizAudienceView {...baseProps} scoreRequestId={2} onSendFinalScore={onSendFinalScore} />,
    );

    await waitFor(() => expect(onSendFinalScore).toHaveBeenCalledTimes(2));
    expect(onSendFinalScore).toHaveBeenLastCalledWith(50);
  });

  it('shows the concise Recalcular button and invokes it', () => {
    const onRecalculateResults = vi.fn();
    render(
      <QuizResultsController
        profiles={quizData.resultProfiles ?? []}
        rangeStats={[]}
        totalSessions={1}
        maxBaseCentipunts={50}
        registeredQuestionCount={1}
        onRecalculateResults={onRecalculateResults}
      />,
    );

    const button = screen.getByRole('button', { name: 'Recalcular' });
    expect(screen.queryByText(/Recalcular con/)).toBeNull();
    fireEvent.click(button);
    expect(onRecalculateResults).toHaveBeenCalledTimes(1);
  });
});
