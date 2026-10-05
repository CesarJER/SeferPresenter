import React, { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useAudienceSession } from '../../../../../src/hooks/useAudienceSession';
import { useSyncState } from '../../../../../src/hooks/useSyncState';
import { DEFAULT_AUDIO_STATE } from '../../../../../src/types/audio';
import { writeExpiringStorage } from '../../../../../src/utils/privacyStorage';

const capture = vi.hoisted(() => ({ props: null as any, roots: [] as any[], element: null as any }));
vi.mock('../../../../../src/hooks/useWebSocket', () => ({ useWebSocket: () => ({ status: 'closed', sendMessage: () => false }) }));
vi.mock('../../../../../src/components/AudioSyncEditor', () => ({ AudioSyncEditor: (props: any) => {
  capture.props = props;
  return <output data-testid="maps">{props.audioSyncMaps.map((m: any) => m.name).join(',')}</output>;
} }));
vi.mock('react-dom/client', async (original) => {
  const actual: any = await original();
  return { ...actual, createRoot: (...args: any[]) => {
    const root = actual.createRoot(...args);
    capture.roots.push(root);
    const realRender = root.render.bind(root);
    root.render = (element: any) => { capture.element = element; return realRender(element); };
    return root;
  } };
});

afterEach(() => {
  cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  document.body.innerHTML = ''; capture.roots = [];
});

const snapshot = (slideIndex: number, timestamp: number, messageId: string) => ({
  type: 'SYNC_STATE', clientId: 'backend', origin: 'control', protocolVersion: 1, messageId, timestamp,
  presentation: { id: 'p', title: 'Synthetic', mode: 'trilingual', background: '', tags: [], slides: [
    { id: 's0', label: 'First', lines: ['One', 'Two', 'Three'] }, { id: 's1', label: 'Second', lines: ['Four', 'Five', 'Six'] },
  ] }, slideIndex, backgroundLock: false, lockedBackgroundValue: null, userSelectedBackground: null,
  videoState: null, appMode: 'slides', scriptureState: null, audioState: DEFAULT_AUDIO_STATE,
});

function useCell(initial: any) {
  const [state, setState] = useState(initial);
  const ref = useRef(state); ref.current = state;
  return [state, setState, ref] as const;
}
function Projection() {
  const [presentation, setPresentation, presentationRef] = useCell(null);
  const [slide, setSlide, slideRef] = useCell(-1);
  const [, setStep, stepRef] = useCell(0);
  const [, setLock, lockRef] = useCell(false);
  const [, setLocked, lockedRef] = useCell(null);
  const [, setBg, bgRef] = useCell(null);
  const [, setVideo, videoRef] = useCell(null);
  const [, setAudio, audioRef] = useCell(DEFAULT_AUDIO_STATE);
  const [, setMode, modeRef] = useCell('slides');
  const [, setScripture, scriptureRef] = useCell(null);
  const [, setDuck, duckRef] = useCell({ isDucking: false, fadeFactor: 1 });
  const [, setMaps] = useState([]);
  useSyncState({ isControlMode: true, isPresenterMode: false, clientIdRef: useRef('astra-ui'),
    currentPresentationRef: presentationRef, currentSlideIndexRef: slideRef, currentStepIndexRef: stepRef,
    backgroundLockRef: lockRef, lockedBackgroundValueRef: lockedRef, userSelectedBackgroundRef: bgRef,
    videoStateRef: videoRef, audioStateRef: audioRef, appModeRef: modeRef, scriptureStateRef: scriptureRef,
    autoduckStateRef: duckRef, setCurrentPresentation: setPresentation, setCurrentSlideIndex: setSlide,
    setCurrentStepIndex: setStep, setBackgroundLock: setLock, setLockedBackgroundValue: setLocked,
    setUserSelectedBackground: setBg, setVideoState: setVideo, setAudioState: setAudio,
    setAppMode: setMode, setScriptureState: setScripture, setAutoduckState: setDuck, setAudioSyncMaps: setMaps as any,
  });
  return <output data-testid="projection">{presentation?.id}:{slide}</output>;
}
function transports() {
  let resolveGet: (value: any) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { resolveGet = resolve; })));
  const streams: any[] = [], channels: any[] = [];
  class Stream { onmessage: any; onerror: any; constructor() { streams.push(this); } close() {} }
  class Channel {
    handlers = new Set<any>(); constructor() { channels.push(this); }
    addEventListener(_name: string, callback: any) { this.handlers.add(callback); }
    removeEventListener(_name: string, callback: any) { this.handlers.delete(callback); }
    postMessage() {} close() {}
  }
  vi.stubGlobal('EventSource', Stream); vi.stubGlobal('BroadcastChannel', Channel);
  return {
    get: async (state: any) => { await act(async () => { resolveGet({ ok: true, json: async () => state }); }); },
    sse: (state: any) => act(() => streams[0].onmessage({ data: JSON.stringify(state) })),
    bc: (state: any) => act(() => channels[0].handlers.forEach((fn: any) => fn({ data: state }))),
  };
}
it('M04: real React state and DOM roll back when old GET completes after new SSE', async () => {
  const transport = transports(); render(<Projection />);
  transport.sse(snapshot(1, 200, 'new'));
  expect(screen.getByTestId('projection').textContent).toBe('p:1');
  await transport.get(snapshot(0, 100, 'old'));
  expect(screen.getByTestId('projection').textContent).toBe('p:0');
  expect(JSON.parse(localStorage.getItem('sefer-presenter-state')!).slideIndex).toBe(0);
});
it('M04: distinct older BC rolls back new SSE; identical message ID is correctly deduplicated', () => {
  const transport = transports(); render(<Projection />);
  transport.sse(snapshot(1, 200, 'same'));
  transport.bc(snapshot(0, 100, 'same'));
  expect(screen.getByTestId('projection').textContent).toBe('p:1');
  transport.bc(snapshot(0, 100, 'older-distinct'));
  expect(screen.getByTestId('projection').textContent).toBe('p:0');
  transport.sse(snapshot(1, 300, 'latest'));
  expect(screen.getByTestId('projection').textContent).toBe('p:1');
});

function audience() {
  let receive = (_type: string, _payload: Record<string, unknown>) => {};
  const subscribe = (handler: typeof receive) => { receive = handler; return () => {}; };
  const hook = renderHook(() => useAudienceSession({ subscribeToWsMessage: subscribe }));
  return { ...hook, send: (type: string, id: string) => act(() => receive(type, { presentationSessionId: id })) };
}
it.each([
  ['valid matching', 60000, 'old', true], ['valid different', 60000, 'new', false],
  ['expired different', -1, 'new', true], ['expired matching', -1, 'old', true],
])('M06: %s session envelope', (_name, ttl, welcomed, retains) => {
  localStorage.setItem('sefer-audience-nick', 'Synthetic Alias');
  localStorage.setItem('sefer-audience-alias-visible', 'true');
  // The fourth argument is the creation clock, not a custom TTL.
  writeExpiringStorage(localStorage, 'sefer-audience-session-id', 'old', (ttl as number) > 0 ? Date.now() : 0);
  const hook = audience(); hook.send('WELCOME', welcomed as string);
  expect(hook.result.current.isLoggedIn).toBe(retains);
  expect(hook.result.current.nick).toBe(retains ? 'Synthetic Alias' : '');
  expect(hook.result.current.aliasVisible).toBe(retains);
});
it('M06: explicit logout and rotation purge identity; two hook instances do not synchronize storage deletion', () => {
  localStorage.setItem('sefer-audience-nick', 'Synthetic Alias');
  const one = audience(), two = audience();
  act(() => one.result.current.logout());
  expect(one.result.current.isLoggedIn).toBe(false);
  expect(localStorage.getItem('sefer-audience-nick')).toBeNull();
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'sefer-audience-nick', oldValue: 'Synthetic Alias', newValue: null, storageArea: localStorage })));
  expect(two.result.current.isLoggedIn).toBe(true);
  two.send('PRESENTATION_SESSION_ROTATED', 'new');
  expect(two.result.current.isLoggedIn).toBe(false);
});

it('M02: actual audio editor keeps optimistic maps on HTTP 500; network rejection alerts; remount restores server copy', async () => {
  const old = [{ id: 'map-a', name: 'old', audioSrc: '/audio/synthetic.mp3', presentationId: 'P', defaultSyncMode: 'bilateral', defaultVolume: 1, cues: [{ timeSec: 0, slideIndex: 0 }] }];
  let rejectNetwork = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      if (rejectNetwork) throw new Error('synthetic network failure');
      return { ok: false, status: 500, json: async () => ({ error: 'synthetic write failure' }) };
    }
    return { ok: true, json: async () => url === '/api/audio-sync' ? old : [] };
  });
  vi.stubGlobal('fetch', fetchMock);
  const alert = vi.fn(); vi.stubGlobal('alert', alert);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import('../../../../../src/main-audio-editor'); });
  await waitFor(() => expect(screen.getByTestId('maps').textContent).toBe('old'));
  const element = capture.element;
  await act(async () => capture.props.onAudioSyncMapsChange([{ ...old[0], name: 'http-500-edit' }]));
  expect(screen.getByTestId('maps').textContent).toBe('http-500-edit');
  expect(alert).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true);
  rejectNetwork = true;
  await act(async () => capture.props.onAudioSyncMapsChange([{ ...old[0], name: 'network-edit' }]));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('maps').textContent).toBe('network-edit');
  await act(async () => capture.roots[0].unmount());
  const { createRoot } = await import('react-dom/client');
  const nextRoot = createRoot(document.getElementById('root')!);
  await act(async () => nextRoot.render(element));
  await waitFor(() => expect(screen.getByTestId('maps').textContent).toBe('old'));
  await act(async () => nextRoot.unmount());
});
