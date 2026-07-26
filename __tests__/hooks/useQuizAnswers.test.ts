// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAudienceAnswers, useControllerAnswers } from '../../src/hooks/useQuizAnswers';

Object.defineProperty(window, 'BroadcastChannel', {
  value: class {
    addEventListener() {}
    removeEventListener() {}
    postMessage() {}
  }
});
Object.defineProperty(window, 'EventSource', {
  value: class {
    close() {}
  }
});
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve({}) }));

describe('useQuizAnswers - Audience', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetch).mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('quiz persiste localmente segun requisito y se borra solo con clear (o al reiniciar app que limpia storage si aplica)', () => {
    const { result, rerender } = renderHook(() => useAudienceAnswers('presentation-1'));

    // Initially no answers
    expect(result.current.getAnswers()).toEqual({});

    // Select radio option
    act(() => {
      result.current.selectRadioOption('slide-1', 'A');
    });

    const answer = result.current.getAnswer('slide-1');
    expect(answer.selectedOptionIds).toEqual(['A']);

    // Check localStorage
    const stored = JSON.parse(localStorage.getItem('sefer-quiz-answers-by-presentation') || '{}');
    expect(stored['presentation-1']['slide-1'].selectedOptionIds).toEqual(['A']);

    // Rerender should keep it
    rerender();
    expect(result.current.getAnswer('slide-1').selectedOptionIds).toEqual(['A']);

    // Clear answer
    act(() => {
      result.current.clearAnswer('slide-1');
    });

    expect(result.current.getAnswer('slide-1').selectedOptionIds).toEqual([]);
    const storedAfterClear = JSON.parse(localStorage.getItem('sefer-quiz-answers-by-presentation') || '{}');
    expect(storedAfterClear['presentation-1']['slide-1']).toBeUndefined();
  });

  it('submitAnswer actualiza estado a submitted y trigger network side effects', () => {
    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));

    act(() => {
      result.current.selectRadioOption('slide-2', 'B');
      result.current.submitAnswer('slide-2');
    });

    const answer = result.current.getAnswer('slide-2');
    expect(answer.submitted).toBe(true);
    expect(answer.submittedAt).toBeGreaterThan(0);
    expect(answer.selectedOptionIds).toEqual(['B']);

    // Check localStorage
    const stored = JSON.parse(localStorage.getItem('sefer-quiz-answers-by-presentation') || '{}');
    expect(stored['presentation-1']['slide-2'].submitted).toBe(true);
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/quiz-answer');
    expect(request).toBeTruthy();
    const payload = JSON.parse(String((request?.[1] as RequestInit).body));
    expect(payload).toMatchObject({ presentationId: 'presentation-1', slideId: 'slide-2' });
  });

  it('aisla respuestas y puntuaciones por presentationId', () => {
    const { result, rerender } = renderHook(
      ({ presentationId }) => useAudienceAnswers(presentationId),
      { initialProps: { presentationId: 'presentation-1' } },
    );

    act(() => {
      result.current.selectRadioOption('shared-slide', 'A');
      result.current.saveScore('shared-slide', {
        slideId: 'shared-slide', optionCentipunts: 50, citaCentipunts: 0,
        bonusCentipunts: 0, totalCentipunts: 50,
      });
    });

    rerender({ presentationId: 'presentation-2' });
    expect(result.current.getAnswer('shared-slide').selectedOptionIds).toEqual([]);
    expect(result.current.getScores()).toEqual({});

    act(() => result.current.selectRadioOption('shared-slide', 'B'));
    rerender({ presentationId: 'presentation-1' });
    expect(result.current.getAnswer('shared-slide').selectedOptionIds).toEqual(['A']);
    expect(result.current.getScores()['shared-slide'].totalCentipunts).toBe(50);
  });

  it('purga respuestas y rota la identidad efímera al salir', () => {
    const { result } = renderHook(() => useAudienceAnswers('presentation-1', 'Alias temporal'));

    act(() => {
      result.current.selectRadioOption('slide-1', 'A');
      result.current.submitAnswer('slide-1');
    });
    const firstRequest = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/quiz-answer');
    const firstPayload = JSON.parse(String((firstRequest?.[1] as RequestInit).body));
    expect(firstPayload.displayName).toBeUndefined();

    act(() => window.dispatchEvent(new CustomEvent('sefer-audience-logout')));
    expect(result.current.getAnswers()).toEqual({});
    expect(result.current.getScores()).toEqual({});

    act(() => {
      result.current.selectRadioOption('slide-2', 'B');
      result.current.submitAnswer('slide-2');
    });
    const requests = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/quiz-answer');
    const rotatedPayload = JSON.parse(String((requests.at(-1)?.[1] as RequestInit).body));
    expect(rotatedPayload.sessionId).not.toBe(firstPayload.sessionId);
  });
});

describe('useQuizAnswers - Control', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue({ json: () => Promise.resolve({}) } as Response);
  });

  it('recupera del servidor las respuestas de la sesion al reconectar Control', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({
        type: 'QUIZ_SESSION_SNAPSHOT',
        presentationId: 'presentation-1',
        sessions: {
          audienceA: {
            sessionId: 'audienceA',
            presentationId: 'presentation-1',
            answers: {
              q1: {
                slideId: 'q1', selectedOptionIds: ['A'], submitted: true,
                submittedAt: 1234, bonusReadingClaimed: false,
              },
            },
          },
        },
        sessionTotalScores: { audienceA: 50 },
      }),
    } as Response);

    const { result } = renderHook(() => useControllerAnswers('presentation-1'));

    await waitFor(() => expect(result.current.getSubmittedCount('q1')).toBe(1));
    expect(result.current.sessions.audienceA.answers.q1.selectedOptionIds).toEqual(['A']);

    act(() => result.current.clearSlideAnswers('q1'));
    expect(result.current.getSubmittedCount('q1')).toBe(0);
  });

  it('reclassifies sessions from controller-calculated partial totals', () => {
    const { result } = renderHook(() => useControllerAnswers('presentation-1'));
    const profiles = [
      { rank: 1, title: 'Alto', description: '', giftText: '' },
      { rank: 2, title: 'Bajo', description: '', giftText: '' },
    ];

    const stats = result.current.calcRangeStats(profiles, 100, {
      sessionA: 75,
      sessionB: 25,
    });

    expect(stats).toEqual([
      { rank: 1, title: 'Alto', count: 1, sessionIds: ['sessionA'] },
      { rank: 2, title: 'Bajo', count: 1, sessionIds: ['sessionB'] },
    ]);
  });
});
