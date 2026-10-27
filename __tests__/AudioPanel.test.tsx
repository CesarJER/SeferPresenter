// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPanel } from '../src/components/control/AudioPanel';
import { applyAction, reset as resetTimeline } from '../server/timelineManager.mjs';
import { buildPublicPresentations } from '../server/public-presentations-builder.mjs';
import type { AudioState, AudioSyncMap } from '../src/types/audio';
import type { Presentation } from '../src/types/presentation';

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

const renderPanel = (dispatchAction = vi.fn(), loop = false, audioSyncMaps: AudioSyncMap[] = [], presentations: Presentation[] = [], currentPresentation: Presentation | null = null) => {
  const view = render(
    <AudioPanel
      audioState={audioState}
      onAudioStateChange={vi.fn()}
      audioSyncMaps={audioSyncMaps}
      availableAudioFiles={['/audio/test.mp3']}
      presentations={presentations}
      currentPresentation={currentPresentation}
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
        audioSyncMaps={audioSyncMaps}
        availableAudioFiles={['/audio/test.mp3']}
        presentations={presentations}
        currentPresentation={currentPresentation}
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
    vi.restoreAllMocks();
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

  it('propagates syncMapId and presentationId when activating synchronization for a newly created map', () => {
    resetTimeline();
    applyAction({ type: 'SET_TRACK', presentationId: 'p1', audioSrc: '/audio/test.mp3' });

    const dispatchAction = vi.fn((action) => applyAction(action));
    const presentations: Presentation[] = [
      { id: 'p1', title: 'Pres 1', mode: 'standard', background: '', slides: [] },
      { id: 'p2', title: 'Pres 2', mode: 'standard', background: '', slides: [] },
    ];
    const syncMaps: AudioSyncMap[] = [
      { id: 'map-p1', name: 'Map 1', presentationId: 'p1', audioSrc: '/audio/test.mp3', defaultSyncMode: 'unilateral', defaultVolume: 0.8, cues: [] },
      { id: 'map-p2', name: 'Map 2', presentationId: 'p2', audioSrc: '/audio/test.mp3', defaultSyncMode: 'bilateral', defaultVolume: 0.9, cues: [] },
    ];

    renderPanel(dispatchAction, false, syncMaps, presentations, presentations[1]);

    // Prefers the sync map matching currentPresentation (p2) and propagates syncMapId + presentationId
    fireEvent.click(screen.getByTitle('Sincronización Bilateral (Sincro Bidireccional)'));
    expect(dispatchAction).toHaveBeenCalledWith({
      type: 'SET_SYNC_MODE',
      mode: 'bilateral',
      syncMapId: 'map-p2',
      presentationId: 'p2',
    });
    const updatedTimeline = dispatchAction.mock.results[0].value;
    expect(updatedTimeline.syncMode).toBe('bilateral');
    expect(updatedTimeline.syncMapId).toBe('map-p2');
    expect(updatedTimeline.presentationId).toBe('p2');
  });

  it('caches parsed scripture book chapters across buildPublicPresentations calls (BUG-02)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-bug02-'));
    try {
      fs.mkdirSync(path.join(tempDir, 'books'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'metadata.json'),
        JSON.stringify({ gen: { bookAbbrevEs: 'Gn', bookHeb: 'בראשית', safeFile: '01_genesis' } }),
      );
      fs.writeFileSync(
        path.join(tempDir, 'books', '01_genesis.tsv'),
        [
          'book\tabbrev\theb\tchapter\tverse\tnikud\ttranslit\ttranslation',
          'Génesis\tGn\tבראשית\t1\t1\tבְּרֵאשִׁית\tBereshit\tEn el principio',
          'Génesis\tGn\tבראשית\t1\t2\tוְהָאָרֶץ\tVehaaretz\tY la tierra',
        ].join('\n'),
      );

      const presentations = [
        {
          id: 'pres-scripture',
          title: 'Scripture Pres',
          mode: 'trilingual',
          background: '',
          tags: ['public'],
          slides: [
            {
              id: 'slide-1',
              label: 'Gen 1:1-2',
              type: 'tanaj',
              lines: ['', '', ''],
              scriptureBook: 'Gn',
              scriptureChapter: '1',
              scriptureVerseStart: '1',
              scriptureVerseEnd: '2',
            },
          ],
        },
      ];
      const catalogs = [{ id: 'pub', path: '/pub', title: 'Pub', tags: ['public'] }];

      // Warm the cache on first build
      const first = buildPublicPresentations(presentations, catalogs, { publicDataDir: tempDir });
      expect(first[0].slides[0].scriptureVerses?.length).toBe(2);

      // Check source contents once per dependency, while reusing the parsed chapter rows.
      const readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
      const second = buildPublicPresentations([{ ...presentations[0], slides: Array(20).fill(presentations[0].slides[0]) }], catalogs, { publicDataDir: tempDir });
      expect(second[0].slides).toHaveLength(20);
      expect(second[0].slides[0].scriptureVerses?.length).toBe(2);
      expect(second[0].slides[0].scriptureVerses?.[0]).toBe(first[0].slides[0].scriptureVerses?.[0]);
      expect(readFileSyncSpy.mock.calls.map(([file]) => file)).toEqual([
        path.join(tempDir, 'metadata.json'), path.join(tempDir, 'books', '01_genesis.tsv'),
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
