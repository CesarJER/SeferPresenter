// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudienceSession } from '../../src/hooks/useAudienceSession';

describe('useAudienceSession', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('nick persiste en localStorage y se borra solo al pulsar Salir o fin de sesion', () => {
    const { result, rerender } = renderHook(() => useAudienceSession({}));

    // Initially nick is empty
    expect(result.current.nick).toBe('');

    // Set nick
    act(() => {
      result.current.login('TestUser');
    });

    expect(result.current.nick).toBe('TestUser');
    expect(localStorage.getItem('sefer-audience-nick')).toBe('TestUser');

    // Rerender should keep nick
    rerender();
    expect(result.current.nick).toBe('TestUser');

    // Clear nick
    act(() => {
      result.current.logout();
    });

    expect(result.current.nick).toBe('');
    expect(localStorage.getItem('sefer-audience-nick')).toBeNull();
  });
});
