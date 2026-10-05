// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { AUDIENCE_PRIVACY_STORAGE_TTL_MS, writeExpiringStorage } from '../../src/utils/privacyStorage';
import { useAudienceSession } from '../../src/hooks/useAudienceSession';

describe('useAudienceSession', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('recupera y persiste el alias durante la sesión local', () => {
    localStorage.setItem('sefer-audience-nick', 'Alias heredado');
    localStorage.setItem('sefer-audience-alias-visible', 'true');
    const { result, unmount } = renderHook(() => useAudienceSession({}));

    expect(result.current.nick).toBe('');
    expect(result.current.aliasVisible).toBe(false);

    act(() => {
      result.current.login('TestUser');
      result.current.setAliasVisible(true);
    });

    expect(result.current.nick).toBe('TestUser');
    expect(result.current.aliasVisible).toBe(true);
    expect(JSON.parse(localStorage.getItem('sefer-audience-identity')!).data.nick).toBe('TestUser');
    expect(JSON.parse(localStorage.getItem('sefer-audience-identity')!).data.aliasVisible).toBe(true);

    unmount();
    const remounted = renderHook(() => useAudienceSession({}));
    expect(remounted.result.current.nick).toBe('TestUser');
    expect(remounted.result.current.aliasVisible).toBe(true);
  });

  it('purga y rota la identidad técnica al salir', () => {
    localStorage.setItem('sefer-audience-session-id', 'session-old');
    localStorage.setItem('sefer-quiz-session-id', 'quiz-old');
    const onLogout = vi.fn();
    window.addEventListener('sefer-audience-logout', onLogout);
    const { result } = renderHook(() => useAudienceSession({}));

    act(() => {
      result.current.login('TestUser');
      result.current.logout();
    });

    expect(result.current.nick).toBe('');
    expect(result.current.presentationSessionId).toBeNull();
    expect(localStorage.getItem('sefer-audience-session-id')).toBeNull();
    expect(localStorage.getItem('sefer-quiz-session-id')).toBeNull();
    expect(onLogout).toHaveBeenCalledOnce();
    window.removeEventListener('sefer-audience-logout', onLogout);
  });

  it('does not inherit an alias after its session reference expires and reconciles logout in another instance', () => {
    localStorage.setItem('sefer-audience-session-id', JSON.stringify({ version: 1, expiresAt: Date.now() - 1, data: 'old' }));
    localStorage.setItem('sefer-audience-identity', JSON.stringify({ version: 1, expiresAt: Date.now() + 10000,
      data: { nick: 'Old alias', aliasVisible: true, sessionId: 'old' } }));
    const first = renderHook(() => useAudienceSession());
    const second = renderHook(() => useAudienceSession());
    expect(first.result.current.isLoggedIn).toBe(false);
    act(() => first.result.current.login('New alias'));
    expect(second.result.current.nick).toBe('New alias');
    act(() => first.result.current.logout());
    expect(second.result.current.isLoggedIn).toBe(false);
    first.unmount(); second.unmount();
  });

  it('expires a mounted identity at the session boundary and emits logout without reconnect renewal', () => {
    vi.useFakeTimers();
    let handler: ((type: string, payload: Record<string, unknown>) => void) | undefined;
    writeExpiringStorage(localStorage, 'sefer-audience-session-id', 'same-session', Date.now() - AUDIENCE_PRIVACY_STORAGE_TTL_MS + 1000);
    const { result, unmount } = renderHook(() => useAudienceSession({ subscribeToWsMessage: next => { handler = next; return () => {}; } }));
    const onLogout = vi.fn();
    window.addEventListener('sefer-audience-logout', onLogout);
    act(() => result.current.login('Bounded alias'));
    const expiry = JSON.parse(localStorage.getItem('sefer-audience-session-id')!).expiresAt;
    act(() => { vi.advanceTimersByTime(500); handler?.('WELCOME', { presentationSessionId: 'same-session' }); });
    expect(JSON.parse(localStorage.getItem('sefer-audience-session-id')!).expiresAt).toBe(expiry);
    act(() => vi.advanceTimersByTime(501));
    expect(result.current.isLoggedIn).toBe(false);
    expect(onLogout).toHaveBeenCalledOnce();
    expect(localStorage.getItem('sefer-audience-identity')).toBeNull();
    window.removeEventListener('sefer-audience-logout', onLogout);
    unmount(); vi.useRealTimers();
  });

  it('purga la identidad anterior antes de adoptar una sesión rotada', () => {
    let wsHandler: ((type: string, payload: Record<string, unknown>) => void) | undefined;
    const subscribeToWsMessage = vi.fn((handler: NonNullable<typeof wsHandler>) => {
      wsHandler = handler;
      return vi.fn();
    });
    localStorage.setItem('sefer-audience-session-id', 'session-old');
    localStorage.setItem('sefer-quiz-session-id', 'quiz-old');
    const { result } = renderHook(() => useAudienceSession({ subscribeToWsMessage }));

    act(() => {
      result.current.login('TestUser');
      wsHandler?.('PRESENTATION_SESSION_ROTATED', { presentationSessionId: 'session-new' });
    });

    expect(result.current.nick).toBe('');
    expect(result.current.presentationSessionId).toBe('session-new');
    expect(JSON.parse(localStorage.getItem('sefer-audience-session-id') || '{}').data).toBe('session-new');
    expect(localStorage.getItem('sefer-quiz-session-id')).toBeNull();
  });

  it('purges an offline audience on WELCOME after an explicit session reset', () => {
    let wsHandler: ((type: string, payload: Record<string, unknown>) => void) | undefined;
    const subscribeToWsMessage = (handler: NonNullable<typeof wsHandler>) => { wsHandler = handler; return vi.fn(); };
    const { result } = renderHook(() => useAudienceSession({ subscribeToWsMessage }));
    act(() => {
      wsHandler?.('WELCOME', { presentationSessionId: 'before-reset' });
      result.current.login('TestUser');
    });
    localStorage.setItem('sefer-quiz-session-id', 'prior-quiz');
    act(() => { wsHandler?.('WELCOME', { presentationSessionId: 'after-reset' }); });
    expect(result.current.nick).toBe('');
    expect(result.current.presentationSessionId).toBe('after-reset');
    expect(localStorage.getItem('sefer-quiz-session-id')).toBeNull();
  });
});
