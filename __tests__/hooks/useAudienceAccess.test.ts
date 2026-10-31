// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAudienceAccess } from '../../src/hooks/useAudienceAccess';
import { createElement, StrictMode, type ReactNode } from 'react';

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

  it('invalidates the previous generation on a changed WELCOME even when the rotation event was missed', async () => {
    let count = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      presentationSessionId: ++count === 1 ? 'session-a' : 'session-b',
      credential: count === 1 ? 'credential-a' : 'credential-b', participantId: 'participant-' + count,
      accessMode: 'PUBLIC', accessState: 'ADMITTED',
    }) } as Response)));
    const hook = renderHook(() => useAudienceAccess());
    await waitFor(() => expect(hook.result.current.credential).toBe('credential-a'));
    act(() => hook.result.current.handleWsMessage('WELCOME', { presentationSessionId: 'session-b' }));
    await waitFor(() => expect(hook.result.current.credential).toBe('credential-b'));
    expect(hook.result.current.presentationSessionId).toBe('session-b');
  });

  it('distinguishes bootstrap from bind and rejects mismatched sessions or participant IDs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      presentationSessionId: 'session-a', credential: 'credential-a', participantId: 'participant-a',
      accessMode: 'CONTROLLED', accessState: 'WAITING',
    }) } as Response)));
    const hook = renderHook(() => useAudienceAccess());
    await waitFor(() => expect(hook.result.current.credential).toBe('credential-a'));
    expect(hook.result.current.isCurrentWsBinding()).toBe(false);
    act(() => {
      hook.result.current.handleWsConnectionChange('open');
      hook.result.current.handleWsMessage('AUDIENCE_ACCESS_STATE', {
        presentationSessionId: 'wrong-session', participantId: 'participant-a', accessState: 'WAITING',
      });
    });
    expect(hook.result.current.isCurrentWsBinding()).toBe(false);
    act(() => hook.result.current.handleWsMessage('AUDIENCE_ACCESS_STATE', {
      presentationSessionId: 'session-a', participantId: 'copied-id', accessState: 'WAITING',
    }));
    expect(hook.result.current.isCurrentWsBinding()).toBe(false);
    act(() => hook.result.current.handleWsMessage('AUDIENCE_ACCESS_STATE', {
      presentationSessionId: 'session-a', participantId: 'participant-a', accessState: 'WAITING',
    }));
    expect(hook.result.current.isCurrentWsBinding()).toBe(true);
    const epoch = hook.result.current.getWsBindingEpoch();
    act(() => hook.result.current.handleWsConnectionChange('closed'));
    expect(hook.result.current.isCurrentWsBinding()).toBe(false);
    expect(hook.result.current.getWsBindingEpoch()).not.toBe(epoch);
  });

  it('coalesces the bootstrap through StrictMode and ignores results after real unmount', async () => {
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(() => useAudienceAccess(), { wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hook.unmount();
    await act(async () => resolve({ ok: true, json: async () => ({
      presentationSessionId: 'late-session', credential: 'late-secret', participantId: 'late-participant',
      accessMode: 'PUBLIC', accessState: 'ADMITTED',
    }) } as Response));
    expect(localStorage.getItem('sefer-audience-access')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not restore late SSE tickets after admission has been revoked', async () => {
    let resolveTickets!: (value: Response) => void;
    const tickets = new Promise<Response>(done => { resolveTickets = done; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('sse-ticket') ? tickets : ({
      ok: true, json: async () => ({ presentationSessionId: 'session-a', credential: 'credential-a',
        participantId: 'participant-a', accessMode: 'CONTROLLED', accessState: 'ADMITTED' }),
    } as Response)));
    const hook = renderHook(() => useAudienceAccess());
    await waitFor(() => expect(hook.result.current.authorized).toBe(true));
    act(() => {
      hook.result.current.handleWsConnectionChange('open');
      hook.result.current.handleWsMessage('AUDIENCE_ACCESS_STATE', {
        presentationSessionId: 'session-a', participantId: 'participant-a', accessState: 'WAITING',
      });
    });
    await act(async () => resolveTickets({ ok: true, json: async () => ({ ticket: 'late-ticket' }) } as Response));
    expect(hook.result.current.authorized).toBe(false);
    expect(hook.result.current.stateSseTicket).toBeNull();
    expect(hook.result.current.quizSseTicket).toBeNull();
    expect(sessionStorage.getItem('sefer-audience-quiz-sse-ticket')).toBeNull();
  });

  it('does not let an old bootstrap overwrite a replacement credential', async () => {
    let resolveOld!: (value: Response) => void;
    const old = new Promise<Response>(done => { resolveOld = done; });
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ++calls === 1 ? old : ({ ok: true, json: async () => ({
      presentationSessionId: 'new-session', credential: 'new-credential', participantId: 'new-participant',
      accessMode: 'CONTROLLED', accessState: 'WAITING',
    }) } as Response)));
    const hook = renderHook(() => useAudienceAccess());
    act(() => hook.result.current.handleWsMessage('PRESENTATION_SESSION_ROTATED', {}));
    await waitFor(() => expect(hook.result.current.credential).toBe('new-credential'));
    await act(async () => resolveOld({ ok: true, json: async () => ({
      presentationSessionId: 'old-session', credential: 'old-credential', participantId: 'old-participant',
      accessMode: 'PUBLIC', accessState: 'ADMITTED',
    }) } as Response));
    expect(hook.result.current.credential).toBe('new-credential');
    expect(JSON.parse(localStorage.getItem('sefer-audience-access')!).credential).toBe('new-credential');
  });
});
