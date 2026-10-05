// @vitest-environment jsdom
// These assertions reproduce defects in current code; passing is evidence, not remediation.
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAudienceSession } from '../../../src/hooks/useAudienceSession';
import { useSyncState } from '../../../src/hooks/useSyncState';
import { DEFAULT_AUDIO_STATE } from '../../../src/types/audio';
import { writeExpiringStorage } from '../../../src/utils/privacyStorage';

vi.mock('../../../src/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ status: 'closed', sendMessage: () => false }),
}));

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it('retains a persisted alias after the session envelope has expired and a new session welcomes it', () => {
  localStorage.setItem('sefer-audience-nick', 'Synthetic Alias');
  writeExpiringStorage(localStorage, 'sefer-audience-session-id', 'old-session', 0);
  let receive: (type: string, payload: Record<string, unknown>) => void = () => {};
  const subscribe = (handler: typeof receive) => { receive = handler; return () => {}; };
  const { result } = renderHook(() => useAudienceSession({ subscribeToWsMessage: subscribe }));
  act(() => receive('WELCOME', { presentationSessionId: 'new-session' }));
  expect(result.current.presentationSessionId).toBe('new-session');
  expect(result.current.nick).toBe('Synthetic Alias');
  expect(result.current.isLoggedIn).toBe(true);
  expect(localStorage.getItem('sefer-audience-nick')).toBe('Synthetic Alias');
});

it('applies a delayed old GET snapshot after a newer SSE state and persists the rollback', async () => {
  let resolveSnapshot: (response: unknown) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveSnapshot = resolve; })));
  const streams: FakeEventSource[] = [];
  class FakeEventSource {
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { streams.push(this); }
    close() {}
  }
  class FakeChannel {
    addEventListener() {}
    removeEventListener() {}
    postMessage() {}
  }
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  const ref = <T,>(current: T) => ({ current });
  const slide = ref(-1);
  const updates: number[] = [];
  const noOp = () => {};
  renderHook(() => useSyncState({
    isControlMode: true, isPresenterMode: false,
    clientIdRef: ref('audit-client'), currentPresentationRef: ref(null),
    currentSlideIndexRef: slide, currentStepIndexRef: ref(0),
    backgroundLockRef: ref(false), lockedBackgroundValueRef: ref(null),
    userSelectedBackgroundRef: ref(null), videoStateRef: ref(null),
    audioStateRef: ref(DEFAULT_AUDIO_STATE), appModeRef: ref('slides'),
    scriptureStateRef: ref(null), autoduckStateRef: ref({ isDucking: false, fadeFactor: 1 }),
    setCurrentPresentation: noOp, setCurrentSlideIndex: value => { slide.current = value; updates.push(value); },
    setCurrentStepIndex: noOp, setBackgroundLock: noOp, setLockedBackgroundValue: noOp,
    setUserSelectedBackground: noOp, setVideoState: noOp, setAppMode: noOp,
    setScriptureState: noOp, setAudioState: noOp, setAudioSyncMaps: noOp, setAutoduckState: noOp,
  }));
  const state = (slideIndex: number, timestamp: number, messageId: string) => ({
    type: 'SYNC_STATE', clientId: 'backend', origin: 'control', protocolVersion: 1,
    messageId, timestamp, presentation: {
      id: 'audit-p', title: 'Synthetic presentation', mode: 'trilingual', background: '', tags: [],
      slides: [
        { id: 'audit-s0', label: 'First', lines: ['One', 'Two', 'Three'] },
        { id: 'audit-s1', label: 'Second', lines: ['Four', 'Five', 'Six'] },
      ],
    }, slideIndex, backgroundLock: false,
    lockedBackgroundValue: null, userSelectedBackground: null, videoState: null,
    appMode: 'slides', scriptureState: null, audioState: DEFAULT_AUDIO_STATE,
  });
  act(() => streams[0].onmessage?.({ data: JSON.stringify(state(1, 200, 'new-state')) }));
  expect(slide.current).toBe(1);
  await act(async () => {
    resolveSnapshot({ ok: true, json: async () => state(0, 100, 'old-state') });
    await Promise.resolve();
  });
  expect(updates).toEqual([1, 0]);
  expect(JSON.parse(localStorage.getItem('sefer-presenter-state')!).slideIndex).toBe(0);
});
