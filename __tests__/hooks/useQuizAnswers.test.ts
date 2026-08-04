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
    constructor(url: string | URL) {
      eventSourceUrls.push(String(url));
    }
    close() {}
  }
});
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve({}) }));

const eventSourceUrls: string[] = [];

describe('useQuizAnswers - Audience', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    eventSourceUrls.length = 0;
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
    const stored = JSON.parse(localStorage.getItem('sefer-quiz-answers-by-presentation') || '{}').data;
    expect(stored['presentation-1']['slide-1'].selectedOptionIds).toEqual(['A']);

    // Rerender should keep it
    rerender();
    expect(result.current.getAnswer('slide-1').selectedOptionIds).toEqual(['A']);

    // Clear answer
    act(() => {
      result.current.clearAnswer('slide-1');
    });

    expect(result.current.getAnswer('slide-1').selectedOptionIds).toEqual([]);
    const storedAfterClear = JSON.parse(localStorage.getItem('sefer-quiz-answers-by-presentation') || '{}').data;
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
    const stored = JSON.parse(localStorage.getItem('sefer-quiz-answers-by-presentation') || '{}').data;
    expect(stored['presentation-1']['slide-2'].submitted).toBe(true);
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/quiz-answer');
    expect(request).toBeTruthy();
    const payload = JSON.parse(String((request?.[1] as RequestInit).body));
    expect(payload).toMatchObject({
      type: 'QUIZ_ANSWER_AGGREGATE',
      presentationId: 'presentation-1',
      slideId: 'slide-2',
      selectedOptionIds: ['B'],
    });
    expect(payload).not.toHaveProperty('sessionId');
    expect(payload).not.toHaveProperty('displayName');
    expect(payload).not.toHaveProperty('answer');
  });

  it('usa credencial y ticket efímeros en una sesión controlada', () => {
    localStorage.setItem('sefer-audience-access', JSON.stringify({
      presentationSessionId: 'session-1',
      credential: 'audience-credential',
    }));
    sessionStorage.setItem('sefer-audience-quiz-sse-ticket', 'quiz-ticket');

    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));
    expect(eventSourceUrls).toContain('/api/quiz-events?ticket=quiz-ticket');

    act(() => {
      result.current.selectRadioOption('slide-1', 'A');
      result.current.submitAnswer('slide-1');
    });
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/quiz-answer');
    expect((request?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer audience-credential');
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

  it('purga respuestas y usa contribuciones no enlazables al salir', () => {
    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));

    act(() => {
      result.current.selectRadioOption('slide-1', 'A');
      result.current.submitAnswer('slide-1');
    });
    const firstRequest = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/quiz-answer');
    const firstPayload = JSON.parse(String((firstRequest?.[1] as RequestInit).body));
    expect(firstPayload).not.toHaveProperty('displayName');
    expect(firstPayload).not.toHaveProperty('sessionId');

    act(() => window.dispatchEvent(new CustomEvent('sefer-audience-logout')));
    expect(result.current.getAnswers()).toEqual({});
    expect(result.current.getScores()).toEqual({});

    act(() => {
      result.current.selectRadioOption('slide-2', 'B');
      result.current.submitAnswer('slide-2');
    });
    const requests = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/quiz-answer');
    const rotatedPayload = JSON.parse(String((requests.at(-1)?.[1] as RequestInit).body));
    expect(rotatedPayload.submissionId).not.toBe(firstPayload.submissionId);
  });
});

describe('useQuizAnswers - Control', () => {
  beforeEach(() => {
    eventSourceUrls.length = 0;
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue({ json: () => Promise.resolve({}) } as Response);
  });

  it('recupera del servidor solo agregados al reconectar Control', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({
        type: 'QUIZ_AGGREGATE_SNAPSHOT',
        presentationId: 'presentation-1',
        aggregate: {
          slides: {
            q1: {
              submittedCount: 3,
              optionCounts: { A: 2, B: 1 },
              citaHits: 0,
              citaMisses: 0,
            },
          },
          submittedAnswersBySlideId: { q1: 3 },
          finalScoreRanges: {},
          totalFinalScores: 0,
          minimumGroupSize: 3,
          finalScoreRequestId: null,
          updatedAt: 1234,
        },
      }),
    } as Response);

    const { result } = renderHook(() => useControllerAnswers('presentation-1'));

    expect(eventSourceUrls).toContain('/api/quiz-control-events');

    await waitFor(() => expect(result.current.getSubmittedCount('q1')).toBe(3));
    expect(result.current.getSlideAggregate('q1').optionCounts).toEqual({ A: 2, B: 1 });

    act(() => result.current.clearSlideAnswers('q1'));
    expect(result.current.getSubmittedCount('q1')).toBe(0);
  });

  it('muestra rangos ya agregados sin identificadores de sesion', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({
        type: 'QUIZ_AGGREGATE_SNAPSHOT',
        presentationId: 'presentation-1',
        aggregate: {
          slides: {}, submittedAnswersBySlideId: {},
          finalScoreRanges: { 1: 2, 2: 1 }, totalFinalScores: 3,
          minimumGroupSize: 3,
          finalScoreRequestId: 1, updatedAt: 1234,
        },
      }),
    } as Response);
    const { result } = renderHook(() => useControllerAnswers('presentation-1'));
    const profiles = [
      { rank: 1, title: 'Alto', description: '', giftText: '' },
      { rank: 2, title: 'Bajo', description: '', giftText: '' },
    ];

    await waitFor(() => expect(result.current.totalParticipants).toBe(3));
    const stats = result.current.calcRangeStats(profiles);

    expect(stats).toEqual([
      { rank: 1, title: 'Alto', count: 2 },
      { rank: 2, title: 'Bajo', count: 1 },
    ]);
  });
});
