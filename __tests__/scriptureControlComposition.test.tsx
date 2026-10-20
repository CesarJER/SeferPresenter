// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SeferControlPanel from '../src/components/control/SeferControlPanel';
import SeferControlPanelMini from '../src/components/control/SeferControlPanelMini';
import { useSeferControlLogic } from '../src/hooks/useSeferControlLogic';
import type { SeferReaderState } from '../src/types/scripture';
import { makeSyncMessage } from '../src/utils/syncProtocol';
import { validateSyncMessage } from '../src/utils/validation';
import { getDefaultProjectionState, makeAudienceSyncStateMessage, reduceProjectionCommand } from '../server/projection-state-reducer.mjs';

const metadata = Object.fromEntries(['Alfa', 'Beta', 'Gamma'].map(name => [`Colección ${name}`, {
  bookHeb: name, bookAbbrevEs: name, safeFile: name.toLowerCase(), chapters: { '1': ['1', '2', '3', '4'], '2': ['1', '2'] },
}]));
const bookTsv = (name: string) => [
  'bookEs\tbookAbbrevEs\tbookHeb\tchapter\tverse\tverseNikud\ttransliteration\ttranslation',
  ...['1', '2'].flatMap(chapter => (chapter === '1' ? [1, 2, 3, 4] : [1, 2]).map(verse =>
    `Colección ${name}\t${name}\t${name}\t${chapter}\t${verse}\tTexto ${verse}\t\t${name} ${chapter}:${verse}`)),
].join('\n');
const fetchCorpus = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith('/metadata.json')) return new Response(JSON.stringify(metadata));
  const name = ['Alfa', 'Beta', 'Gamma'].find(name => url.endsWith(`/books/${name.toLowerCase()}.tsv`));
  if (!name) throw new Error(`Unexpected request: ${url}`);
  return new Response(bookTsv(name));
});

type HostProps = Parameters<typeof useSeferControlLogic>[0] & {
  full?: boolean;
  mini?: boolean;
  slot?: 'top' | 'bottom';
};
function Host({ full = true, mini = true, slot = 'top', ...props }: HostProps) {
  const controller = useSeferControlLogic(props);
  const panel = full ? <div data-testid="full"><SeferControlPanel controller={controller} /></div> : null;
  return <>
    <section>{slot === 'top' && panel}</section>
    {mini && <div data-testid="mini"><SeferControlPanelMini controller={controller} /></div>}
    <section>{slot === 'bottom' && panel}</section>
    <output data-testid="state">{JSON.stringify(controller.currentVerse)}</output>
    <output data-testid="active">{String(controller.isActive)}</output>
    <input aria-label="Editing" /><textarea aria-label="Notes" />
  </>;
}
const tree = (props: HostProps) => <StrictMode><Host {...props} /></StrictMode>;
const current = (): SeferReaderState => JSON.parse(screen.getByTestId('state').textContent!);
const fullElement = (id: string) => screen.getByTestId('full').querySelector<HTMLElement>(`#${id}`)!;
const miniNext = () => within(screen.getByTestId('mini')).getByTitle('Versículo siguiente');
const ready = async (book = 'Colección Alfa') => waitFor(() => expect(current()?.bookEs).toBe(book));

beforeEach(() => { localStorage.clear(); fetchCorpus.mockClear(); vi.stubGlobal('fetch', fetchCorpus); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('loads the corpus once on first use and shares selection across both StrictMode widgets', async () => {
  const onProject = vi.fn();
  const props: HostProps = { keyboardMode: null, onProject, full: false, mini: false };
  const view = render(tree(props));
  expect(fetchCorpus).not.toHaveBeenCalled();
  view.rerender(tree({ ...props, keyboardMode: 'manual', full: true, mini: true }));
  await ready();
  expect(fetchCorpus.mock.calls.map(([url]) => String(url))).toEqual(['/metadata.json', '/books/alfa.tsv']);
  fireEvent.change(fullElement('sefer-verse-select'), { target: { value: '2' } });
  expect(current().verse).toBe('2');
  expect(within(screen.getByTestId('mini')).getByRole('button', { name: '2', exact: true }).className).toContain('bg-orange-500');
  expect(onProject).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByTestId('mini')).getByRole('button', { name: '3', exact: true }));
  expect((fullElement('sefer-verse-select') as HTMLSelectElement).value).toBe('3');
  expect(onProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ verse: '3' }), 'navigate');
  view.rerender(tree({ ...props, keyboardMode: 'manual', full: true, mini: true, slot: 'bottom' }));
  expect(current().verse).toBe('3');
  expect(fetchCorpus).toHaveBeenCalledTimes(2);
  expect(onProject).toHaveBeenCalledTimes(1);
});

it('preserves manual preview, compact automatic projection, activation and cross-chapter navigation', async () => {
  const onProject = vi.fn(), onDeactivate = vi.fn();
  render(tree({ keyboardMode: 'manual', onProject, onDeactivate }));
  await ready();
  fireEvent.click(fullElement('sefer-next-btn'));
  expect(current().verse).toBe('2');
  expect(onProject).not.toHaveBeenCalled();
  fireEvent.click(miniNext());
  expect(current().verse).toBe('3');
  expect(onProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ verse: '3' }), 'next');
  // Compact arrows project without changing the reader's activation flag.
  expect(screen.getByTestId('active').textContent).toBe('false');
  fireEvent.click(fullElement('sefer-activate-btn'));
  expect(onProject).toHaveBeenCalledTimes(2);
  expect(onProject.mock.calls[1]).toEqual([expect.objectContaining({ verse: '3' }), 'navigate']);
  fireEvent.click(fullElement('sefer-next-btn'));
  fireEvent.click(fullElement('sefer-next-btn'));
  expect(current()).toMatchObject({ chapter: '2', verse: '1' });
  expect(onProject).toHaveBeenCalledTimes(4);
  fireEvent.click(fullElement('sefer-activate-btn'));
  expect(onDeactivate).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('active').textContent).toBe('false');
  fireEvent.change(fullElement('sefer-chapter-select'), { target: { value: '1' } });
  expect(current()).toMatchObject({ chapter: '1', verse: '1' });
  expect(onProject).toHaveBeenCalledTimes(4);
});

it('retains a projected range and shared fonts while widgets hide, remount and move', async () => {
  const onProject = vi.fn(), onBoundaryReached = vi.fn(), onUpdateFontSizes = vi.fn();
  const props: HostProps = { keyboardMode: 'manual', onProject, onBoundaryReached, onUpdateFontSizes };
  const view = render(tree(props));
  await ready();
  const initialRequests = fetchCorpus.mock.calls.length;
  fireEvent.change(fullElement('sefer-verse-select'), { target: { value: '2' } });
  fireEvent.change(within(screen.getByTestId('full')).getByTitle('Versículo final opcional'), { target: { value: '4' } });
  fireEvent.click(fullElement('sefer-activate-btn'));
  expect(onProject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ verse: '2', verseStart: '2', verseEnd: '4', totalVerses: 3 }), 'navigate');
  fireEvent.click(within(screen.getByTestId('full')).getByTitle('Ajustar tamaños de letra'));
  fireEvent.click(within(screen.getByTestId('mini')).getByTitle('Ajustar tamaños de letra'));
  fireEvent.change(within(screen.getByTestId('full')).getAllByRole('slider')[0], { target: { value: '54' } });
  expect((within(screen.getByTestId('mini')).getAllByRole('slider')[0] as HTMLInputElement).value).toBe('54');
  expect(onUpdateFontSizes).toHaveBeenCalledExactlyOnceWith({ hebrewFontSize: 54, combinedTextBaseSize: 40 });
  view.rerender(tree({ ...props, full: false }));
  fireEvent.click(miniNext());
  expect(current()).toMatchObject({ verse: '3', verseStart: '2', verseEnd: '4' });
  expect(onProject).toHaveBeenCalledTimes(2);
  view.rerender(tree({ ...props, full: false, mini: false, keyboardMode: null }));
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(current().verse).toBe('3');
  expect(onProject).toHaveBeenCalledTimes(2);
  view.rerender(tree({ ...props, slot: 'bottom' }));
  expect((fullElement('sefer-verse-select') as HTMLSelectElement).value).toBe('3');
  expect(current()).toMatchObject({ verseStart: '2', verseEnd: '4' });
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(onProject).toHaveBeenCalledTimes(3);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(onProject).toHaveBeenCalledTimes(3);
  expect(onBoundaryReached).not.toHaveBeenCalled();
  view.rerender(tree({ ...props, keyboardMode: 'projected', slot: 'bottom' }));
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(onBoundaryReached).toHaveBeenCalledExactlyOnceWith('next');
  fireEvent.click(within(screen.getByTestId('mini')).getByTitle('Versículo anterior'));
  expect(current().verse).toBe('3');
  expect(onProject).toHaveBeenCalledTimes(4);
  expect(fetchCorpus).toHaveBeenCalledTimes(initialRequests);
});

it('keeps one active keyboard handler through StrictMode and releases it with its owner', async () => {
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
  const activeHandlers = () => {
    const active = new Set<EventListenerOrEventListenerObject>();
    const operations = [
      ...add.mock.calls.map((args, i) => ({ args, order: add.mock.invocationCallOrder[i], add: true })),
      ...remove.mock.calls.map((args, i) => ({ args, order: remove.mock.invocationCallOrder[i], add: false })),
    ].sort((a, b) => a.order - b.order);
    for (const operation of operations) if (operation.args[0] === 'keydown') {
      if (operation.add) active.add(operation.args[1]); else active.delete(operation.args[1]);
    }
    return active.size;
  };
  const onProject = vi.fn();
  const props: HostProps = { keyboardMode: 'projected', onProject };
  const view = render(tree(props));
  await ready();
  expect(activeHandlers()).toBe(1);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(current().verse).toBe('2');
  expect(onProject).toHaveBeenCalledTimes(1);
  for (const target of [screen.getByLabelText('Editing'), screen.getByLabelText('Notes'), fullElement('sefer-verse-select')]) {
    fireEvent.keyDown(target, { key: 'ArrowRight' });
  }
  expect(onProject).toHaveBeenCalledTimes(1);
  view.rerender(tree({ ...props, full: false, mini: false }));
  expect(activeHandlers()).toBe(1);
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  expect(current().verse).toBe('1');
  expect(onProject).toHaveBeenCalledTimes(2);
  view.rerender(tree({ ...props, keyboardMode: null }));
  expect(activeHandlers()).toBe(0);
  view.rerender(tree(props));
  expect(activeHandlers()).toBe(1);
  view.unmount();
  expect(activeHandlers()).toBe(0);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(onProject).toHaveBeenCalledTimes(2);
});

it('restores canonical state without projection and keeps the existing command/Audience wire path', async () => {
  const restoredState = {
    bookEs: 'Colección Beta', bookHeb: 'Beta', bookAbbrevEs: 'Beta', chapter: '1', verse: '2',
    verseStart: '2', verseEnd: '4', verseNikud: 'Texto 2', transliteration: '', translation: 'Beta 1:2',
    verseIdx: 0, totalVerses: 3, scriptureKind: 'tanaj' as const,
  };
  const onProject = vi.fn();
  render(tree({ keyboardMode: 'projected', restoredState, onProject }));
  await ready('Colección Beta');
  expect(onProject).not.toHaveBeenCalled();
  expect(within(screen.getByTestId('mini')).queryByTitle('Ajustar tamaños de letra')).toBeNull();
  fireEvent.click(miniNext());
  expect(onProject).toHaveBeenCalledTimes(1);
  const [state, navCommand] = onProject.mock.calls[0];
  const message = makeSyncMessage({ type: 'REMOTE_COMMAND', clientId: 'control-test', payload: { command: 'SCRIPTURE_PROJECT', state, navCommand } });
  const serialized = JSON.parse(JSON.stringify(message));
  expect(serialized.protocolVersion).toBe(1);
  expect(validateSyncMessage(serialized).ok).toBe(true);
  expect(serialized.payload).toEqual({ command: 'SCRIPTURE_PROJECT', state: JSON.parse(JSON.stringify(state)), navCommand: 'next' });
  const result = reduceProjectionCommand(getDefaultProjectionState(), serialized.payload, { clientId: 'control-test', now: 1000 });
  expect(result.ok).toBe(true);
  expect(result.state.scriptureState).toMatchObject({ verse: '3', verseStart: '2', verseEnd: '4', command: 'navigate', scriptureKind: 'tanaj' });
  const audience = makeAudienceSyncStateMessage(result.state);
  expect(validateSyncMessage(audience).ok).toBe(true);
  expect(audience.scriptureState).toEqual(result.state.scriptureState);
});

it('ignores a late corpus result after selection changes', async () => {
  let finishGamma: (response: Response) => void;
  const gamma = new Promise<Response>(resolve => { finishGamma = resolve; });
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).endsWith('/gamma.tsv') ? gamma : fetchCorpus(input)));
  const view = render(tree({ keyboardMode: 'manual', onProject: vi.fn() }));
  await ready();
  fireEvent.change(fullElement('sefer-book-select'), { target: { value: 'Colección Gamma' } });
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(fullElement('sefer-book-select'), { target: { value: 'Colección Beta' } });
  await ready('Colección Beta');
  await act(async () => { finishGamma(new Response(bookTsv('Gamma'))); });
  expect(current().bookEs).toBe('Colección Beta');
  view.unmount();
});
