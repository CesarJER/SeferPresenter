// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { useSyncState } from '../src/hooks/useSyncState';
import type { useLiveAudio } from '../src/features/liveAudio/hooks/useLiveAudio';
import type { useLiveAudioAvailability } from '../src/features/liveAudio/hooks/useLiveAudioAvailability';
import * as crypto from '../src/utils/cryptoUtils';

type Handler = (type: string, payload: Record<string, unknown>) => void;
const transport = vi.hoisted(() => ({
  options: null as Parameters<typeof useSyncState>[0] | null,
  send: vi.fn(() => true), subscribers: new Set<Handler>(), status: 'open' as 'open' | 'closed',
}));
const media = vi.hoisted(() => ({
  state: 'connected' as ReturnType<typeof useLiveAudio>['state'],
  availability: 'enabled' as ReturnType<typeof useLiveAudioAvailability>['availability'],
  revision: 0, failRender: false, published: false,
  publish: vi.fn(async () => {}), unpublish: vi.fn(async () => {}), listen: vi.fn(async () => {}), mount: vi.fn(),
}));
vi.mock('../src/hooks/useSyncState', () => ({ useSyncState: (options: Parameters<typeof useSyncState>[0]) => {
  transport.options = options;
  return { wsStatus: transport.status, wsSend: transport.send, subscribeToWsMessage: subscribe };
} }));
function subscribe(handler: Handler) {
  transport.subscribers.add(handler);
  return () => { transport.subscribers.delete(handler); };
}
vi.mock('../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({ useLiveAudioAvailability: () => ({ availability: media.availability, isLoading: false }) }));
vi.mock('../src/features/liveAudio/hooks/useLiveAudio', () => ({
  isMicrophonePublicationCancelled: () => false,
  useLiveAudio: () => {
    media.mount();
    if (media.failRender) throw new Error('Synthetic RTC render failure');
    return { state: media.state, connectionQuality: 'good', remoteTracks: [], sessionRevision: media.revision,
      isMicrophoneActive: media.published, microphoneTrackState: media.published ? 'published' : 'off', hasAudioStarted: false,
      startRemoteAudio: media.listen, publishMicrophone: media.publish, republishMicrophone: media.publish,
      unpublishMicrophone: media.unpublish, retryAudio: media.listen };
  },
}));
// Display and synchronized media are unrelated boundaries; owners, access and participation widgets are real.
vi.mock('../src/components/presenter/PresenterScreen', () => ({ default: (props: { liveAudioPanel?: React.ReactNode }) => <main>Slides{props.liveAudioPanel}</main> }));
vi.mock('../src/components/presenter/SeferReaderScreen', () => ({ default: (props: { liveAudioPanel?: React.ReactNode }) => <main>Scripture{props.liveAudioPanel}</main> }));
vi.mock('../src/components/quiz/QuizAudienceView', () => ({ QuizAudienceView: (props: { liveAudioPanel?: React.ReactNode }) => <main>Quiz{props.liveAudioPanel}</main> }));
vi.mock('../src/hooks/useAudienceAudioPlayback', () => ({ useAudienceAudioPlayback: () => {} }));
vi.mock('../src/hooks/useAudioTimelineApplicator', () => ({ useAudioTimelineApplicator: () => {} }));
vi.mock('../src/hooks/useQuizAudio', () => ({ useQuizAudio: () => {} }));
vi.mock('../src/utils/pwaUpdate', () => ({ registerScopedServiceWorker: async () => {} }));
vi.mock('../src/components/shared/BrandingWelcome', () => ({ BrandingWelcome: () => null }));

const participantId = '11111111-1111-4111-8111-111111111111';
let mode: 'PUBLIC' | 'CONTROLLED';
let key: CryptoKeyPair;
let App: typeof import('../src/main-audience')['AudienceApp'];
let build = 'true';
const emit = (type: string, payload: Record<string, unknown>) => act(() => {
  transport.options!.onWsMessage!(type, payload);
  for (const handler of [...transport.subscribers]) handler(type, payload);
});
const frames = (type: string) => (transport.send.mock.calls as unknown as Array<[string, Record<string, unknown>]>).filter(([name]) => name === type).map(([, payload]) => payload);
const bind = async (state = mode === 'PUBLIC' ? 'ADMITTED' : 'REQUEST_REQUIRED') => {
  act(() => transport.options!.onAudienceWsConnectionChange!('open'));
  emit('AUDIENCE_ACCESS_STATE', { participantId, presentationSessionId: 'session-a', accessMode: mode, accessState: state });
  emit('LIVE_AUDIO_CONTROL_PUBLIC_KEY', { keyId: 'control-key', publicKey: await crypto.exportPublicKey(key) });
};
const decryptFrame = async (frame: Record<string, unknown>) => {
  const shared = await crypto.deriveSharedKey(key.privateKey, await crypto.importPublicKey(frame.ephemeralPublicKey as string));
  return JSON.parse(await crypto.decrypt(shared, frame.ciphertext as string, frame.nonce as string));
};
const privateValues = async () => Promise.all(frames('PRIVATE_CONTROL_SIGNAL').map(decryptFrame));
const waitForPrivate = (type: string) => waitFor(async () => expect((await privateValues()).some(value => value.type === type)).toBe(true));

async function start(options: { build?: string; failLoad?: boolean; strict?: boolean } = {}) {
  build = options.build ?? 'true';
  vi.stubEnv('VITE_SEFER_LIVE_AUDIO_BUILD', build);
  if (options.failLoad) vi.doMock('../src/features/liveAudio/components/audience/LiveAudioAudienceContainer', () => { throw new Error('Synthetic chunk failure'); });
  App = (await import('../src/main-audience')).AudienceApp;
  const view = render(options.strict ? <StrictMode><App /></StrictMode> : <App />);
  await waitFor(() => expect(transport.options!.audienceAccessCredential).toBe('synthetic-credential'));
  await bind();
  if (mode === 'PUBLIC') await waitFor(() => expect((screen.getByRole('button', { name: 'Participa' }) as HTMLButtonElement).disabled).toBe(false));
  return view;
}

async function activate() {
  if (mode === 'PUBLIC') fireEvent.click(screen.getByRole('button', { name: 'Participa' }));
  await screen.findByRole('region', { name: 'Información básica de protección de datos' }).catch(() => screen.findByText('Synthetic legal information'));
  for (const checkbox of screen.getAllByRole('checkbox')) if (!(checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('radio', { name: 'Tengo 14 años o más.' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Alias temporal' }), { target: { value: 'Synthetic Alias' } });
  const submitName = mode === 'CONTROLLED' ? 'Solicitar acceso' : 'Continuar';
  await waitFor(() => expect((screen.getByRole('button', { name: submitName }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: submitName }));
  if (mode === 'CONTROLLED') {
    await waitForPrivate('ACCESS_REQUEST');
    await waitFor(() => expect(frames('AUDIENCE_ACCESS_REQUEST')).toHaveLength(1));
    emit('AUDIENCE_ACCESS_STATE', { participantId, presentationSessionId: 'session-a', accessMode: mode, accessState: 'ADMITTED' });
  }
  await screen.findByRole('button', { name: 'Pedir Palabra' });
  await waitForPrivate('ACTIVE_PROFILE');
}

async function sendAndReply(text = 'Synthetic private message') {
  fireEvent.click(screen.getByRole('button', { name: 'Mensaje Privado a Control' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensaje privado para Control' }), { target: { value: text } });
  fireEvent.submit(document.getElementById('message-form')!);
  await waitForPrivate('PRIVATE_MESSAGE');
  const values = await privateValues();
  expect(values.some(value => value.type === 'PRIVATE_MESSAGE' && value.text === text)).toBe(true);
  expect(JSON.stringify(frames('PRIVATE_CONTROL_SIGNAL'))).not.toContain(text);
  const frame = frames('PRIVATE_CONTROL_SIGNAL').at(-1)!;
  const shared = await crypto.deriveSharedKey(key.privateKey, await crypto.importPublicKey(frame.ephemeralPublicKey as string));
  const encrypted = await crypto.encrypt(shared, JSON.stringify({ type: 'CHAT_RESPONSE', text: 'Encrypted Control reply', senderNick: 'Control team' }));
  emit('PRIVATE_CONTROL_SIGNAL', { fromParticipantId: 'control-a', toParticipantId: participantId,
    keyId: 'control-key', ephemeralPublicKey: await crypto.exportPublicKey(key), ...encrypted });
  await screen.findByText('"Encrypted Control reply"');
}

beforeEach(async () => {
  vi.resetModules();
  vi.doUnmock('../src/features/liveAudio/components/audience/LiveAudioAudienceContainer');
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('EventSource', class { close() {} addEventListener() {} removeEventListener() {} });
  localStorage.clear(); sessionStorage.clear(); transport.subscribers.clear(); transport.status = 'open';
  window.history.replaceState(null, '', '/audience');
  mode = 'PUBLIC'; media.state = 'connected'; media.availability = 'enabled'; media.failRender = false; media.revision = 0; media.published = false;
  key = await crypto.generateSessionKeyPair();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true,
    text: async () => 'Synthetic legal information',
    json: async () => url.includes('sse-ticket') ? { ticket: 'synthetic-ticket' }
      : url.includes('bootstrap') ? { presentationSessionId: 'session-a', participantId, credential: 'synthetic-credential', accessMode: mode, accessState: mode === 'PUBLIC' ? 'ADMITTED' : 'REQUEST_REQUIRED' } : {},
  } as Response)));
});
afterEach(() => { cleanup(); expect(transport.subscribers.size).toBe(0); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const cases = ['enabled', 'disabled', 'misconfigured', 'unsupported', 'reconnectFailed', 'loadFailure', 'renderFailure', 'buildFalse'] as const;
it.each(cases.flatMap(rtc => (['PUBLIC', 'CONTROLLED'] as const).map(accessMode => ({ rtc, accessMode }))))(
  'keeps actual AudienceApp social widgets and E2EE operational: $accessMode / $rtc', async ({ rtc, accessMode }) => {
    mode = accessMode;
    if (rtc === 'disabled' || rtc === 'misconfigured' || rtc === 'unsupported') { media.availability = rtc; media.state = 'unavailable'; }
    if (rtc === 'reconnectFailed') media.state = 'reconnectFailed';
    if (rtc === 'renderFailure') media.failRender = true;
    await start({ build: rtc === 'buildFalse' ? 'false' : 'true', failLoad: rtc === 'loadFailure' });
    await activate();
    fireEvent.click(screen.getByRole('button', { name: 'Pedir Palabra' }));
    await waitForPrivate('REQUEST_WORD');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar Petición' }));
    await waitForPrivate('CANCEL_REQUEST_WORD');
    await sendAndReply();
    if (rtc !== 'enabled') expect(screen.queryByRole('button', { name: 'Activar Micrófono' })).toBeNull();
    if (rtc === 'buildFalse') expect(media.mount).not.toHaveBeenCalled();
    expect(media.publish).not.toHaveBeenCalled();
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).includes('/livekit/'))).toBe(false);
    expect(frames('LIVE_AUDIO_PARTICIPANT_STATUS').every(frame => frame.participantId === participantId)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Salir del Modo Activo' }));
    expect(frames('AUDIENCE_ACCESS_LEAVE')).toHaveLength(1);
  }, 15000,
);

it('keeps one owner across Scripture/slides/quiz/blank, hidden/reopened panels and StrictMode', async () => {
  await start({ build: 'false', strict: true });
  await activate(); await sendAndReply();
  const firstKey = frames('PRIVATE_CONTROL_SIGNAL')[0].ephemeralPublicKey;
  const listeners = transport.subscribers.size;
  act(() => {
    transport.options!.setScriptureState!({ scriptureKind: 'sefer', bookEs: 'Synthetic', bookHeb: '', bookAbbrevEs: 'Gen', chapter: '1', verse: '1', verseStart: '1', verseNikud: '', translation: '', transliteration: '', verseIdx: 0, totalVerses: 1 });
    transport.options!.setAppMode!('seferManual');
  });
  await screen.findByText('Scripture');
  act(() => {
    transport.options!.setAppMode!('slides');
    transport.options!.setCurrentPresentation!({ id: 'synthetic', title: 'Synthetic', slides: [{ id: 'quiz-a', type: 'quiz', label: '', lines: [], quizData: { timerSeconds: 30, options: [], question: '', randomize: false, multiSelect: false } }] } as Parameters<NonNullable<typeof transport.options>['setCurrentPresentation']>[0]);
    transport.options!.setCurrentSlideIndex!(0);
  });
  await screen.findByText('Quiz');
  expect(screen.getByText('"Encrypted Control reply"')).toBeTruthy();
  fireEvent.click(document.body);
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar controles de participación' }));
  expect(screen.getAllByRole('button', { name: 'Mensaje Privado a Control' })).toHaveLength(1);
  act(() => transport.options!.setCurrentPresentation!(null));
  await screen.findByText('Slides');
  expect(screen.getAllByRole('button', { name: 'Mensaje Privado a Control' })).toHaveLength(1);
  expect(transport.subscribers.size).toBe(listeners);
  fireEvent.click(screen.getByRole('button', { name: 'Pedir Palabra' }));
  await waitForPrivate('REQUEST_WORD');
  expect(frames('PRIVATE_CONTROL_SIGNAL').every(frame => frame.ephemeralPublicKey === firstKey)).toBe(true);
});

it('does not enable media from a grant without RTC and keeps permitted lists private', async () => {
  await start({ build: 'false' }); await activate();
  emit('LIVE_AUDIO_GRANT_SPEAK', { participantId });
  expect(screen.queryByRole('button', { name: 'Activar Micrófono' })).toBeNull();
  expect(frames('LIVE_AUDIO_PARTICIPANT_STATUS').at(-1)?.canPublishAudio).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Participantes' }));
  emit('LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION', { participantId, canViewActiveParticipants: true });
  const publicKey = frames('PRIVATE_CONTROL_SIGNAL')[0].ephemeralPublicKey as string;
  const shared = await crypto.deriveSharedKey(key.privateKey, await crypto.importPublicKey(publicKey));
  const encrypted = await crypto.encrypt(shared, JSON.stringify({ type: 'VISIBLE_ACTIVE_PARTICIPANTS', participants: ['משתתף synthetic'] }));
  emit('PRIVATE_CONTROL_SIGNAL', { fromParticipantId: 'control-a', toParticipantId: participantId, keyId: 'control-key', ephemeralPublicKey: await crypto.exportPublicKey(key), ...encrypted });
  await screen.findByText('משתתף synthetic');
  emit('LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION', { participantId, canViewActiveParticipants: false });
  expect(screen.queryByText('משתתף synthetic')).toBeNull();
  const checkbox = screen.getByRole('checkbox', { name: 'Mostrar mi alias a otros participantes' });
  fireEvent.click(checkbox);
  await waitFor(() => expect(frames('LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE').at(-1)?.isAliasVisibleToActiveParticipants).toBe(true));
  expect(JSON.stringify(frames('LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE'))).not.toContain('Synthetic Alias');
});

it('retains social history through a mounted RTC render failure and cleans only media listeners', async () => {
  const view = await start(); await activate(); await sendAndReply();
  await waitFor(() => expect(media.mount).toHaveBeenCalled());
  const listeners = transport.subscribers.size;
  const audienceKey = frames('PRIVATE_CONTROL_SIGNAL')[0].ephemeralPublicKey;
  media.failRender = true;
  view.rerender(<App />);
  await waitFor(() => expect(transport.subscribers.size).toBe(listeners - 1));
  expect(screen.getByText('"Encrypted Control reply"')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Escuchar en vivo' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Pedir Palabra' }));
  await waitForPrivate('REQUEST_WORD');
  expect(frames('PRIVATE_CONTROL_SIGNAL').at(-1)?.ephemeralPublicKey).toBe(audienceKey);
});

it('preserves explicit capture, media moderation and sessionRevision permission resets', async () => {
  const view = await start(); await activate();
  await waitFor(() => expect(media.mount).toHaveBeenCalled());
  const unpublishCount = () => media.unpublish.mock.calls.length;
  emit('LIVE_AUDIO_GRANT_SPEAK', { participantId });
  expect(media.publish).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'Activar Micrófono' }));
  expect(media.publish).toHaveBeenCalledTimes(1);
  media.published = true;
  view.rerender(<App />);
  await waitFor(() => expect(frames('LIVE_AUDIO_PARTICIPANT_STATUS').at(-1)?.isMicrophoneActive).toBe(true));
  for (const type of ['LIVE_AUDIO_MUTE_PARTICIPANT', 'LIVE_AUDIO_MUTE_ALL', 'LIVE_AUDIO_REVOKE_SPEAK', 'LIVE_AUDIO_RESCUE_PARTICIPANT']) {
    const before = unpublishCount();
    emit(type, { participantId });
    expect(unpublishCount()).toBeGreaterThan(before);
    expect(media.publish).toHaveBeenCalledTimes(1);
    if (type === 'LIVE_AUDIO_REVOKE_SPEAK') {
      expect(frames('LIVE_AUDIO_PARTICIPANT_STATUS').at(-1)?.isMicrophoneActive).toBe(false);
      expect(frames('LIVE_AUDIO_PARTICIPANT_STATUS').at(-1)?.microphoneTrackState).toBe('off');
    }
  }
  media.published = false;
  emit('LIVE_AUDIO_GRANT_SPEAK', { participantId });
  media.revision = 1;
  view.rerender(<App />);
  await screen.findByRole('button', { name: 'Pedir Palabra' });
  expect(screen.queryByRole('button', { name: 'Activar Micrófono' })).toBeNull();
  const before = unpublishCount();
  emit('LIVE_AUDIO_KICK_PARTICIPANT', { participantId });
  expect(unpublishCount()).toBeGreaterThan(before);
  expect((screen.getByRole('button', { name: 'Participa' }) as HTMLButtonElement).disabled).toBe(true);
  emit('LIVE_AUDIO_RESCUE_PARTICIPANT', { participantId });
  expect(media.publish).toHaveBeenCalledTimes(1);
});

it.each(['closedWs', 'missingWebCrypto'] as const)('shows unavailable participation and sends no plaintext with %s', async failure => {
  await start({ build: 'false' }); await activate();
  transport.send.mockClear();
  if (failure === 'closedWs') act(() => transport.options!.onAudienceWsConnectionChange!('closed'));
  else {
    vi.stubGlobal('crypto', undefined);
    emit('CONTROL_KEY_ROTATED', { keyId: 'unavailable-key', publicKey: await crypto.exportPublicKey(key).catch(() => '') });
  }
  // Force the application to reflect the transport/crypto boundary without replacing its owner.
  if (failure === 'closedWs') {
    transport.status = 'closed';
    act(() => transport.options!.setBackgroundLock!(true));
  }
  await waitFor(() => expect((screen.getByRole('button', { name: 'Mensaje Privado a Control' }) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByText('Participación segura no disponible. Comprueba la conexión y el cifrado.')).toBeTruthy();
  expect(frames('PRIVATE_CONTROL_SIGNAL')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Salir del Modo Activo' }));
  expect(localStorage.getItem('sefer-audience-identity')).toBeNull();
  if (failure === 'closedWs') expect(frames('AUDIENCE_ACCESS_LEAVE')).toHaveLength(0);
});

it('keeps TV passive while retaining the optional listener adapter', async () => {
  window.history.replaceState(null, '', '/audience?tv=1');
  vi.stubEnv('VITE_SEFER_LIVE_AUDIO_BUILD', 'true');
  App = (await import('../src/main-audience')).AudienceApp;
  render(<App />);
  await waitFor(() => expect(transport.options!.audienceAccessCredential).toBe('synthetic-credential'));
  await bind();
  await waitFor(() => expect(media.mount).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Participa' })).toBeNull();
  expect(media.publish).not.toHaveBeenCalled();
});
