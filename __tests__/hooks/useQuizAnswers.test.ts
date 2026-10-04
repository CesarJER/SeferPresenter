// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
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
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor(url: string | URL) {
      eventSourceUrls.push(String(url));
      eventSources.push(this);
    }
    close() {}
  }
});
vi.stubGlobal('fetch', vi.fn());

const eventSourceUrls: string[] = [];
const eventSources: { onopen: (() => void) | null; onmessage: ((event: { data: string }) => void) | null }[] = [];
const response = (status = 200, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
const payloads = () => vi.mocked(fetch).mock.calls
  .filter(([url]) => url === '/api/quiz-answer')
  .map(([, request]) => JSON.parse(String(request?.body)));
const score = { slideId: 'slide-1', optionCentipunts: 50, citaCentipunts: 50, bonusCentipunts: 0, totalCentipunts: 100 };
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useQuizAnswers - Audience', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    eventSourceUrls.length = 0;
    eventSources.length = 0;
    vi.mocked(fetch).mockReset().mockResolvedValue(response());
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

  it('purga respuestas y usa contribuciones no enlazables al salir', async () => {
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
    await waitFor(() => expect(payloads()).toHaveLength(2));
    const requests = vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/quiz-answer');
    const rotatedPayload = JSON.parse(String((requests.at(-1)?.[1] as RequestInit).body));
    expect(rotatedPayload.submissionId).not.toBe(firstPayload.submissionId);
  });

  it('reintenta un 503 con el mismo ID sin perder la respuesta local', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(response(503));
    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));
    await act(async () => {
      result.current.selectRadioOption('slide-1', 'A');
      result.current.submitAnswer('slide-1');
    });
    expect(payloads()).toHaveLength(1);
    expect(result.current.getAnswer('slide-1').submitted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(payloads()).toHaveLength(2);
    expect(payloads()[1]).toEqual(payloads()[0]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(payloads()).toHaveLength(2);
  });

  it('recupera respuestas, resultados y rango tras remontaje y SSE sin duplicar IDs', async () => {
    const deduplicated = new Set<string>();
    vi.mocked(fetch).mockImplementation(async (_url, request) => {
      deduplicated.add(JSON.parse(String(request?.body)).submissionId);
      return response();
    });
    const first = renderHook(() => useAudienceAnswers('presentation-1'));
    await act(async () => {
      first.result.current.selectRadioOption('slide-1', 'B');
      first.result.current.submitAnswer('slide-1');
      first.result.current.saveScore('slide-1', score);
      first.result.current.sendFinalScore(2, 123);
    });
    await waitFor(() => expect(payloads()).toHaveLength(3));
    const original = payloads();
    expect(new Set(original.map(message => message.submissionId)).size).toBe(3);
    const stored = JSON.parse(localStorage.getItem('sefer-quiz-outbox')!).data;
    expect(Object.values(stored).map(entry => (entry as { message: unknown }).message)).toEqual(original);
    expect(JSON.stringify(stored)).not.toMatch(/credential|displayName|sessionId|citaBook/);
    first.unmount();

    const second = renderHook(() => useAudienceAnswers('presentation-1'));
    await waitFor(() => expect(payloads()).toHaveLength(6));
    expect(second.result.current.getAnswer('slide-1').submitted).toBe(true);
    expect(second.result.current.getScores()['slide-1']).toEqual(score);
    expect(payloads().slice(3)).toEqual(original);
    await act(async () => { eventSources.at(-1)?.onopen?.(); });
    await waitFor(() => expect(payloads()).toHaveLength(9));
    expect(payloads().slice(6)).toEqual(original);
    expect(deduplicated.size).toBe(3);
  });

  it('reintenta solo el 409 de presentación todavía no activa y limita fallos de red', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(409, { error: 'Quiz message does not match the active presentation' }))
      .mockRejectedValue(new TypeError('Network unavailable'));
    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));
    await act(async () => { result.current.saveScore('slide-1', score); });
    for (const delay of [1000, 3000, 10000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
    }
    expect(payloads()).toHaveLength(4);
    expect(new Set(payloads().map(message => message.submissionId)).size).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(payloads()).toHaveLength(4);
    vi.mocked(fetch).mockResolvedValue(response());
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(payloads()).toHaveLength(5);
    expect(payloads()[4]).toEqual(payloads()[0]);
  });

  it('espera la renovación del acceso tras un 401 o 403', async () => {
    vi.useFakeTimers();
    localStorage.setItem('sefer-audience-access', JSON.stringify({ credential: 'old-credential' }));
    sessionStorage.setItem('sefer-audience-quiz-sse-ticket', 'old-ticket');
    vi.mocked(fetch).mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(403));
    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));
    await act(async () => { result.current.sendFinalScore(2, 123); });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(payloads()).toHaveLength(1);
    localStorage.setItem('sefer-audience-access', JSON.stringify({ credential: 'new-credential' }));
    sessionStorage.setItem('sefer-audience-quiz-sse-ticket', 'new-ticket');
    await act(async () => { window.dispatchEvent(new Event('sefer-audience-tickets-updated')); });
    expect(payloads()).toHaveLength(2);
    expect(payloads()[1]).toEqual(payloads()[0]);
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer new-credential' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(payloads()).toHaveLength(2);
    await act(async () => { eventSources.at(-1)?.onopen?.(); });
    expect(payloads()).toHaveLength(3);
    expect(payloads()[2]).toEqual(payloads()[0]);
  });

  it('conserva solo la solicitud final más reciente y reutiliza su ID', async () => {
    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));
    await act(async () => { result.current.sendFinalScore(1, 100); });
    await act(async () => { result.current.sendFinalScore(2, 200); });
    await act(async () => {
      result.current.sendFinalScore(2, 200);
      result.current.sendFinalScore(1, 100);
    });
    expect(payloads()).toHaveLength(2);
    expect(payloads()[0].submissionId).not.toBe(payloads()[1].submissionId);
    await act(async () => { eventSources.at(-1)?.onopen?.(); });
    expect(payloads()).toHaveLength(3);
    expect(payloads()[2]).toEqual(payloads()[1]);
  });

  it('reenvía solo el alcance activo al cambiar de presentación', async () => {
    const { result, rerender } = renderHook(
      ({ presentationId }) => useAudienceAnswers(presentationId),
      { initialProps: { presentationId: 'presentation-1' } },
    );
    await act(async () => { result.current.submitAnswer('shared-slide'); });
    rerender({ presentationId: 'presentation-2' });
    await act(async () => { result.current.submitAnswer('shared-slide'); });
    const original = payloads();
    expect(original).toHaveLength(2);
    expect(original[0].submissionId).not.toBe(original[1].submissionId);
    await act(async () => { eventSources.at(-1)?.onopen?.(); });
    expect(payloads().slice(2)).toEqual([original[1]]);
    rerender({ presentationId: 'presentation-1' });
    await act(async () => { eventSources.at(-1)?.onopen?.(); });
    const resumed = payloads().slice(3);
    expect(resumed.length).toBeGreaterThan(0);
    expect(resumed.every(message => JSON.stringify(message) === JSON.stringify(original[0]))).toBe(true);
  });

  it.each(['local', 'controller', 'logout'])('borra la cola y cancela reintentos al limpiar por %s', async clear => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(response(503));
    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));
    await act(async () => {
      result.current.submitAnswer('slide-1');
      result.current.saveScore('slide-1', score);
      result.current.sendFinalScore(2, 123);
    });
    const callsBeforeClear = payloads().length;
    await act(async () => {
      if (clear === 'local') result.current.clearAnswer('slide-1');
      else if (clear === 'logout') window.dispatchEvent(new Event('sefer-audience-logout'));
      else eventSources.at(-1)?.onmessage?.({ data: JSON.stringify({ type: 'QUIZ_CLEAR_ANSWERS', presentationId: 'presentation-1', slideId: 'slide-1' }) });
    });
    expect(localStorage.getItem('sefer-quiz-outbox')).toBeNull();
    expect(result.current.getScores()).toEqual({});
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      eventSources.at(-1)?.onopen?.();
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(payloads()).toHaveLength(callsBeforeClear);
  });

  it('el reenvío no renueva la caducidad de 24 horas de cada contribución', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const { result } = renderHook(() => useAudienceAnswers('presentation-1'));
    await act(async () => { result.current.sendFinalScore(2, 123); });
    const originalId = payloads()[0].submissionId;
    vi.setSystemTime(started + 23 * 60 * 60 * 1000);
    await act(async () => { eventSources.at(-1)?.onopen?.(); });
    expect(payloads()[1].submissionId).toBe(originalId);
    vi.setSystemTime(started + 24 * 60 * 60 * 1000 + 1);
    await act(async () => { eventSources.at(-1)?.onopen?.(); });
    expect(payloads()).toHaveLength(2);
    expect(localStorage.getItem('sefer-quiz-outbox')).toBeNull();
  });
});

describe('useQuizAnswers - Control', () => {
  beforeEach(() => {
    eventSourceUrls.length = 0;
    eventSources.length = 0;
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue(response());
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
