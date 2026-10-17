// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioSyncEditor } from '../src/components/AudioSyncEditor';
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
