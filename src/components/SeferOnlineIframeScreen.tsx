import { useCallback, useEffect, useRef } from 'react';
import type { FC } from 'react';
import type { ScriptureNavState } from '../App';

export type SeferOnlineRefPayload = {
  book?: string;
  chapter?: number | string;
  verse?: number | string;
  bookEs?: string;
  bookHeb?: string;
  bookAbbrevEs?: string;
  verseNikud?: string;
  transliteration?: string;
  translation?: string;
  verseIdx?: number;
  totalVerses?: number;
};

interface SeferOnlineIframeScreenProps {
  scriptureState: ScriptureNavState;
  onVerseChanged?: (payload: SeferOnlineRefPayload) => void;
  onVerseSelected?: (payload: SeferOnlineRefPayload) => void;
}

type SeferIframeMessage = {
  type?: string;
  payload?: unknown;
};

const OUTGOING_NAVIGATE_TYPE = 'SEFER_NAVIGATE';
const OUTGOING_NEXT_TYPE = 'SEFER_NEXT_VERSE';
const OUTGOING_PREVIOUS_TYPE = 'SEFER_PREVIOUS_VERSE';
const INCOMING_TYPES = new Set([
  'SEFER_READY',
  'SEFER_VERSE_CHANGED',
  'SEFER_VERSE_SELECTED',
]);

const isSeferMessage = (value: unknown): value is SeferIframeMessage => (
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SeferIframeMessage).type === 'string' &&
  INCOMING_TYPES.has((value as SeferIframeMessage).type ?? '')
);

const asPayload = (value: unknown): SeferOnlineRefPayload => (
  typeof value === 'object' && value !== null ? value as SeferOnlineRefPayload : {}
);

const buildEmbedUrl = (baseUrl: string, scriptureState: ScriptureNavState) => {
  const separator = baseUrl.includes('?') ? '&' : '?';
  const book = encodeURIComponent(scriptureState.bookAbbrevEs || scriptureState.bookEs || 'Gn');
  const chapter = encodeURIComponent(scriptureState.chapter || '1');
  const verse = encodeURIComponent(scriptureState.verse || '1');
  return `${baseUrl}${separator}embed=presenter#/${book}/${chapter}/${verse}`;
};

const toNavPayload = (scriptureState: ScriptureNavState) => ({
  book: scriptureState.bookAbbrevEs || scriptureState.bookEs,
  chapter: Number(scriptureState.chapter),
  verse: Number(scriptureState.verse),
});

const toCommandType = (command: ScriptureNavState['command']) => {
  if (command === 'next') return OUTGOING_NEXT_TYPE;
  if (command === 'previous') return OUTGOING_PREVIOUS_TYPE;
  return OUTGOING_NAVIGATE_TYPE;
};

const refKey = (payload: SeferOnlineRefPayload | ScriptureNavState) => {
  const book = payload.bookAbbrevEs || ('book' in payload ? payload.book : '');
  return `${book}|${payload.chapter ?? ''}|${payload.verse ?? ''}`;
};

const SeferOnlineIframeScreen: FC<SeferOnlineIframeScreenProps> = ({
  scriptureState,
  onVerseChanged,
  onVerseSelected,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const isReadyRef = useRef(false);
  const pendingMessageRef = useRef<{ type: string; payload?: ReturnType<typeof toNavPayload> } | null>(null);
  const lastIframeRefKey = useRef('');
  const baseUrl = import.meta.env.VITE_SEFER_ONLINE_URL ?? '/sefer-online/index.html';
  const initialSrcRef = useRef(buildEmbedUrl(baseUrl, scriptureState));

  const postCommand = useCallback((type: string, payload: ReturnType<typeof toNavPayload>) => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow || !isReadyRef.current) {
      pendingMessageRef.current = { type: OUTGOING_NAVIGATE_TYPE, payload };
      return;
    }

    targetWindow.postMessage(
      type === OUTGOING_NAVIGATE_TYPE ? { type, payload } : { type },
      '*'
    );
  }, []);

  useEffect(() => {
    const nextPayload = toNavPayload(scriptureState);
    const commandType = toCommandType(scriptureState.command);
    const nextKey = refKey({
      bookAbbrevEs: nextPayload.book,
      chapter: nextPayload.chapter,
      verse: nextPayload.verse,
    });

    if (commandType === OUTGOING_NAVIGATE_TYPE && nextKey === lastIframeRefKey.current) return;
    postCommand(commandType, nextPayload);
  }, [postCommand, scriptureState]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || !isSeferMessage(event.data)) return;

      const payload = asPayload(event.data.payload);

      if (event.data.type === 'SEFER_READY') {
        isReadyRef.current = true;
        if (Object.keys(payload).length > 0) {
          lastIframeRefKey.current = refKey(payload);
          onVerseChanged?.(payload);
        }

        const pendingMessage = pendingMessageRef.current;
        if (pendingMessage) {
          pendingMessageRef.current = null;
          iframeRef.current?.contentWindow?.postMessage(
            pendingMessage,
            '*'
          );
        }
        return;
      }

      if (event.data.type === 'SEFER_VERSE_CHANGED') {
        lastIframeRefKey.current = refKey(payload);
        onVerseChanged?.(payload);
        return;
      }

      if (event.data.type === 'SEFER_VERSE_SELECTED') {
        lastIframeRefKey.current = refKey(payload);
        onVerseSelected?.(payload);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onVerseChanged, onVerseSelected]);

  return (
    <iframe
      ref={iframeRef}
      title="SeferOnline"
      src={initialSrcRef.current}
      className="h-full w-full border-0 bg-[#fef3c7]"
      allow="fullscreen"
    />
  );
};

export default SeferOnlineIframeScreen;
