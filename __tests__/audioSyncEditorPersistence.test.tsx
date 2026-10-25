// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioSyncEditor } from '../src/components/AudioSyncEditor';
import { loadCatalog, saveCatalog, audioSyncCatalogOptions } from '../src/utils/catalogApi';
import type { AudioSyncMap } from '../src/types/audio';
import type { Presentation } from '../src/types/presentation';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('retains an edited cue and its original revision when another device updates maps, and never confirms a failed save', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const alert = vi.fn(); vi.stubGlobal('alert', alert);
  const presentations: Presentation[] = [{ id: 'p', title: 'Synthetic', mode: 'standard', background: '', slides: [{ id: 's', label: 'First', lines: ['Text'] }] }];
  const maps: AudioSyncMap[] = [{ id: 'm', name: 'Original', presentationId: 'p', audioSrc: '/audio/test.mp3', defaultVolume: 0.7, defaultSyncMode: 'unilateral', cues: [{ slideIndex: 0, timeSec: 1 }] }];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(presentations), { headers: { ETag: '"presentations"' } })));
  const save = vi.fn().mockRejectedValue(new Error('Conflict: draft retained'));
  const props = { isOpen: true, onClose: vi.fn(), presentations, activePresentationId: 'p', activeAudioSrc: '/audio/test.mp3', availableAudioFiles: ['/audio/test.mp3'], audioSyncMaps: maps, onAudioSyncMapsChange: save };
  const view = render(<AudioSyncEditor {...props} />);
  const time = await screen.findByRole('textbox');
  await waitFor(() => expect((time as HTMLInputElement).value).toBe('1'));
  fireEvent.change(time, { target: { value: '7.5' } });
  view.rerender(<AudioSyncEditor {...props} audioSyncMaps={[{ ...maps[0], cues: [{ slideIndex: 0, timeSec: 99 }] }]} />);
  expect((time as HTMLInputElement).value).toBe('7.5');
  fireEvent.click(screen.getByRole('button', { name: 'GUARDAR CONFIGURACIÓN' }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Conflict: draft retained'));
  expect(save.mock.calls[0][1]).toBe(maps);
  expect(save.mock.calls[0][0][0].cues[0].timeSec).toBe(7.5);
  expect(alert).not.toHaveBeenCalledWith('Sincronización guardada correctamente.');
  expect((time as HTMLInputElement).value).toBe('7.5');
});

it('creates and saves a new sync map even if the user starts editing before catalog ETag revision finishes loading, without overwriting a manually chosen presentation', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const alert = vi.fn(); vi.stubGlobal('alert', alert);
  const presentations: Presentation[] = [
    { id: 'p1', title: 'Presentation One', mode: 'standard', background: '', slides: [{ id: 's1', label: 'Slide 1', lines: ['One'] }] },
    { id: 'p2', title: 'Presentation Two', mode: 'standard', background: '', slides: [{ id: 's2', label: 'Slide 2', lines: ['Two'] }] },
  ];
  const existingMaps: AudioSyncMap[] = [
    { id: 'm1', name: 'Existing', presentationId: 'p1', audioSrc: '/audio/shared.mp3', defaultVolume: 0.7, defaultSyncMode: 'unilateral', cues: [{ slideIndex: 0, timeSec: 2 }] },
  ];

  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/presentations') {
      return new Response(JSON.stringify(presentations), { headers: { ETag: '"pres-etag"' } });
    }
    if (url === '/api/audio-sync' && options?.method === 'POST') {
      expect(options.headers).toMatchObject({ 'If-Match': '"sync-etag-1"' });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ETag: '"sync-etag-2"' } });
    }
    return new Response(JSON.stringify(existingMaps), { headers: { ETag: '"sync-etag-1"' } });
  }));

  const unversionedInitialMaps: AudioSyncMap[] = [];
  let latestCatalogMaps = unversionedInitialMaps;
  const handleSaveCatalog = vi.fn(async (maps: AudioSyncMap[], baseMaps = latestCatalogMaps) => {
    return saveCatalog('/api/audio-sync', maps, baseMaps, audioSyncCatalogOptions);
  });

  const view = render(
    <AudioSyncEditor
      isOpen={true}
      onClose={vi.fn()}
      presentations={presentations}
      activePresentationId="p1"
      activeAudioSrc={null}
      availableAudioFiles={['/audio/shared.mp3']}
      audioSyncMaps={unversionedInitialMaps}
      onAudioSyncMapsChange={handleSaveCatalog}
    />
  );

  const selects = screen.getAllByRole('combobox');
  const audioSelect = selects[0] as HTMLSelectElement;
  const presentationSelect = selects[1] as HTMLSelectElement;

  // User explicitly chooses p2 first, then selects /audio/shared.mp3 (which has an existing map for p1)
  fireEvent.change(presentationSelect, { target: { value: 'p2' } });
  expect(presentationSelect.value).toBe('p2');
  fireEvent.change(audioSelect, { target: { value: '/audio/shared.mp3' } });
  // Selecting the track must not overwrite the user's explicit p2 choice with p1
  expect(presentationSelect.value).toBe('p2');

  const timeInput = await screen.findByRole('textbox');
  fireEvent.change(timeInput, { target: { value: '12.5' } });

  // Now the initial /api/audio-sync catalog finishes loading with ETag revision
  latestCatalogMaps = await loadCatalog<AudioSyncMap>('/api/audio-sync');
  view.rerender(
    <AudioSyncEditor
      isOpen={true}
      onClose={vi.fn()}
      presentations={presentations}
      activePresentationId="p1"
      activeAudioSrc={null}
      availableAudioFiles={['/audio/shared.mp3']}
      audioSyncMaps={latestCatalogMaps}
      onAudioSyncMapsChange={handleSaveCatalog}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'GUARDAR CONFIGURACIÓN' }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Sincronización guardada correctamente.'));
  expect(handleSaveCatalog).toHaveBeenCalledTimes(1);
  const savedMaps = handleSaveCatalog.mock.calls[0][0];
  expect(savedMaps).toHaveLength(2);
  expect(savedMaps.find((m: AudioSyncMap) => m.presentationId === 'p2' && m.audioSrc === '/audio/shared.mp3')?.cues).toEqual([
    { slideIndex: 0, timeSec: 12.5 },
  ]);
});

it('does not abort save with "Presentation check superseded" when window focus fires during save refresh', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const alert = vi.fn(); vi.stubGlobal('alert', alert);
  const presentations: Presentation[] = [{ id: 'p', title: 'Synthetic', mode: 'standard', background: '', slides: [{ id: 's', label: 'First', lines: ['Text'] }] }];
  const maps: AudioSyncMap[] = [{ id: 'm', name: 'Original', presentationId: 'p', audioSrc: '/audio/test.mp3', defaultVolume: 0.7, defaultSyncMode: 'unilateral', cues: [{ slideIndex: 0, timeSec: 1 }] }];

  let resolveRefreshFetch: ((res: Response) => void) | null = null;
  let fetchCount = 0;
  vi.stubGlobal('fetch', vi.fn(() => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return Promise.resolve(new Response(JSON.stringify(presentations), { headers: { ETag: '"presentations"' } }));
    }
    return new Promise<Response>((resolve) => {
      resolveRefreshFetch = resolve;
    });
  }));

  const save = vi.fn().mockResolvedValue(maps);
  render(
    <AudioSyncEditor
      isOpen={true}
      onClose={vi.fn()}
      presentations={presentations}
      activePresentationId="p"
      activeAudioSrc="/audio/test.mp3"
      availableAudioFiles={['/audio/test.mp3']}
      audioSyncMaps={maps}
      onAudioSyncMapsChange={save}
    />
  );

  const time = await screen.findByRole('textbox');
  await waitFor(() => expect((time as HTMLInputElement).value).toBe('1'));

  fireEvent.click(screen.getByRole('button', { name: 'GUARDAR CONFIGURACIÓN' }));
  await waitFor(() => expect(resolveRefreshFetch).not.toBeNull());

  // Window focus event while save refresh is in flight must not supersede the in-flight check
  fireEvent(window, new Event('focus'));
  resolveRefreshFetch!(new Response(JSON.stringify(presentations), { headers: { ETag: '"presentations"' } }));

  await waitFor(() => expect(alert).toHaveBeenCalledWith('Sincronización guardada correctamente.'));
  expect(save).toHaveBeenCalledTimes(1);
});
