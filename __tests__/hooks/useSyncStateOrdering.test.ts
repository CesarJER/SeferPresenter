// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSyncState } from '../../src/hooks/useSyncState';
import { DEFAULT_AUDIO_STATE } from '../../src/types/audio';
vi.mock('../../src/hooks/useWebSocket', () => ({ useWebSocket: () => ({ status: 'closed', sendMessage: () => false }) }));
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it('rejects delayed GET and BroadcastChannel rollback after a newer server revision', async () => {
  let resolveSnapshot: (response: unknown) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveSnapshot = resolve; })));
  const streams: FakeEventSource[] = [];
  class FakeEventSource {
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { streams.push(this); }
    close() {}
  }
  const channels: FakeChannel[] = [];
  class FakeChannel {
    listener: ((event: { data: unknown }) => void) | undefined;
    constructor() { channels.push(this); }
    addEventListener(_type: string, handler: (event: { data: unknown }) => void) { this.listener = handler; }
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
    stateEpoch: 'server-epoch', stateRevision: timestamp,
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
  expect(updates).toEqual([1]);
  act(() => channels[0].listener?.({ data: state(0, 150, 'old-bc') }));
  expect(updates).toEqual([1]);
  act(() => channels[0].listener?.({ data: { ...state(0, 300, 'unversioned'), stateEpoch: undefined, stateRevision: undefined } }));
  expect(updates).toEqual([1]);
  act(() => streams[0].onmessage?.({ data: JSON.stringify({ ...state(0, 1, 'restart'), stateEpoch: 'restarted-server' }) }));
  expect(updates).toEqual([1, 0]);
  act(() => streams[0].onmessage?.({ data: JSON.stringify(state(1, 999, 'retired-epoch')) }));
  expect(updates).toEqual([1, 0]);
  // A backend revision remains authoritative even if telemetry kept the snapshot's message ID.
  act(() => streams[0].onmessage?.({ data: JSON.stringify({ ...state(1, 2, 'restart'), stateEpoch: 'restarted-server' }) }));
  expect(updates).toEqual([1, 0, 1]);
  act(() => streams[0].onmessage?.({ data: JSON.stringify({ ...state(0, 1, 'restart'), stateEpoch: 'restarted-server' }) }));
  expect(updates).toEqual([1, 0, 1]);
  expect(JSON.parse(localStorage.getItem('sefer-presenter-state')!).slideIndex).toBe(1);
});
