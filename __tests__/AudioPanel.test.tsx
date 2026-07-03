// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPanel } from '../src/components/control/AudioPanel';
import type { AudioState } from '../src/types/audio';

const audioState: AudioState = {
  isPlaying: true,
  currentTime: 10,
  duration: 100,
  volume: 0.7,
  audioSrc: '/audio/test.mp3',
  activeSyncMapId: null,
  syncMode: 'none',
  lastUpdatedBy: 'controller',
  timestamp: 1000,
};

const renderPanel = (dispatchAction = vi.fn()) => {
  render(
    <AudioPanel
      audioState={audioState}
      onAudioStateChange={vi.fn()}
      audioSyncMaps={[]}
      availableAudioFiles={['/audio/test.mp3']}
      presentations={[]}
      currentPresentation={null}
      onSelectPresentation={vi.fn()}
      handleOpenAudioEditor={vi.fn()}
      dispatchAction={dispatchAction}
      estimatedPositionSec={10}
    />,
  );

  return {
    dispatchAction,
    scrubber: screen.getByLabelText('Posicion de audio') as HTMLInputElement,
  };
};

describe('AudioPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('commits a manual timeline seek when the pointer is released outside the slider', () => {
    const { dispatchAction, scrubber } = renderPanel();

    fireEvent.change(scrubber, { target: { value: '42' } });
    fireEvent.mouseUp(window);

    expect(dispatchAction).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledWith({ type: 'SEEK', positionSec: 42 });
  });

  it('auto-commits and releases manual scrub state after inactivity', () => {
    const { dispatchAction, scrubber } = renderPanel();

    fireEvent.change(scrubber, { target: { value: '33' } });
    expect(dispatchAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(dispatchAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dispatchAction).toHaveBeenCalledTimes(1);
    expect(dispatchAction).toHaveBeenCalledWith({ type: 'SEEK', positionSec: 33 });
    expect(scrubber.value).toBe('10');
  });
});
