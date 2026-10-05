// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SeferReaderScreen from '../src/components/presenter/SeferReaderScreen';
import { useScriptureNavigation } from '../src/hooks/useScriptureNavigation';
import type { ScriptureNavState } from '../src/types/presentation';

vi.mock('../src/utils/metadataCache', () => ({
  getMetadata: async () => ({ Génesis: {} }), resolveBookName: () => 'Génesis',
  loadBookData: async () => [1, 2, 3].map(v => ({ bookEs: 'Génesis', bookHeb: '', bookAbbrevEs: 'Gn',
    chapter: '1', verse: String(v), verseNikud: `Hebreo ${v}`, transliteration: '', translation: `Contenido ${v}` })),
}));
vi.mock('../src/components/presenter/VerseSidebar', () => ({ VerseSidebar: ({ combinedText, navLabel }: { combinedText: string; navLabel: string }) => <div>{navLabel}<div dangerouslySetInnerHTML={{ __html: combinedText }} /></div> }));
vi.mock('../src/components/presenter/SeferFlowView', () => ({ SeferFlowView: () => null }));
vi.mock('../src/components/shared/AutoResizeText', () => ({ default: () => null }));
afterEach(cleanup);
const state = (verse: string, command: ScriptureNavState['command'] = 'navigate'): ScriptureNavState => ({
  bookEs: 'Génesis', bookHeb: '', bookAbbrevEs: 'Gn', chapter: '1', verse, verseStart: verse,
  verseNikud: '', translation: '', transliteration: '', verseIdx: Number(verse) - 1, totalVerses: 3,
  command, commandId: Number(verse),
});
it('keeps Audience reference and content together without reapplying directional commands', async () => {
  const onVerseSelected = vi.fn();
  const view = render(<SeferReaderScreen scriptureState={state('1')} interactive={false} onVerseSelected={onVerseSelected} />);
  await screen.findByText('Contenido 1');
  view.rerender(<SeferReaderScreen scriptureState={state('2', 'next')} interactive={false} onVerseSelected={onVerseSelected} />);
  await screen.findByText('Contenido 2');
  expect(screen.getByText('Génesis 1:2')).toBeTruthy();
  expect(screen.queryByText('Contenido 3')).toBeNull();
  expect(onVerseSelected).not.toHaveBeenCalled();
  view.rerender(<SeferReaderScreen scriptureState={state('1', 'previous')} interactive={false} onVerseSelected={onVerseSelected} />);
  await screen.findByText('Contenido 1');
});
it('resolves a directional request only once under StrictMode', async () => {
  const onVerseSelected = vi.fn();
  render(<StrictMode><SeferReaderScreen scriptureState={state('1', 'next')} onVerseSelected={onVerseSelected} /></StrictMode>);
  await waitFor(() => expect(onVerseSelected).toHaveBeenCalledTimes(1));
  expect(onVerseSelected.mock.calls[0][0]).toMatchObject({ verse: 2, translation: 'Contenido 2' });
});

it('publishes the resolved Presenter verse as an absolute projection', () => {
  const ref = <T,>(current: T) => ({ current });
  const syncState = vi.fn();
  const { result } = renderHook(() => useScriptureNavigation({
    isControlMode: false, currentPresentationRef: ref(null), currentSlideIndexRef: ref(0),
    backgroundLockRef: ref(false), lockedBackgroundValueRef: ref(null), userSelectedBackgroundRef: ref(null),
    videoStateRef: ref(null), appModeRef: ref('scripture'), scriptureStateRef: ref(null),
    setAppMode: vi.fn(), setScriptureState: vi.fn(), syncState,
    handleSelectPresentationAndSlide: vi.fn(), handleSave: vi.fn(), steps: [],
    currentStepIndex: 0, setCurrentStepIndex: vi.fn(), slideScriptureStateBeforeManualRef: ref(null),
  }));
  act(() => result.current.handleProjectScripture({
    ...state('2'), verseNikud: 'Hebreo 2', translation: 'Contenido 2', scriptureKind: 'sefer',
  }));
  expect(syncState).toHaveBeenCalledWith(expect.objectContaining({
    scriptureState: expect.objectContaining({ verse: '2', translation: 'Contenido 2', command: 'navigate' }),
  }));
});
