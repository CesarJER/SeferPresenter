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

const renderPanel = (dispatchAction = vi.fn(), loop = false) => {
  const view = render(
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
      loop={loop}
    />,
  );

  return {
    ...view,
    dispatchAction,
    scrubber: screen.getByLabelText('Posicion de audio') as HTMLInputElement,
    rerenderPanel: (estimatedPositionSec: number) => view.rerender(
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
        estimatedPositionSec={estimatedPositionSec}
        loop={loop}
      />,
    ),
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
    expect(scrubber.value).toBe('42');
  });

  it('releases stale manual scrub state after inactivity without mutating remote audio', () => {
    const { dispatchAction, scrubber } = renderPanel();

    fireEvent.change(scrubber, { target: { value: '33' } });
    expect(dispatchAction).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1799);
    });
    expect(dispatchAction).not.toHaveBeenCalled();
    expect(scrubber.value).toBe('33');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dispatchAction).not.toHaveBeenCalled();
    expect(scrubber.value).toBe('10');
  });

  it('keeps an optimistic seek position until the server timeline catches up', () => {
    const { dispatchAction, rerenderPanel, scrubber } = renderPanel();

    fireEvent.change(scrubber, { target: { value: '42' } });
    fireEvent.mouseUp(window);

    expect(dispatchAction).toHaveBeenCalledWith({ type: 'SEEK', positionSec: 42 });
    expect(scrubber.value).toBe('42');

    act(() => {
      rerenderPanel(10.5);
    });
    expect(scrubber.value).toBe('42');

    act(() => {
      rerenderPanel(42.2);
    });
    expect(scrubber.value).toBe('42.2');
  });

  it('toggles backend loop state from the loop button', () => {
    const dispatchAction = vi.fn();
    renderPanel(dispatchAction, false);

    fireEvent.click(screen.getByRole('button', { name: 'Activar bucle de audio' }));

    expect(dispatchAction).toHaveBeenCalledWith({ type: 'SET_LOOP', loop: true });
  });
});
