// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudienceAccess } from '../../src/hooks/useAudienceAccess';

describe('useAudienceAccess credential identity', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('recovers the same participantId from the persisted credential', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const credential = JSON.parse(String(init?.body || '{}')).credential;
      return {
        ok: true,
        json: async () => ({
          presentationSessionId: 'session-a',
          credential: credential ? undefined : 'credential-a',
          participantId: 'participant-a',
          accessMode: 'CONTROLLED',
          accessState: 'WAITING',
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = renderHook(() => useAudienceAccess());
    await waitFor(() => expect(first.result.current.participantId).toBe('participant-a'));
    first.unmount();

    const second = renderHook(() => useAudienceAccess());
    await waitFor(() => expect(second.result.current.participantId).toBe('participant-a'));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ credential: 'credential-a' });
    expect(JSON.parse(String(localStorage.getItem('sefer-audience-access')))).toEqual({
      presentationSessionId: 'session-a',
      credential: 'credential-a',
    });
  });

  it('drops the old credential when the presentation session rotates', async () => {
    let bootstrapCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      bootstrapCount += 1;
      return {
        ok: true,
        json: async () => ({
          presentationSessionId: bootstrapCount === 1 ? 'session-a' : 'session-b',
          credential: bootstrapCount === 1 ? 'credential-a' : 'credential-b',
          participantId: bootstrapCount === 1 ? 'participant-a' : 'participant-b',
          accessMode: 'CONTROLLED',
          accessState: 'REQUEST_REQUIRED',
        }),
      } as Response;
    }));

    const hook = renderHook(() => useAudienceAccess());
    await waitFor(() => expect(hook.result.current.participantId).toBe('participant-a'));
    act(() => hook.result.current.handleWsMessage('PRESENTATION_SESSION_ROTATED', {}));
    await waitFor(() => expect(hook.result.current.participantId).toBe('participant-b'));
    expect(hook.result.current.credential).toBe('credential-b');
  });
});
