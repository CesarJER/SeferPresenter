// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioEditorApp } from '../src/main-audio-editor';
import type { AudioSyncMap } from '../src/types/audio';

const observer = vi.hoisted(() => ({ save: undefined as undefined | ((maps: AudioSyncMap[]) => Promise<void>) }));
vi.mock('../src/components/AudioSyncEditor', () => ({ AudioSyncEditor: (props: { presentations: { title: string }[]; audioSyncMaps: AudioSyncMap[]; onAudioSyncMapsChange: typeof observer.save }) => {
  observer.save = props.onAudioSyncMapsChange;
  return <div>{props.presentations[0]?.title}<span>{props.audioSyncMaps[0]?.name}</span></div>;
} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const presentation = { id: 'p', title: 'Loaded editor', mode: 'trilingual', background: '', slides: [{ id: 's', label: 's', lines: ['a'] }] };
const map: AudioSyncMap = { id: 'm', name: 'Saved map', audioSrc: '/audio/test.mp3', presentationId: 'p', defaultVolume: 0.7, defaultSyncMode: 'unilateral', cues: [] };
it('loads without browser cache, retries the failing endpoint and does not accept a failed save', async () => {
  let onUpdate: ((event: { data: string }) => void) | null = null;
  vi.stubGlobal('EventSource', class {
    set onmessage(handler: typeof onUpdate) { onUpdate = handler; }
    close() {}
  });
  let currentMap = map;
  let failingLoad = true;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') return new Response('{}', { status: 500 });
    if (url === '/api/audio-sync' && failingLoad) return new Response('{}', { status: 401 });
    const data = url === '/api/presentations' ? [presentation] : url === '/api/audio-sync' ? [currentMap] : ['/audio/test.mp3'];
    return new Response(JSON.stringify(data), { headers: { ETag: '"baseline"' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<AudioEditorApp />);
  await screen.findByText(/\/api\/audio-sync: HTTP 401/);
  failingLoad = false; fireEvent.click(screen.getByRole('button', { name: 'Reintentar carga' }));
  await screen.findByText('Loaded editor');
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method !== 'POST').every(([, options]) => options?.cache === 'no-store')).toBe(true);
  currentMap = { ...map, name: 'Updated remotely' };
  act(() => onUpdate?.({ data: JSON.stringify({ type: 'AUDIO_SYNC_MAPS_UPDATE' }) }));
  await screen.findByText('Updated remotely');
  await act(async () => { await expect(observer.save!([{ ...map, name: 'Failed edit' }])).rejects.toThrow('HTTP 500'); });
  expect(screen.getByText('Updated remotely')).toBeTruthy();
  expect(screen.queryByText('Failed edit')).toBeNull();
});
