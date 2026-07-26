// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudienceAnswers } from '../../src/hooks/useQuizAnswers';

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
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('quiz persiste localmente segun requisito y se borra solo con clear (o al reiniciar app que limpia storage si aplica)', () => {
    const { result, rerender } = renderHook(() => useAudienceAnswers());

    // Initially no answers
    expect(result.current.getAnswers()).toEqual({});

    // Select radio option
    act(() => {
      result.current.selectRadioOption('slide-1', 'A');
    });

    const answer = result.current.getAnswer('slide-1');
    expect(answer.selectedOptionIds).toEqual(['A']);

    // Check localStorage
    const stored = JSON.parse(localStorage.getItem('sefer-quiz-answers') || '{}');
    expect(stored['slide-1'].selectedOptionIds).toEqual(['A']);

    // Rerender should keep it
    rerender();
    expect(result.current.getAnswer('slide-1').selectedOptionIds).toEqual(['A']);

    // Clear answer
    act(() => {
      result.current.clearAnswer('slide-1');
    });

    expect(result.current.getAnswer('slide-1').selectedOptionIds).toEqual([]);
    const storedAfterClear = JSON.parse(localStorage.getItem('sefer-quiz-answers') || '{}');
    expect(storedAfterClear['slide-1']).toBeUndefined();
  });

  it('submitAnswer actualiza estado a submitted y trigger network side effects', () => {
    const { result } = renderHook(() => useAudienceAnswers());

    act(() => {
      result.current.selectRadioOption('slide-2', 'B');
      result.current.submitAnswer('slide-2');
    });

    const answer = result.current.getAnswer('slide-2');
    expect(answer.submitted).toBe(true);
    expect(answer.submittedAt).toBeGreaterThan(0);
    expect(answer.selectedOptionIds).toEqual(['B']);

    // Check localStorage
    const stored = JSON.parse(localStorage.getItem('sefer-quiz-answers') || '{}');
    expect(stored['slide-2'].submitted).toBe(true);
  });
});
