// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudienceSession } from '../../src/hooks/useAudienceSession';

describe('useAudienceSession', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('mantiene el alias solo en memoria durante la página activa', () => {
    localStorage.setItem('sefer-audience-nick', 'Alias heredado');
    localStorage.setItem('sefer-audience-device-id', 'device-heredado');
    localStorage.setItem('sefer-audience-alias-visible', 'true');
    const { result, unmount } = renderHook(() => useAudienceSession({}));

    expect(result.current.nick).toBe('');
    expect(localStorage.getItem('sefer-audience-nick')).toBeNull();
    expect(localStorage.getItem('sefer-audience-device-id')).toBeNull();
    expect(localStorage.getItem('sefer-audience-alias-visible')).toBeNull();

    act(() => {
      result.current.login('TestUser');
      result.current.setAliasVisible(true);
    });

    expect(result.current.nick).toBe('TestUser');
    expect(result.current.aliasVisible).toBe(true);
    expect(localStorage.getItem('sefer-audience-nick')).toBeNull();
    expect(localStorage.getItem('sefer-audience-alias-visible')).toBeNull();

    unmount();
    const remounted = renderHook(() => useAudienceSession({}));
    expect(remounted.result.current.nick).toBe('');
  });

  it('purga y rota la identidad técnica al salir', () => {
    localStorage.setItem('sefer-audience-session-id', 'session-old');
    localStorage.setItem('sefer-quiz-session-id', 'quiz-old');
    const onLogout = vi.fn();
    window.addEventListener('sefer-audience-logout', onLogout);
    const { result } = renderHook(() => useAudienceSession({}));
    const initialDeviceId = result.current.deviceId;

    act(() => {
      result.current.login('TestUser');
      result.current.logout();
    });

    expect(result.current.nick).toBe('');
    expect(result.current.deviceId).not.toBe(initialDeviceId);
    expect(result.current.presentationSessionId).toBeNull();
    expect(localStorage.getItem('sefer-audience-session-id')).toBeNull();
    expect(localStorage.getItem('sefer-quiz-session-id')).toBeNull();
    expect(onLogout).toHaveBeenCalledOnce();
    window.removeEventListener('sefer-audience-logout', onLogout);
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
    const initialDeviceId = result.current.deviceId;

    act(() => {
      result.current.login('TestUser');
      wsHandler?.('PRESENTATION_SESSION_ROTATED', { presentationSessionId: 'session-new' });
    });

    expect(result.current.nick).toBe('');
    expect(result.current.deviceId).not.toBe(initialDeviceId);
    expect(result.current.presentationSessionId).toBe('session-new');
    expect(JSON.parse(localStorage.getItem('sefer-audience-session-id') || '{}').data).toBe('session-new');
    expect(localStorage.getItem('sefer-quiz-session-id')).toBeNull();
  });
});
