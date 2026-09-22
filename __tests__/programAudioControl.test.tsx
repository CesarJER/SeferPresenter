// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { PROGRAM_AUDIO_KEY, useProgramAudioPreference } from '../src/hooks/useProgramAudioPreference';
import { useAudioPlayback } from '../src/hooks/useAudioPlayback';
import { useAudioTimelineApplicator } from '../src/hooks/useAudioTimelineApplicator';
import SlideVisualizer from '../src/components/shared/SlideVisualizer';
import { PrivateControlInbox } from '../src/features/liveAudio/components/control/PrivateControlInbox';
import type { AudioState, AudioTimelineState } from '../src/types/audio';

vi.mock('../src/hooks/useIosAudioBufferPlayer', () => ({
  useIosAudioBufferPlayer: () => ({ isIos: false, player: null }),
}));
vi.mock('../src/hooks/useSmoothVolume', () => ({ useSmoothVolume: () => {} }));
vi.mock('../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({
  useLiveAudioAvailability: () => ({ availability: 'enabled' }),
}));

const audioState: AudioState = {
  isPlaying: true, currentTime: 12, duration: 80, volume: 0.6,
  audioSrc: '/audio/test.mp3', activeSyncMapId: null, syncMode: 'none',
  lastUpdatedBy: 'controller', changeType: 'track', timestamp: 1,
};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('local program audio preference', () => {
  it('keeps decisions in separate browser storage independent', () => {
    const originalStorage = globalThis.localStorage;
    const firstStorage = new Map<string, string>();
    const secondStorage = new Map<string, string>();
    const storage = (values: Map<string, string>) => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    try {
      vi.stubGlobal('localStorage', storage(firstStorage));
      const first = renderHook(() => useProgramAudioPreference(false));
      act(() => first.result.current[1](true));
      vi.stubGlobal('localStorage', storage(secondStorage));
      const second = renderHook(() => useProgramAudioPreference(false));
      act(() => second.result.current[1](false));
      expect(first.result.current[0]).toBe(true);
      expect(second.result.current[0]).toBe(false);
      expect(firstStorage.get(PROGRAM_AUDIO_KEY)).toBe('true');
      expect(secondStorage.get(PROGRAM_AUDIO_KEY)).toBe('false');
    } finally {
      vi.stubGlobal('localStorage', originalStorage);
    }
  });

  it('defaults to media master on and secondary off, then preserves explicit choices across role changes and remounts', () => {
    const master = renderHook(({ role }) => useProgramAudioPreference(role), { initialProps: { role: true } });
    expect(master.result.current[0]).toBe(true);
    master.unmount();
    const secondary = renderHook(({ role }) => useProgramAudioPreference(role), { initialProps: { role: false } });
    expect(secondary.result.current[0]).toBe(false);
    act(() => secondary.result.current[1](true));
    expect(localStorage.getItem(PROGRAM_AUDIO_KEY)).toBe('true');
    expect(secondary.result.current[0]).toBe(true);
    secondary.rerender({ role: true });
    expect(secondary.result.current[0]).toBe(true);
    secondary.unmount();
    const remounted = renderHook(({ role }) => useProgramAudioPreference(role), { initialProps: { role: false } });
    expect(remounted.result.current[0]).toBe(true);
    act(() => remounted.result.current[1](false));
    remounted.rerender({ role: true });
    expect(remounted.result.current[0]).toBe(false);
    remounted.unmount();
    expect(renderHook(() => useProgramAudioPreference(true)).result.current[0]).toBe(false);
  });

  it('shows an authorized operator toggle by the nick and only calls the local change handler', () => {
    const onChange = vi.fn();
    const remote = vi.fn();
    const view = render(<PrivateControlInbox isOpen isControlAuthorized messages={[]} authorizationRequests={[]}
      onApproveRequest={remote} onRejectRequest={remote} onDismissMessage={remote}
      programAudioEnabled={false} onProgramAudioEnabledChange={onChange} />);
    const toggle = screen.getByRole('checkbox', { name: /Audio de programa/ });
    expect(toggle).toHaveProperty('checked', false);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(remote).not.toHaveBeenCalled();
    view.rerender(<PrivateControlInbox isOpen isControlAuthorized messages={[]} authorizationRequests={[]}
      onApproveRequest={remote} onRejectRequest={remote} onDismissMessage={remote}
      programAudioEnabled={true} onProgramAudioEnabledChange={onChange} />);
    expect(toggle).toHaveProperty('checked', true);
  });
});

it('keeps secondary audio playback locally synced and muted without emitting authority events', () => {
  const element = document.createElement('audio');
  document.body.append(element);
  const emit = vi.fn();
  const navigate = vi.fn();
  const props = { isControlMode: true, allowControlPlayback: true, outputEnabled: false,
    audioState, audioStateRef: { current: audioState }, audioSyncMaps: [], currentSlideIndex: 0,
    currentPresentationId: undefined, scriptureState: null,
    audioRef: { current: element }, currentPresentationRef: { current: null },
    setAutoplayBlocked: vi.fn(), emitAudioTelemetry: emit, handleSelectPresentationAndSlide: navigate };
  const hook = renderHook((p) => useAudioPlayback(p), { initialProps: props });
  expect(element.getAttribute('data-src')).toBe(audioState.audioSrc);
  expect(element.muted).toBe(true);
  expect(element.currentTime).toBe(12);
  hook.rerender({ ...props, outputEnabled: true });
  expect(element.muted).toBe(false);
  expect(element.currentTime).toBe(12);
  expect(emit).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  hook.rerender({ ...props, outputEnabled: true, audioState: { ...audioState, lastUpdatedBy: 'projection', currentTime: 18, changeType: 'seek' } });
  expect(element.currentTime).toBe(18);
  expect(emit).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  hook.rerender({ ...props, outputEnabled: true, playbackEnabled: false });
  expect(element.getAttribute('src')).toBeNull();
  expect(emit).not.toHaveBeenCalled();
  element.remove();
});

it('mutes timeline output without changing timeline position or playback authority', () => {
  const element = document.createElement('audio');
  document.body.append(element);
  const timeline: AudioTimelineState = { timelineId: 't', audioSrc: '/audio/test.mp3', status: 'paused',
    basePositionSec: 7, baseServerTimeMs: 0, playbackRate: 1, durationSec: 80, loop: false,
    volume: 0.4, syncMapId: null, syncMode: 'none', updatedBy: 'control' };
  const options = { onDurationChange: vi.fn(), onEnded: vi.fn() };
  const useTimeline = ({ enabled }: { enabled: boolean }) => {
    const audioRef = useRef<HTMLAudioElement | null>(element);
    useAudioTimelineApplicator(audioRef, timeline, () => 0, undefined, options, enabled);
  };
  const hook = renderHook(useTimeline, { initialProps: { enabled: false } });
  expect(element.muted).toBe(true);
  expect(element.currentTime).toBe(7);
  hook.rerender({ enabled: true });
  expect(element.muted).toBe(false);
  expect(element.currentTime).toBe(7);
  expect(options.onEnded).not.toHaveBeenCalled();
  element.remove();
});

it('mutes only preview video output while keeping the synchronized video playing', () => {
  const slide = { id: 'v', label: 'Video', lines: [], type: 'media' as const, mediaSrc: '/video/test.mp4' };
  const videoState = { isPlaying: true, currentTime: 5, duration: 30, volume: 0.7,
    speed: 1, loop: false, mediaSrc: slide.mediaSrc, lastUpdatedBy: 'controller' as const, timestamp: 1 };
  const telemetry = vi.fn();
  const view = render(<SlideVisualizer slide={slide} appMode="slides" scriptureState={null}
    isMediaMaster={false} programAudioEnabled={false} videoState={videoState} emitVideoTelemetry={telemetry} />);
  const video = view.container.querySelector('video')!;
  expect(video.muted).toBe(true);
  expect(video.currentTime).toBe(5);
  view.rerender(<SlideVisualizer slide={slide} appMode="slides" scriptureState={null}
    isMediaMaster={false} programAudioEnabled={true} videoState={videoState} emitVideoTelemetry={telemetry} />);
  expect(video.muted).toBe(false);
  expect(video.currentTime).toBe(5);
  expect(telemetry).not.toHaveBeenCalled();
});
