// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceScriptureControl from '../src/features/voiceScripture/VoiceScriptureControl';
import AudienceScreen from '../src/components/audience/AudienceScreen';
import { getDefaultProjectionState, makeAudienceSyncStateMessage, reduceProjectionCommand } from '../server/projection-state-reducer.mjs';
import type { VoiceSessionCallbacks } from '../src/features/voiceScripture/voiceScriptureSession';
import type { ScriptureNavState } from '../src/types/presentation';

const mocks = vi.hoisted(() => ({ sessions: [] as VoiceSessionCallbacks[], load: vi.fn() }));
vi.mock('../src/features/voiceScripture/voiceScriptureSession', () => ({
  VoiceScriptureSession: class {
    callbacks: VoiceSessionCallbacks;
    constructor(_track, _phrases, callbacks) { this.callbacks = callbacks; mocks.sessions.push(callbacks); }
    start() { this.callbacks.phase('listening'); }
    stop() { this.callbacks.phase('idle'); return Promise.resolve(); }
    dispose() {}
  },
}));
vi.mock('../src/utils/metadataCache', () => ({
  getMetadata: async () => ({ Alfa: { bookAbbrevEs: 'A', bookHeb: '', safeFile: 'alfa', chapters: { '1': ['1', '2', '3', '4', '5'] } } }),
  loadBookData: (...args) => mocks.load(...args),
  resolveBookName: (name) => name === 'Alfa' || name === 'A' ? 'Alfa' : null,
}));
const verses = Array.from({ length: 5 }, (_, index) => ({
  bookEs: 'Alfa', bookAbbrevEs: 'A', bookHeb: '', chapter: '1', verse: String(index + 1),
  verseNikud: 'Texto sintético', transliteration: 'Texto sintético', translation: `Texto ${index + 1}`,
}));
const track = { readyState: 'live' } as MediaStreamTrack;
const tracks = [{ id: 'local-mic', label: 'Fuente de prueba', track }];
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('EventSource', class extends EventTarget { close() {} });
  mocks.sessions.length = 0; mocks.load.mockReset(); mocks.load.mockResolvedValue(verses);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: true, available: true }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const start = async () => {
  await waitFor(() => expect((screen.getByText('Iniciar escucha automática') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Iniciar escucha automática'));
};
const emit = async (text: string) => { await act(async () => { mocks.sessions.at(-1)!.final(text, 'event'); }); };

describe('Control automatic projection', () => {
  it('hydrates the last reference and retains all options', async () => {
    const onProject = vi.fn();
    render(<VoiceScriptureControl tracks={tracks} scriptureState={null} onProject={onProject} />);
    await start(); await emit('Alfa uno uno y Alfa uno tres al cinco');
    expect(onProject).toHaveBeenCalledTimes(1);
    expect(onProject.mock.calls[0][0]).toMatchObject({ verse: '3', verseStart: '3', verseEnd: '5', verseIdx: 0, totalVerses: 3 });
    expect(screen.getByText('A 1:1')).toBeTruthy();
    expect(screen.getByText('A 1:3-5')).toBeTruthy();
  });
  it('passes a range through the backend and Audience snapshot without a Presenter', async () => {
    let serverState = getDefaultProjectionState();
    const onProject = vi.fn((state) => {
      const result = reduceProjectionCommand(serverState, { command: 'SCRIPTURE_PROJECT', state, navCommand: 'navigate' });
      expect(result.ok).toBe(true); serverState = result.state;
    });
    const view = render(<VoiceScriptureControl tracks={tracks} scriptureState={null} onProject={onProject} />);
    await start(); await emit('Alfa uno tres al cinco');
    const snapshot = makeAudienceSyncStateMessage(serverState);
    expect(snapshot.scriptureState).toMatchObject({ verse: '3', verseStart: '3', verseEnd: '5' });
    const audience = render(<AudienceScreen appMode="scripture" scriptureState={snapshot.scriptureState}
      background="" fontScale={1} presentationTitle="" presentationId={null} slide={null} videoState={null} />);
    await waitFor(() => expect(audience.container.textContent).toContain('Alfa 1:3-5 (3)'));
    await waitFor(() => expect(audience.container.textContent).toContain('Texto 3'));
    view.rerender(<VoiceScriptureControl tracks={tracks} scriptureState={serverState.scriptureState} onProject={onProject} />);
    expect(screen.getByText('Proyección confirmada por el servidor')).toBeTruthy();
    await emit('siguiente versículo');
    expect(onProject.mock.calls.at(-1)![0].verse).toBe('4');
  });
  it('cancels pending hydration when stopped', async () => {
    let resolve;
    mocks.load.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onProject = vi.fn();
    render(<VoiceScriptureControl tracks={tracks} scriptureState={null} onProject={onProject} />);
    await start(); await emit('Alfa uno tres');
    fireEvent.click(screen.getByText('Detener'));
    await act(async () => { resolve(verses); });
    expect(onProject).not.toHaveBeenCalled();
    expect(screen.queryByText('A 1:3')).toBeNull();
  });
  it('discards hydration after the confirmed context changes', async () => {
    let resolve;
    mocks.load.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onProject = vi.fn();
    const view = render(<VoiceScriptureControl tracks={tracks} scriptureState={null} onProject={onProject} />);
    await start(); await emit('Alfa uno tres');
    view.rerender(<VoiceScriptureControl tracks={tracks} scriptureState={{ bookAbbrevEs: 'A', chapter: '1', verse: '2' } as ScriptureNavState} onProject={onProject} />);
    await act(async () => { resolve(verses); });
    expect(onProject).not.toHaveBeenCalled();
  });
  it('lets a newer reference bypass a cancelled unresolved book load', async () => {
    mocks.load.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValue(verses);
    const onProject = vi.fn();
    render(<VoiceScriptureControl tracks={tracks} scriptureState={null} onProject={onProject} />);
    await start(); await emit('Alfa uno dos'); await emit('Alfa uno cuatro');
    expect(onProject).toHaveBeenCalledTimes(1);
    expect(onProject.mock.calls[0][0].verse).toBe('4');
  });
  it('cancels if the underlying track is replaced under the same ID', async () => {
    const onProject = vi.fn();
    const view = render(<VoiceScriptureControl tracks={tracks} scriptureState={null} onProject={onProject} />);
    await start();
    view.rerender(<VoiceScriptureControl tracks={[{ ...tracks[0], track: { readyState: 'live' } as MediaStreamTrack }]} scriptureState={null} onProject={onProject} />);
    await emit('Alfa uno tres');
    expect(onProject).not.toHaveBeenCalled();
  });
  it('allows availability recovery without remounting', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, available: false })));
    render(<VoiceScriptureControl tracks={tracks} scriptureState={null} onProject={vi.fn()} />);
    await screen.findByText('STT o metadatos no disponibles');
    fireEvent.click(screen.getByText('Comprobar disponibilidad'));
    await start();
    expect(mocks.sessions).toHaveLength(1);
  });
  it('does not guess relative commands while waiting for the server', async () => {
    const onProject = vi.fn();
    render(<VoiceScriptureControl tracks={tracks} scriptureState={null} onProject={onProject} />);
    await start(); await emit('Alfa uno tres'); await emit('siguiente versículo');
    expect(onProject).toHaveBeenCalledTimes(1);
  });
});
