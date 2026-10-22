// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { StrictMode, useCallback, useEffect } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWebSocketController, type WebSocketAdapter } from '../src/hooks/useWebSocket';
import { usePrivateControlSignals, type PrivateControlSignalsState, type DecryptedPrivateControlSignal } from '../src/hooks/usePrivateControlSignals';
import * as cryptoUtils from '../src/utils/cryptoUtils';
import Container from '../src/components/control/ControlParticipationOwner';
import { useAudienceAccess } from '../src/hooks/useAudienceAccess';
import { useAudienceSession } from '../src/hooks/useAudienceSession';
import { AudienceParticipationContext, useAudienceParticipationOwner } from '../src/hooks/useAudienceParticipation';
import { AudienceParticipationPanel } from '../src/components/audience/AudienceParticipationPanel';
import { PrivateControlInbox } from '../src/features/liveAudio/components/control/PrivateControlInbox';
import { useControlConversations } from '../src/hooks/useControlConversations';

const observed = vi.hoisted(() => ({
  signals: new Map<string, PrivateControlSignalsState>(),
  decrypted: new Map<string, DecryptedPrivateControlSignal[]>(),
  handlers: new Map<string, (signal: DecryptedPrivateControlSignal) => void>(),
  rejectSync: false,
  rejectAudience: false,
  audienceDispatches: [] as Promise<boolean>[],
  controlsDispatches: [] as Promise<boolean>[],
}));
vi.mock('../src/hooks/usePrivateControlSignals', async importOriginal => {
  const original = await importOriginal<typeof import('../src/hooks/usePrivateControlSignals')>();
  return { ...original, usePrivateControlSignals: (options: Parameters<typeof original.usePrivateControlSignals>[0]) => {
    const id = options.controlSessionId ?? 'audience';
    observed.handlers.set(id, options.onPrivateSignal!);
    const state = original.usePrivateControlSignals({ ...options, onPrivateSignal: signal => {
      observed.decrypted.set(id, [...(observed.decrypted.get(id) || []), signal]);
      options.onPrivateSignal?.(signal);
    } });
    const { sendPrivateSignalToParticipant, sendPrivateSignalToControls } = state;
    const audienceSend = useCallback((...args: Parameters<typeof sendPrivateSignalToParticipant>) => {
      const result = observed.rejectAudience ? Promise.reject<boolean>(new Error('Synthetic Audience failure')) : sendPrivateSignalToParticipant(...args);
      observed.audienceDispatches.push(result); return result;
    }, [sendPrivateSignalToParticipant]);
    const controlsSend = useCallback((...args: Parameters<typeof sendPrivateSignalToControls>) => {
      const result = observed.rejectSync ? Promise.reject<boolean>(new Error('Synthetic sync failure')) : sendPrivateSignalToControls(...args);
      observed.controlsDispatches.push(result); return result;
    }, [sendPrivateSignalToControls]);
    const result = { ...state, sendPrivateSignalToParticipant: audienceSend, sendPrivateSignalToControls: controlsSend };
    observed.signals.set(id, result);
    return result;
  } };
});
vi.mock('../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({ useLiveAudioAvailability: () => ({ availability: 'disabled' }) }));
vi.mock('../src/features/liveAudio/hooks/useLiveAudio', () => ({ useLiveAudio: () => ({
  state: 'unavailable', participantId: null, remoteTracks: [], controlParticipants: [],
  isMicrophoneActive: false, microphoneTrackState: 'off', unpublishMicrophone: vi.fn(),
}) }));
vi.mock('../src/components/shared/PwaRestartButton', () => ({ PwaRestartButton: () => null }));
vi.mock('../src/features/liveAudio/components/control/AudioDeviceSettings', () => ({ AudioDeviceSettings: () => null }));

type Frame = Record<string, unknown> & { type: string };
const audienceId = '11111111-1111-4111-8111-111111111111';
const sockets: WireSocket[] = [];
const controllers: ReturnType<typeof createWebSocketController>[] = [];
let keyFrame: Frame | undefined;
let failAudience = false;
let failControls = false;
let holdControls = false;

// In-memory routing exercises the real serializer and crypto; server authorization is tested separately.
class WireSocket implements WebSocketAdapter {
  readyState = 1;
  onopen = null;
  onclose = null;
  onerror = null;
  onmessage: WebSocketAdapter['onmessage'] = null;
  sent: string[] = [];
  received: Frame[] = [];
  authorized: boolean;
  constructor(readonly id: string) { this.authorized = id === 'A'; sockets.push(this); }
  close() { this.readyState = 3; }
  receive(frame: Frame) { this.received.push(frame); this.onmessage?.({ data: JSON.stringify(frame) }); }
  send(raw: string) {
    this.sent.push(raw);
    const frame = JSON.parse(raw) as Frame;
    if (frame.type === 'PRIVATE_CONTROL_SIGNAL') {
      if ((frame.toParticipantId && failAudience) || (!frame.toParticipantId && failControls)) throw new Error('Synthetic transport failure');
      if (!frame.toParticipantId && holdControls && this.id !== 'audience') return;
      for (const socket of sockets) {
        if (frame.toParticipantId ? socket.id === 'audience' : socket.id !== 'audience' && socket.authorized) socket.receive(frame);
      }
    } else if (frame.type === 'LIVE_AUDIO_CONTROL_PUBLIC_KEY') {
      keyFrame = frame;
      sockets.find(socket => socket.id === 'audience')?.receive(frame);
    } else if (frame.type === 'LIVE_AUDIO_CONTROL_AUTHORIZED') {
      sockets.find(socket => socket.id === frame.controlSessionId)?.receive(frame);
    } else if (frame.type === 'CONTROL_KEY_ROTATED') {
      keyFrame = frame;
      for (const socket of sockets) socket.receive(frame);
    } else if (frame.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' || frame.type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE') {
      for (const socket of sockets) if (socket.authorized) socket.receive({ ...frame, ...(frame.type === 'LIVE_AUDIO_PARTICIPANT_STATUS' ? { connected: true } : {}) });
    } else if (frame.type === 'LIVE_AUDIO_REQUEST_ALIASES') {
      sockets.find(socket => socket.id === 'audience')?.receive(frame);
    }
  }
}

const client = (id: string) => {
  const subscribers = new Set<(type: string, payload: Record<string, unknown>) => void>();
  const controller = createWebSocketController({ url: id, WebSocketCtor: WireSocket,
    onMessage: (type, payload) => subscribers.forEach(handler => handler(type, payload)),
  });
  controllers.push(controller);
  const socket = sockets.at(-1)!;
  return { socket, send: controller.sendMessage, subscribe: (handler: (type: string, payload: Record<string, unknown>) => void) => {
    subscribers.add(handler);
    if (id === 'audience' && keyFrame) handler(keyFrame.type, keyFrame);
    return () => { subscribers.delete(handler); };
  } };
};
type Client = ReturnType<typeof client>;
function Audience({ connection }: { connection: Client }) {
  usePrivateControlSignals({ role: 'audience', participantId: audienceId, controlSessionId: 'audience',
    transportReady: true, sendMessage: connection.send, subscribeToWsMessage: connection.subscribe });
  return null;
}
const control = (id: string, connection: Client, authorized = false) => <Container
  presentationSessionId="session-a"
  controlSessionId={id} controlState={id === 'A' ? 'PRINCIPAL' : authorized ? 'AUTHORIZED' : 'PENDING'}
  isControlAuthorized={id === 'A' || authorized} wsStatus="open" wsSend={connection.send} subscribeToWsMessage={connection.subscribe}
/>;
const signalState = (id: string) => observed.signals.get(id)!;

let socialOwner: ReturnType<typeof useAudienceParticipationOwner>;
let socialAccess: ReturnType<typeof useAudienceAccess>;
function AudienceSocial({ connection }: { connection: Client }) {
  const access = useAudienceAccess();
  const audienceSession = useAudienceSession({ subscribeToWsMessage: connection.subscribe });
  const owner = useAudienceParticipationOwner({ access, audienceSession, wsStatus: 'open',
    wsSend: connection.send, subscribeToWsMessage: connection.subscribe });
  useEffect(() => { socialOwner = owner; socialAccess = access; }, [owner, access]);
  useEffect(() => connection.subscribe(access.handleWsMessage), [connection, access.handleWsMessage]);
  return <AudienceParticipationContext.Provider value={owner}><AudienceParticipationPanel /></AudienceParticipationContext.Provider>;
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  localStorage.setItem('sefer_control_operator_nick', 'Private Operator');
  sockets.length = 0; controllers.length = 0; keyFrame = undefined;
  failAudience = false; failControls = false; holdControls = false;
  observed.signals.clear(); observed.decrypted.clear(); observed.handlers.clear(); observed.rejectSync = false; observed.rejectAudience = false;
  observed.audienceDispatches = [];
  observed.controlsDispatches = [];
  const host = document.createElement('div'); host.id = 'live-audio-inbox-portal-target'; document.body.append(host);
});
afterEach(() => { cleanup(); controllers.forEach(controller => controller.cleanup()); document.getElementById('live-audio-inbox-portal-target')?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const setup = async (strict = false) => {
  const a = client('A'), b = client('B'), pending = client('pending'), audience = client('audience');
  const wrap = (element: React.ReactNode) => strict ? <StrictMode>{element}</StrictMode> : element;
  render(wrap(control('A', a)));
  const viewB = render(wrap(control('B', b)));
  render(wrap(control('pending', pending)));
  render(wrap(<Audience connection={audience} />));
  await waitFor(() => expect(signalState('audience').ready).toBe(true));
  await act(async () => {
    await signalState('B').requestControlAuthorization('123456');
    const request = JSON.parse(b.socket.sent.find(raw => JSON.parse(raw).type === 'LIVE_AUDIO_CONTROL_JOIN_REQUEST')!);
    await signalState('A').authorizeSecondaryControl(request);
  });
  b.socket.authorized = true;
  viewB.rerender(wrap(control('B', b, true)));
  await waitFor(() => expect(signalState('B').ready).toBe(true));
  await waitFor(() => expect(observed.decrypted.get('B')?.some(signal => (signal.value as Frame).type === 'CONTROL_PROFILE')).toBe(true));
  a.socket.sent = []; b.socket.sent = [];
  fireEvent.click(screen.getAllByTitle('Bandeja Privada')[0]);
  fireEvent.click(screen.getAllByTitle('Bandeja Privada')[1]);
  const inboxes = screen.getAllByText('Notificaciones').map(node => node.closest('.fixed') as HTMLElement);
  const send = async (text: string) => {
    await act(async () => { expect(await signalState('audience').sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text, alias: 'Private Alias' })).toBe(true); });
    await waitFor(() => expect(within(inboxes[1]).getByText(`"${text}"`)).toBeTruthy());
  };
  await send('first question');
  const card = (index: number, text = 'first question') => within(inboxes[index]).getByText(`"${text}"`).parentElement!;
  const reply = async (text = 'Confidential answer', question = 'first question', sender = 0) => {
    const row = card(sender, question);
    fireEvent.click(within(row).getByRole('button', { name: 'Responder' }));
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: text } });
    fireEvent.keyDown(within(row).getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(within(row).getByText(`"${text}"`)).toBeTruthy());
    expect(within(inboxes[sender]).queryByText('Audience: envío aceptado; recepción sin confirmar.')).toBeNull();
    expect(within(inboxes[sender]).queryByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeNull();
  };
  return { a, b, pending, audience, inboxes, card, send, reply };
};

it('encrypts both paths with real serialization, decrypts for B and Audience, and excludes pending Controls', async () => {
  const { a, b, pending, audience, reply, card } = await setup();
  await reply();
  await waitFor(() => expect(within(card(1)).getByText('"Confidential answer"')).toBeTruthy());
  expect(within(card(0)).getAllByText('"Confidential answer"')).toHaveLength(1);
  const frames = a.socket.sent.filter(raw => JSON.parse(raw).type === 'PRIVATE_CONTROL_SIGNAL');
  expect(frames).toHaveLength(2);
  for (const raw of frames) {
    expect(raw).not.toMatch(/Confidential answer|Private Operator|Private Alias|MESSAGE_REPLY_SYNC|responseText|repliedBy/);
    expect(JSON.parse(raw)).toMatchObject({ type: 'PRIVATE_CONTROL_SIGNAL', ciphertext: expect.any(String), nonce: expect.any(String) });
  }
  expect(observed.decrypted.get('B')?.some(signal => (signal.value as Frame).type === 'MESSAGE_REPLY_SYNC')).toBe(true);
  expect(observed.decrypted.get('audience')?.some(signal => (signal.value as Frame).type === 'CHAT_RESPONSE'
    && (signal.value as Frame).text === 'Confidential answer' && (signal.value as Frame).senderNick === 'Control')).toBe(true);
  expect(pending.socket.received.filter(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL')).toHaveLength(0);
  await act(async () => { pending.socket.receive(JSON.parse(frames[1])); });
  expect(observed.decrypted.get('pending')).toBeUndefined();
  expect(b.socket.received.some(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(true);
  expect(audience.socket.received.some(frame => frame.toParticipantId === audienceId)).toBe(true);
});

it('correlates two messages from one participant using identical envelope IDs on both Controls', async () => {
  const { send, reply, card } = await setup();
  await send('second question');
  await reply('Only the second answer', 'second question', 1);
  await waitFor(() => expect(within(card(0, 'second question')).getByText('"Only the second answer"')).toBeTruthy());
  expect(within(card(0)).queryByText('"Only the second answer"')).toBeNull();
  expect(within(card(1)).queryByText('"Only the second answer"')).toBeNull();
});

it('deduplicates sender echo, repeated handler processing, nonce replay and reencrypted retransmission', async () => {
  const { a, b, reply, card } = await setup();
  await reply();
  await waitFor(() => expect(within(card(1)).getByText('"Confidential answer"')).toBeTruthy());
  const signal = observed.decrypted.get('B')!.find(value => (value.value as Frame).type === 'MESSAGE_REPLY_SYNC')!;
  await act(async () => {
    observed.handlers.get('A')!(signal); observed.handlers.get('B')!(signal);
    b.socket.receive(JSON.parse(a.socket.sent.at(-1)!));
    await signalState('A').sendPrivateSignalToControls(signal.value);
  });
  await waitFor(() => expect(observed.decrypted.get('B')!.filter(value => (value.value as Frame).type === 'MESSAGE_REPLY_SYNC')).toHaveLength(2));
  for (const index of [0, 1]) expect(within(card(index)).getAllByText('"Confidential answer"')).toHaveLength(1);
});

it('ignores unknown or missing correlation and Audience attempts to forge a Control reply', async () => {
  const { reply, card } = await setup();
  await reply();
  await waitFor(() => expect(within(card(1)).getByText('"Confidential answer"')).toBeTruthy());
  const value = observed.decrypted.get('B')!.find(signal => (signal.value as Frame).type === 'MESSAGE_REPLY_SYNC')!.value as Frame;
  await act(async () => {
    await signalState('A').sendPrivateSignalToControls({ ...value, replyId: 'unknown', messageId: 'unknown', responseText: 'Wrong answer' });
    await signalState('A').sendPrivateSignalToControls({ ...value, replyId: 'missing', messageId: undefined, responseText: 'Wrong answer' });
    await signalState('A').sendPrivateSignalToControls({ ...value, replyId: undefined, responseText: 'Wrong answer' });
    await signalState('audience').sendPrivateSignal({ ...value, replyId: 'forged', responseText: 'Wrong answer' });
  });
  for (const index of [0, 1]) expect(within(card(index)).queryByText('"Wrong answer"')).toBeNull();
});

it('keeps admission-row replies separate from private messages by the same participant', async () => {
  const { a, b, inboxes, card } = await setup();
  await act(async () => {
    for (const connection of [a, b]) connection.socket.receive({ type: 'AUDIENCE_ACCESS_REQUEST', participantId: audienceId, requestedAt: Date.now() });
  });
  fireEvent.click(within(inboxes[0]).getByRole('button', { name: 'Responder al usuario en espera' }));
  const input = within(inboxes[0]).getByPlaceholderText('Mensaje a usuario en espera...');
  fireEvent.change(input, { target: { value: 'Admission reply' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(observed.decrypted.get('audience')?.some(signal => (signal.value as Frame).text === 'Admission reply')).toBe(true));
  expect(within(inboxes[0]).queryByText('Audience: envío aceptado; recepción sin confirmar.')).toBeNull();
  expect(within(inboxes[0]).queryByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeNull();
  for (const index of [0, 1]) expect(within(card(index)).queryByText('"Admission reply"')).toBeNull();
});

it('applies an echoed reply only once under StrictMode', async () => {
  const { reply, card } = await setup(true);
  await reply();
  await waitFor(() => expect(within(card(1)).getByText('"Confidential answer"')).toBeTruthy());
  for (const index of [0, 1]) expect(within(card(index)).getAllByText('"Confidential answer"')).toHaveLength(1);
});

it.each(['false', 'reject'] as const)('reports Control sync %s separately while preserving encrypted Audience response', async failure => {
  const { a, inboxes, audience, reply, card, send } = await setup();
  failControls = failure === 'false'; observed.rejectSync = failure === 'reject';
  await reply();
  expect(within(inboxes[0]).queryByText('Audience: envío aceptado; recepción sin confirmar.')).toBeNull();
  expect(within(inboxes[0]).getByText('Controles: no se pudo enviar la sincronización.')).toBeTruthy();
  expect(audience.socket.received.filter(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL')).toHaveLength(1);
  expect(a.socket.sent.join('')).not.toContain('Confidential answer');
  expect(within(card(0)).getByRole('alert').textContent).toBe('Controles: no se pudo enviar la sincronización.');
  failControls = false; observed.rejectSync = false;
  await send('another question');
  await reply('Another answer', 'another question');
  expect(within(card(0, 'another question')).queryByRole('alert')).toBeNull();
  expect(within(card(0)).getByRole('alert').textContent).toBe('Controles: no se pudo enviar la sincronización.');
});

it.each(['false', 'reject'] as const)('reports Audience %s independently and retains the draft while the encrypted Control sync succeeds', async failure => {
  const { inboxes, reply, card } = await setup();
  failAudience = failure === 'false'; observed.rejectAudience = failure === 'reject';
  await reply();
  expect(within(inboxes[0]).getAllByText('Audience: no se pudo enviar la respuesta.').length).toBeGreaterThan(0);
  expect(within(inboxes[0]).queryByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeNull();
  expect((within(card(0)).getByRole('textbox') as HTMLInputElement).value).toBe('Confidential answer');
  await waitFor(() => expect(within(card(1)).getByRole('alert')).toBeTruthy());
});

it('rejects an obsolete synchronization after key rotation', async () => {
  const { a, b, reply, card } = await setup();
  await reply();
  await waitFor(() => expect(within(card(1)).getByText('"Confidential answer"')).toBeTruthy());
  const value = observed.decrypted.get('B')!.find(signal => (signal.value as Frame).type === 'MESSAGE_REPLY_SYNC')!.value as Frame;
  holdControls = true;
  await act(async () => { await signalState('A').sendPrivateSignalToControls({ ...value, replyId: 'obsolete-unseen', responseText: 'Obsolete unseen reply' }); });
  const frame = JSON.parse(a.socket.sent.at(-1)!);
  holdControls = false;
  const before = observed.decrypted.get('B')!.length;
  await act(async () => { await signalState('A').rotateControlKey(); b.socket.receive(frame); });
  expect(observed.decrypted.get('B')).toHaveLength(before);
  expect(signalState('B').ready).toBe(false);
});

it('does not transmit a reply sync whose encryption finishes after session invalidation', async () => {
  const { a, card } = await setup();
  const original = cryptoUtils.encrypt;
  let release!: () => void;
  let entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (key, plaintext) => {
    const result = await original(key, plaintext);
    if (JSON.parse(plaintext).type === 'MESSAGE_REPLY_SYNC') { entered = true; await pause; }
    return result;
  });
  const row = card(0);
  fireEvent.click(within(row).getByRole('button', { name: 'Responder' }));
  fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'Obsolete send' } });
  fireEvent.keyDown(within(row).getByRole('textbox'), { key: 'Enter' });
  await waitFor(() => expect(entered).toBe(true));
  const pendingSync = observed.controlsDispatches.at(-1)!;
  await act(async () => { for (const socket of sockets) socket.receive({ type: 'PRESENTATION_SESSION_ROTATED' }); release(); expect(await pendingSync).toBe(false); });
  expect(() => card(0)).toThrow();
  expect(a.socket.sent.filter(raw => JSON.parse(raw).type === 'PRIVATE_CONTROL_SIGNAL')).toHaveLength(1);
});

it('discards a decryption completing after presentation invalidation', async () => {
  const { card } = await setup();
  const original = cryptoUtils.decryptWithNonceReplayProtection;
  let release!: () => void;
  let entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'decryptWithNonceReplayProtection').mockImplementation(async (...args) => {
    const plaintext = await original(...args); entered = true; await pause; return plaintext;
  });
  await act(async () => { await signalState('A').sendPrivateSignalToControls({ type: 'MESSAGE_REPLY_SYNC', messageId: 'obsolete', responseText: 'Obsolete' }); });
  await waitFor(() => expect(entered).toBe(true));
  await act(async () => { for (const socket of sockets) socket.receive({ type: 'PRESENTATION_SESSION_ROTATED' }); release(); await pause; });
  expect(observed.decrypted.get('B')?.some(signal => (signal.value as Frame).responseText === 'Obsolete')).toBe(false);
  expect(() => card(1)).toThrow();
});

const setupConversation = async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('sse-ticket')
    ? { ticket: 'synthetic-ticket' } : { presentationSessionId: 'session-a', participantId: audienceId,
      credential: 'synthetic-credential', accessMode: 'PUBLIC', accessState: 'ADMITTED' } } as Response)));
  sessionStorage.clear();
  const a = client('A'), b = client('B'), pending = client('pending'), audience = client('audience');
  const viewA = render(control('A', a)), viewB = render(control('B', b));
  render(control('pending', pending)); render(<AudienceSocial connection={audience} />);
  await waitFor(() => expect(socialAccess.participantId).toBe(audienceId));
  await act(async () => {
    socialAccess.handleWsConnectionChange('open');
    audience.socket.receive({ type: 'WELCOME', presentationSessionId: 'session-a' });
    audience.socket.receive({ type: 'AUDIENCE_ACCESS_STATE', participantId: audienceId, presentationSessionId: 'session-a', accessMode: 'PUBLIC', accessState: 'ADMITTED' });
  });
  await waitFor(() => expect(keyFrame).toBeDefined());
  await act(async () => { audience.socket.receive(keyFrame!); });
  await waitFor(() => expect(socialOwner.socialReady).toBe(true));
  await act(async () => {
    await signalState('B').requestControlAuthorization('123456');
    const request = JSON.parse(b.socket.sent.find(raw => JSON.parse(raw).type === 'LIVE_AUDIO_CONTROL_JOIN_REQUEST')!);
    await signalState('A').authorizeSecondaryControl(request);
  });
  b.socket.authorized = true; viewB.rerender(control('B', b, true));
  await waitFor(() => expect(signalState('B').ready).toBe(true));
  await act(async () => { expect(socialOwner.activate('Private Alias', false)).toBe(true); });
  fireEvent.click(screen.getAllByTitle('Bandeja Privada')[0]); fireEvent.click(screen.getAllByTitle('Bandeja Privada')[1]);
  const inboxes = screen.getAllByText('Notificaciones').map(node => node.closest('.fixed') as HTMLElement);
  const conversation = (index: number) => inboxes[index];
  for (const inbox of inboxes) {
    expect(within(inbox).getByRole('combobox', { name: 'Destinatario' })).toHaveProperty('value', 'control');
    await waitFor(() => expect(within(inbox).getByRole('option', { name: 'Private Alias' })).toBeTruthy());
    fireEvent.change(within(inbox).getByRole('combobox', { name: 'Destinatario' }), { target: { value: audienceId } });
  }
  const send = async (index: number, text: string) => {
    const panel = conversation(index);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Destinatario' }), { target: { value: audienceId } });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Mensaje' }), { target: { value: text } });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', false));
    fireEvent.click(within(panel).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(within(panel).getByText(text, { selector: 'p' })).toBeTruthy());
    const card = within(panel).getByText(text, { selector: 'p' }).closest('[data-operation-id]')!;
    return card.getAttribute('data-operation-id')!;
  };
  return { a, b, pending, audience, viewA, viewB, inboxes, conversation, send };
};

it('starts a de novo E2EE message across A/B and receives a correlated reply through the actual Audience UI without RTC', async () => {
  const { a, b, pending, audience, viewA, conversation, send } = await setupConversation();
  expect(audience.socket.sent.map(raw => JSON.parse(raw)).filter(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL')).not.toHaveLength(0);
  expect(observed.decrypted.get('A')?.some(signal => (signal.value as Frame).type === 'PRIVATE_MESSAGE')).toBe(false);
  const id = await send(0, 'Initial encrypted invitation');
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  await screen.findByText('"Initial encrypted invitation"');
  await waitFor(() => expect(within(conversation(1)).getByText('Initial encrypted invitation')).toBeTruthy());
  expect(within(conversation(0)).getAllByText('Initial encrypted invitation')).toHaveLength(1);
  fireEvent.click(within(screen.getByText('"Initial encrypted invitation"').closest('.rounded-xl') as HTMLElement).getByRole('button', { name: 'Responder' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Mensaje privado para Control' }), { target: { value: 'Audience correlated reply' } });
  fireEvent.submit(document.getElementById('message-form')!);
  for (const index of [0, 1]) await waitFor(() => {
    expect(within(conversation(index)).getByText('"Audience correlated reply"')).toBeTruthy();
  });
  expect(observed.decrypted.get('A')!.find(signal => (signal.value as Frame).text === 'Audience correlated reply')!.value).toMatchObject({ replyTo: id });
  localStorage.setItem('sefer_control_operator_nick', 'Second operator');
  await send(1, 'Continuation from B');
  await screen.findByText('"Continuation from B"');
  await waitFor(() => expect(within(conversation(0)).getByText('Continuation from B')).toBeTruthy());
  const group = observed.decrypted.get('A')!.find(signal => (signal.value as Frame).text === 'Continuation from B')!;
  expect(group.isControlSignal).toBe(true);
  expect(group.value).toMatchObject({ operator: 'Control (Second operator)', conversationId: JSON.stringify(['session-a', audienceId]), audienceQueued: true });
  for (const raw of [...a.socket.sent, ...b.socket.sent, ...audience.socket.sent].filter(raw => JSON.parse(raw).type === 'PRIVATE_CONTROL_SIGNAL')) {
    expect(raw).not.toMatch(/Initial encrypted invitation|Audience correlated reply|Continuation from B|Second operator|Private Alias/);
  }
  expect(pending.socket.received.some(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL')).toBe(false);
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/Initial encrypted invitation|Audience correlated reply|Continuation from B/);
  viewA.unmount(); a.socket.authorized = false; a.socket.close();
  await send(1, 'B continues alone');
  await screen.findByText('"B continues alone"');
});

it('keeps the compact composer, card colors, contextual actions and actionable badge without duplicate outgoing cards', async () => {
  const { a, conversation, send } = await setupConversation();
  const inbox = conversation(0);
  fireEvent.change(within(inbox).getByRole('combobox', { name: 'Destinatario' }), { target: { value: 'control' } });
  fireEvent.change(within(inbox).getByRole('textbox', { name: 'Mensaje' }), { target: { value: 'Team notice' } });
  fireEvent.click(within(inbox).getByRole('button', { name: 'Enviar' }));
  const blue = await within(inbox).findByText('Team notice');
  expect(blue.closest('.group')!.classList.contains('bg-blue-950/30')).toBe(true);
  const operationId = await send(0, 'New Audience message');
  const orange = within(inbox).getByText('New Audience message', { selector: 'p' }).closest('[data-operation-id]')!;
  expect(orange.classList.contains('bg-amber-950/30')).toBe(true);
  await waitFor(() => expect(within(inbox).getByRole('combobox', { name: 'Destinatario' })).toHaveProperty('value', 'control'));
  expect(screen.getAllByTitle('Bandeja Privada')[0].getAttribute('aria-label')).toBe('Bandeja Privada: 1 solicitudes pendientes');
  await act(async () => { expect(await socialOwner.sendPrivateMessage('Incoming question', operationId)).toBe(true); });
  const gray = (await within(inbox).findByText('"Incoming question"')).closest('.group')!;
  expect(gray.classList.contains('bg-gray-800')).toBe(true);
  fireEvent.click(within(gray).getByRole('button', { name: 'Responder' }));
  fireEvent.change(within(gray).getByRole('textbox'), { target: { value: 'Contextual green answer' } });
  fireEvent.keyDown(within(gray).getByRole('textbox'), { key: 'Enter' });
  const green = await within(gray).findByText('"Contextual green answer"');
  expect(green.parentElement!.classList.contains('bg-emerald-950/40')).toBe(true);
  expect(within(inbox).getAllByText('"Contextual green answer"')).toHaveLength(1);
  await within(gray).findByRole('button', { name: 'Responder de nuevo' });
  fireEvent.click(within(gray).getByRole('button', { name: 'Agradecer' }));
  await within(gray).findByText('"Gracias, Private Alias"');
  expect(screen.getAllByTitle('Bandeja Privada')[0].getAttribute('aria-label')).toBe('Bandeja Privada: 2 solicitudes pendientes');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.click(within(gray).getByRole('button', { name: 'Bloquear acceso a Private Alias' }));
  expect(a.socket.sent.some(raw => { const frame = JSON.parse(raw); return frame.type === 'AUDIENCE_ACCESS_DECISION' && frame.decision === 'BLOCK'; })).toBe(true);
  fireEvent.click(within(orange).getByRole('button', { name: 'Descartar aviso' }));
  expect(within(inbox).queryByText('New Audience message', { selector: 'p' })).toBeNull();
  fireEvent.click(within(gray).getByRole('button', { name: 'Descartar mensaje de Private Alias' }));
  expect(within(inbox).queryByText('"Incoming question"')).toBeNull();
  expect(screen.getAllByTitle('Bandeja Privada')[0].getAttribute('aria-label')).toBe('Bandeja Privada: 1 solicitudes pendientes');
});

it.each([[true, true], [true, false], [false, true], [false, false]])('records independent new-conversation dispatch results Audience=%s Controls=%s', async (audienceQueued, controlsQueued) => {
  const { conversation, send } = await setupConversation();
  const selector = within(conversation(0)).getByRole('combobox', { name: 'Destinatario' });
  expect(selector.classList.contains('bg-emerald-950')).toBe(true);
  observed.rejectAudience = !audienceQueued; observed.rejectSync = !controlsQueued;
  await send(0, 'Independent outcomes');
  await waitFor(() => expect(within(conversation(0)).getByRole('textbox', { name: 'Mensaje' })).toHaveProperty('value', audienceQueued ? '' : 'Independent outcomes'));
  expect(selector).toHaveProperty('value', audienceQueued ? 'control' : audienceId);
  for (const index of [0, 1]) {
    expect(within(conversation(index)).queryByText('Audience: envío aceptado; recepción sin confirmar.')).toBeNull();
    expect(within(conversation(index)).queryByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeNull();
    expect(within(conversation(index)).queryAllByText('Independent outcomes', { selector: 'p' }).length).toBeLessThanOrEqual(1);
    expect(screen.getAllByTitle('Bandeja Privada')[index].getAttribute('aria-label')).toBe('Bandeja Privada: 0 solicitudes pendientes');
  }
  if (!audienceQueued) {
    await waitFor(() => expect(within(conversation(0)).getByText('Audience: no se pudo enviar la respuesta.')).toBeTruthy());
  }
  if (!controlsQueued) {
    await waitFor(() => expect(within(conversation(0)).getByText('Controles: no se pudo enviar la sincronización.')).toBeTruthy());
  }
  if (controlsQueued) {
    await waitFor(() => expect(within(conversation(1)).getByText('Independent outcomes')).toBeTruthy());
    if (!audienceQueued) {
      await waitFor(() => expect(within(conversation(1)).getByText('Audience: no se pudo enviar la respuesta.')).toBeTruthy());
    }
  } else {
    expect(within(conversation(1)).queryByText('Independent outcomes')).toBeNull();
  }
});

it('deduplicates concurrent Controls, echoes, replay and out-of-order operations and never resolves another participant\'s reply', async () => {
  const { a, b, audience, conversation, send } = await setupConversation();
  holdControls = true;
  await Promise.all([send(0, 'Concurrent A'), send(1, 'Concurrent B')]);
  await waitFor(() => expect(observed.decrypted.get('audience')?.length).toBeGreaterThanOrEqual(2));
  const values = [
    observed.decrypted.get('audience')!.find(signal => (signal.value as Frame).text === 'Concurrent A')!.value as Frame,
    observed.decrypted.get('audience')!.find(signal => (signal.value as Frame).text === 'Concurrent B')!.value as Frame,
  ];
  expect(values[0].operationId).not.toBe(values[1].operationId);
  const held = [a, b].flatMap(client => client.socket.sent.map(raw => JSON.parse(raw) as Frame))
    .filter(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL' && !frame.toParticipantId);
  holdControls = false;
  await act(async () => { for (const frame of held.reverse()) { a.socket.receive(frame); b.socket.receive(frame); a.socket.receive(frame); b.socket.receive(frame); } });
  for (const index of [0, 1]) await waitFor(() => {
    expect(within(conversation(index)).getAllByText('Concurrent A', { selector: 'p' })).toHaveLength(1);
    expect(within(conversation(index)).getAllByText('Concurrent B', { selector: 'p' })).toHaveLength(1);
  });
  const data = observed.decrypted.get('B')!.find(signal => (signal.value as Frame).text === 'Concurrent A')!.value as Frame;
  await act(async () => {
    await signalState('A').sendPrivateSignalToControls(data);
    await signalState('A').sendPrivateSignalToControls({ ...data, text: 'Conflicting content' });
    await signalState('A').sendPrivateSignalToControls({ ...data, participantId: '22222222-2222-4222-8222-222222222222', conversationId: JSON.stringify(['session-a', '22222222-2222-4222-8222-222222222222']) });
    await signalState('audience').sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text: 'Wrong conversation', operationId: crypto.randomUUID(),
      conversationId: JSON.stringify(['session-a', '22222222-2222-4222-8222-222222222222']), presentationSessionId: 'session-a', replyTo: values[0].operationId });
  });
  expect(within(conversation(1)).getAllByText('Concurrent A', { selector: 'p' })).toHaveLength(1);
  expect(within(conversation(1)).queryByText('Conflicting content')).toBeNull();
  expect(screen.queryByText('Wrong conversation')).toBeNull();
  expect(audience.socket.received.filter(frame => frame.toParticipantId === audienceId)).toHaveLength(2);
});

it('requires fresh server-admitted and encrypted profiles after reconnect, and refuses missing keys and rejected recipients', async () => {
  const { a, b, conversation } = await setupConversation();
  const publicKey = await socialOwner.privateSignals.getAudiencePublicKey();
  const status = { type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: audienceId, role: 'audience',
    connected: true, isActiveAudience: true, speakerState: 'LISTENER', updatedAt: Date.now() };
  await act(async () => { for (const socket of [a.socket, b.socket]) {
    socket.receive({ ...status, connected: false }); socket.receive({ ...status, activeListPublicKey: publicKey });
  } });
  await act(async () => { await socialOwner.privateSignals.sendPrivateSignal({ type: 'ACTIVE_PROFILE', alias: 'Private Alias' }); });
  fireEvent.change(within(conversation(0)).getByRole('textbox', { name: 'Mensaje' }), { target: { value: 'Blocked draft' } });
  expect(within(conversation(0)).getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', true);
  await act(async () => { for (const socket of [a.socket, b.socket]) socket.receive({ type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', participantId: audienceId,
    activeListPublicKey: publicKey, isAliasVisibleToActiveParticipants: false }); });
  await waitFor(() => expect(within(conversation(0)).getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', false));
  const replacement = await cryptoUtils.exportPublicKey(await cryptoUtils.generateEphemeralKeyPair());
  await act(async () => { a.socket.receive({ ...status, activeListPublicKey: replacement }); });
  expect(within(conversation(0)).getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', true);
  await act(async () => { for (const socket of [a.socket, b.socket]) socket.receive({ type: 'AUDIENCE_ACCESS_DECISION_RESULT', participantId: audienceId, decision: 'REJECT' }); });
  await act(async () => { await socialOwner.privateSignals.sendPrivateSignal({ type: 'ACTIVE_PROFILE', alias: 'Private Alias' }); });
  for (const index of [0, 1]) {
    fireEvent.change(within(conversation(index)).getByRole('textbox', { name: 'Mensaje' }), { target: { value: 'Still rejected' } });
    expect(within(conversation(index)).getByRole('button', { name: 'Enviar' })).toHaveProperty('disabled', true);
  }
});

it.each(['session', 'key', 'revocation', 'connection', 'recipient', 'recipientReconnect'])('invalidates a late first-message encryption on %s change before writing any envelope', async boundary => {
  const { a, b, viewA, conversation } = await setupConversation();
  const original = cryptoUtils.encrypt;
  let release!: () => void, entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (key, plaintext) => {
    const encrypted = await original(key, plaintext);
    if (JSON.parse(plaintext).type === 'CHAT_RESPONSE') { entered = true; await pause; }
    return encrypted;
  });
  fireEvent.change(within(conversation(0)).getByRole('textbox', { name: 'Mensaje' }), { target: { value: 'Must not escape' } });
  const before = a.socket.sent.filter(raw => JSON.parse(raw).type === 'PRIVATE_CONTROL_SIGNAL' && JSON.parse(raw).toParticipantId).length;
  fireEvent.click(within(conversation(0)).getByRole('button', { name: 'Enviar' }));
  await waitFor(() => expect(entered).toBe(true));
  const pendingDelivery = observed.audienceDispatches.at(-1)!;
  await act(async () => {
    if (boundary === 'session') for (const socket of sockets) socket.receive({ type: 'PRESENTATION_SESSION_ROTATED', presentationSessionId: 'next-session' });
    if (boundary === 'key') await signalState('A').rotateControlKey();
    if (boundary === 'revocation' || boundary === 'connection') viewA.rerender(<Container presentationSessionId="session-a" controlSessionId="A"
      controlState={boundary === 'revocation' ? 'PENDING' : 'PRINCIPAL'} isControlAuthorized={boundary !== 'revocation'}
      wsStatus={boundary === 'connection' ? 'closed' : 'open'} wsSend={a.send} subscribeToWsMessage={a.subscribe} />);
    if (boundary === 'recipient' || boundary === 'recipientReconnect') for (const socket of [a.socket, b.socket]) socket.receive({ type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: audienceId,
      role: 'audience', connected: false, isActiveAudience: true, speakerState: 'LISTENER', updatedAt: Date.now() });
  });
  if (boundary === 'recipientReconnect') await act(async () => {
    const publicKey = await socialOwner.privateSignals.getAudiencePublicKey();
    for (const socket of [a.socket, b.socket]) {
      socket.receive({ type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: audienceId, role: 'audience', connected: true,
        isActiveAudience: true, activeListPublicKey: publicKey, speakerState: 'LISTENER', updatedAt: Date.now() });
      socket.receive({ type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', participantId: audienceId, activeListPublicKey: publicKey, isAliasVisibleToActiveParticipants: false });
    }
    await socialOwner.privateSignals.sendPrivateSignal({ type: 'ACTIVE_PROFILE', alias: 'Private Alias' });
  });
  await act(async () => { release(); expect(await pendingDelivery).toBe(false); });
  await waitFor(() => expect(a.socket.sent.filter(raw => JSON.parse(raw).type === 'PRIVATE_CONTROL_SIGNAL' && JSON.parse(raw).toParticipantId)).toHaveLength(before));
  expect(socialOwner.receivedControlMessages.some(message => message.text === 'Must not escape')).toBe(false);
});

it('keeps an Audience reply received before the original orange card without duplicates when team sync arrives', async () => {
  const { a, b, conversation, send } = await setupConversation();
  holdControls = true;
  const operationId = await send(0, 'Original arrives later');
  await screen.findByText('"Original arrives later"');
  await act(async () => { expect(await socialOwner.sendPrivateMessage('Reply arrives first', operationId)).toBe(true); });
  await waitFor(() => expect(within(conversation(1)).getByText('"Reply arrives first"')).toBeTruthy());
  expect(observed.decrypted.get('B')!.find(signal => (signal.value as Frame).text === 'Reply arrives first')!.value).toMatchObject({ replyTo: operationId });
  expect(within(conversation(1)).queryByText('Original arrives later')).toBeNull();
  const sync = a.socket.sent.map(raw => JSON.parse(raw) as Frame).findLast(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL' && !frame.toParticipantId)!;
  holdControls = false;
  await act(async () => { a.socket.receive(sync); b.socket.receive(sync); });
  await waitFor(() => {
    expect(within(conversation(1)).getByText('Original arrives later')).toBeTruthy();
  });
  expect(within(conversation(1)).getAllByText('"Reply arrives first"')).toHaveLength(1);
});

it('keeps a dismissed canonical Audience operation hidden when a fresh encrypted envelope repeats it', async () => {
  const { a, viewA, conversation } = await setupConversation();
  const value = { type: 'PRIVATE_MESSAGE', text: 'Dismissed operation', alias: 'Private Alias', operationId: crypto.randomUUID(),
    conversationId: JSON.stringify(['session-a', audienceId]), presentationSessionId: 'session-a', createdAt: Date.now() };
  const deliver = () => act(async () => { expect(await socialOwner.privateSignals.sendPrivateSignal(value)).toBe(true); });
  await deliver();
  const card = (await within(conversation(0)).findByText('"Dismissed operation"')).closest('.group')!;
  fireEvent.click(within(card).getByRole('button', { name: 'Descartar mensaje de Private Alias' }));
  expect(within(conversation(0)).queryByText('"Dismissed operation"')).toBeNull();
  await deliver();
  await waitFor(() => expect(observed.decrypted.get('A')!.filter(signal => (signal.value as Frame).operationId === value.operationId)).toHaveLength(2));
  const envelopes = a.socket.received.filter(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL' && frame.fromParticipantId === audienceId).slice(-2);
  expect(envelopes[0].nonce).not.toBe(envelopes[1].nonce);
  expect(within(conversation(0)).queryByText('"Dismissed operation"')).toBeNull();
  expect(screen.getAllByTitle('Bandeja Privada')[0].getAttribute('aria-label')).toBe('Bandeja Privada: 0 solicitudes pendientes');
  expect(within(conversation(1)).getAllByText('"Dismissed operation"')).toHaveLength(1);
  expect(screen.getAllByTitle('Bandeja Privada')[1].getAttribute('aria-label')).toBe('Bandeja Privada: 1 solicitudes pendientes');
  viewA.rerender(<Container presentationSessionId="session-a" controlSessionId="A" controlState="PRINCIPAL" isControlAuthorized
    wsStatus="closed" wsSend={a.send} subscribeToWsMessage={a.subscribe} />);
  viewA.rerender(control('A', a));
  await deliver();
  await waitFor(() => expect(observed.decrypted.get('A')!.filter(signal => (signal.value as Frame).operationId === value.operationId)).toHaveLength(3));
  expect(within(conversation(0)).queryByText('"Dismissed operation"')).toBeNull();
  await act(async () => { expect(await socialOwner.sendPrivateMessage('Valid new operation')).toBe(true); });
  await within(conversation(0)).findByText('"Valid new operation"');
  expect(screen.getAllByTitle('Bandeja Privada')[0].getAttribute('aria-label')).toBe('Bandeja Privada: 1 solicitudes pendientes');
});

it.each(['key', 'session'])('clears incoming and outgoing dismissal IDs at the %s boundary', async boundary => {
  const { a, viewA, conversation, send } = await setupConversation();
  const operationId = crypto.randomUUID();
  const value = { type: 'PRIVATE_MESSAGE', text: 'Old incoming scope', alias: 'Private Alias', operationId,
    conversationId: JSON.stringify(['session-a', audienceId]), presentationSessionId: 'session-a', createdAt: Date.now() };
  await act(async () => { await socialOwner.privateSignals.sendPrivateSignal(value); });
  const gray = (await within(conversation(0)).findByText('"Old incoming scope"')).closest('.group')!;
  fireEvent.click(within(gray).getByRole('button', { name: 'Descartar mensaje de Private Alias' }));
  const outgoingId = await send(0, 'Old outgoing scope');
  const orange = within(conversation(0)).getByText('Old outgoing scope').closest('[data-operation-id]')!;
  fireEvent.click(within(orange).getByRole('button', { name: 'Descartar aviso' }));
  const nextSession = boundary === 'session' ? 'session-b' : 'session-a';
  if (boundary === 'key') {
    const oldKey = signalState('A').keyId;
    await act(async () => { await signalState('A').rotateControlKey(); });
    await waitFor(() => { expect(signalState('A').keyId).not.toBe(oldKey); expect(signalState('audience').keyId).toBe(signalState('A').keyId); });
  } else {
    viewA.rerender(<Container presentationSessionId={nextSession} controlSessionId="A" controlState="PRINCIPAL" isControlAuthorized
      wsStatus="open" wsSend={a.send} subscribeToWsMessage={a.subscribe} />);
    await waitFor(() => expect(signalState('audience').ready).toBe(true));
  }
  const conversationId = JSON.stringify([nextSession, audienceId]);
  await act(async () => {
    await socialOwner.privateSignals.sendPrivateSignal({ ...value, text: 'New incoming scope', presentationSessionId: nextSession, conversationId });
    await signalState('A').sendPrivateSignalToControls({ type: 'CONTROL_CONVERSATION_MESSAGE', version: 1, operationId: outgoingId,
      participantId: audienceId, presentationSessionId: nextSession, conversationId,
      text: 'New outgoing scope', operator: 'Control', createdAt: Date.now(), audienceQueued: true });
  });
  await within(conversation(0)).findByText('"New incoming scope"');
  await within(conversation(0)).findByText('New outgoing scope');
  expect(within(conversation(0)).queryByText('Old outgoing scope')).toBeNull();
  expect(screen.getAllByTitle('Bandeja Privada')[0].getAttribute('aria-label')).toBe('Bandeja Privada: 1 solicitudes pendientes');
});

it('stores only validated de novo Control content and preserves immutable operation identity', () => {
  const hook = renderHook(() => useControlConversations({ presentationSessionId: 'session-a', isCurrent: () => true,
    getEpoch: () => 1, getRecipient: () => null,
    signals: { keyId: 'key', sendPrivateSignalToParticipant: vi.fn(), sendPrivateSignalToControls: vi.fn() } }));
  const operation = { type: 'CONTROL_CONVERSATION_MESSAGE', version: 1, operationId: crypto.randomUUID(), participantId: audienceId,
    conversationId: JSON.stringify(['session-a', audienceId]), presentationSessionId: 'session-a',
    text: 'One owned body', operator: 'Control', createdAt: Date.now(), audienceQueued: true };
  const signal: DecryptedPrivateControlSignal = { type: 'PRIVATE_CONTROL_SIGNAL', fromParticipantId: 'A', keyId: 'key',
    plaintext: '', value: operation, receivedAt: Date.now(), isControlSignal: true };
  act(() => {
    hook.result.current.receive({ ...signal, isControlSignal: false, value: { ...operation, type: 'PRIVATE_MESSAGE' } });
    hook.result.current.receive({ ...signal, value: { ...operation, replyTo: crypto.randomUUID() } });
    for (const change of [{ operationId: 'invalid' }, { presentationSessionId: 'old' }, { conversationId: 'other' },
      { participantId: 'invalid' }, { text: '' }, { text: 'x'.repeat(1001) }, { operator: 'x'.repeat(81) },
      { createdAt: 1.5 }, { version: 2 }, { audienceQueued: 'true' }]) {
      hook.result.current.receive({ ...signal, value: { ...operation, ...change } });
    }
    hook.result.current.receive({ ...signal, keyId: 'old' });
    hook.result.current.receive({ ...signal, isControlSignal: false });
  });
  expect(hook.result.current.messages).toEqual([]);
  act(() => {
    hook.result.current.receive(signal);
    hook.result.current.receive(signal);
    hook.result.current.receive({ ...signal, value: { ...operation, text: 'Conflicting body' } });
  });
  expect(hook.result.current.messages).toHaveLength(1);
  expect(hook.result.current.messages[0]).toMatchObject({ id: operation.operationId, text: 'One owned body' });
  act(() => hook.result.current.clear());
  expect(hook.result.current.messages).toEqual([]);
});

it('retains a Control-team draft when an invalid callback resolves without explicit acceptance', async () => {
  render(<PrivateControlInbox isOpen isControlAuthorized messages={[]} authorizationRequests={[]}
    onApproveRequest={vi.fn()} onRejectRequest={vi.fn()} onDismissMessage={vi.fn()}
    onSendInterControlMessage={vi.fn().mockResolvedValue(undefined)} />);
  const input = screen.getByRole('textbox', { name: 'Mensaje' });
  fireEvent.change(input, { target: { value: 'No implicit success' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
  await screen.findByRole('alert');
  expect(input).toHaveProperty('value', 'No implicit success');
});

it('does not apply a team message whose real decryption completes after Control revocation', async () => {
  const { b, viewB } = await setupConversation();
  const original = cryptoUtils.decryptWithNonceReplayProtection;
  let release!: () => void, entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'decryptWithNonceReplayProtection').mockImplementation(async (...args) => {
    const plaintext = await original(...args);
    if (JSON.parse(plaintext).text === 'Late private content') { entered = true; await pause; }
    return plaintext;
  });
  await act(async () => { await signalState('A').sendPrivateSignalToControls({ type: 'CONTROL_CONVERSATION_MESSAGE', version: 1,
    operationId: crypto.randomUUID(), participantId: audienceId, presentationSessionId: 'session-a',
    conversationId: JSON.stringify(['session-a', audienceId]), text: 'Late private content', operator: 'Control', createdAt: Date.now(), audienceQueued: false }); });
  await waitFor(() => expect(entered).toBe(true));
  viewB.rerender(<Container presentationSessionId="session-a" controlSessionId="B" controlState="PENDING" isControlAuthorized={false}
    wsStatus="open" wsSend={b.send} subscribeToWsMessage={b.subscribe} />);
  await act(async () => { release(); await pause; });
  expect(observed.decrypted.get('B')?.some(signal => (signal.value as Frame).text === 'Late private content')).toBe(false);
  expect(signalState('B').ready).toBe(false);
});

it('does not transfer keys or approve a secondary Control after the approving owner is revoked', async () => {
  const { a, pending, viewA, inboxes } = await setupConversation();
  await act(async () => { await signalState('pending').requestControlAuthorization('123456'); });
  const request = JSON.parse(pending.socket.sent.findLast(raw => JSON.parse(raw).type === 'LIVE_AUDIO_CONTROL_JOIN_REQUEST')!);
  await act(async () => { a.socket.receive(request); });
  const approve = vi.fn();
  viewA.rerender(<Container presentationSessionId="session-a" controlSessionId="A" controlState="PRINCIPAL" isControlAuthorized
    wsStatus="open" wsSend={a.send} subscribeToWsMessage={a.subscribe} onApproveRequest={approve}
    authorizationRequests={[{ controlSessionId: 'pending', verificationCode: '123456', connectedAt: Date.now(), codeExpiresAt: Date.now() + 60000 }]} />);
  const original = cryptoUtils.encrypt;
  let release!: () => void, entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (...args) => {
    const value = await original(...args); entered = true; await pause; return value;
  });
  fireEvent.click(within(inboxes[0]).getByRole('button', { name: 'Aprobar' }));
  await waitFor(() => expect(entered).toBe(true));
  viewA.rerender(<Container presentationSessionId="session-a" controlSessionId="A" controlState="PENDING" isControlAuthorized={false}
    wsStatus="open" wsSend={a.send} subscribeToWsMessage={a.subscribe} onApproveRequest={approve} />);
  await act(async () => { release(); await pause; });
  expect(a.socket.sent.some(raw => { const frame = JSON.parse(raw); return frame.type === 'LIVE_AUDIO_CONTROL_AUTHORIZED' && frame.controlSessionId === 'pending'; })).toBe(false);
  expect(approve).not.toHaveBeenCalled();
});

it('preserves a newer draft typed while an Audience send is pending', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: audienceId } });
  fireEvent.change(input, { target: { value: 'Draft A' } });

  const original = cryptoUtils.encrypt;
  let release!: () => void, entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (key, plaintext) => {
    const value = await original(key, plaintext);
    if (JSON.parse(plaintext).type === 'CHAT_RESPONSE' && JSON.parse(plaintext).text === 'Draft A') {
      entered = true;
      await pause;
    }
    return value;
  });

  fireEvent.click(sendBtn);
  await waitFor(() => expect(entered).toBe(true));

  // Operator edits the draft to Draft B while send of Draft A is in flight
  fireEvent.change(input, { target: { value: 'Draft B' } });
  expect(input).toHaveProperty('value', 'Draft B');

  // Let Draft A dispatch finish
  await act(async () => { release(); });

  // Verification: Draft B must be preserved, and recipient must not be reset to 'control'
  await waitFor(() => expect(input).toHaveProperty('value', 'Draft B'));
  expect(selector).toHaveProperty('value', audienceId);
  expect(sendBtn).toHaveProperty('disabled', false);

  // Operator can now send Draft B without interference
  fireEvent.click(sendBtn);
  await waitFor(() => expect(input).toHaveProperty('value', ''));
  expect(selector).toHaveProperty('value', 'control');
});

it('preserves a newer recipient selection made while an Audience send is pending', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: audienceId } });
  fireEvent.change(input, { target: { value: 'Draft for audience' } });

  const original = cryptoUtils.encrypt;
  let release!: () => void, entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (key, plaintext) => {
    const value = await original(key, plaintext);
    if (JSON.parse(plaintext).type === 'CHAT_RESPONSE' && JSON.parse(plaintext).text === 'Draft for audience') {
      entered = true;
      await pause;
    }
    return value;
  });

  fireEvent.click(sendBtn);
  await waitFor(() => expect(entered).toBe(true));

  // Operator changes recipient to 'control' while the send to audience is pending
  fireEvent.change(selector, { target: { value: 'control' } });
  expect(selector).toHaveProperty('value', 'control');

  // Let the send finish
  await act(async () => { release(); });

  // Verification: Recipient must remain 'control', and draft should not be cleared since user changed recipient
  await waitFor(() => expect(selector).toHaveProperty('value', 'control'));
  expect(input).toHaveProperty('value', 'Draft for audience');
});

it('prevents double-submit during an in-flight Audience send', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: audienceId } });
  fireEvent.change(input, { target: { value: 'Single send only' } });

  const original = cryptoUtils.encrypt;
  let release!: () => void, sendCount = 0;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (key, plaintext) => {
    const value = await original(key, plaintext);
    if (JSON.parse(plaintext).type === 'CHAT_RESPONSE' && JSON.parse(plaintext).text === 'Single send only') {
      sendCount++;
      await pause;
    }
    return value;
  });

  fireEvent.click(sendBtn);
  await waitFor(() => expect(sendCount).toBe(1));

  // Second click while in-flight
  fireEvent.click(sendBtn);
  expect(sendBtn).toHaveProperty('disabled', true);
  expect(sendCount).toBe(1);

  await act(async () => { release(); });
  await waitFor(() => expect(input).toHaveProperty('value', ''));
  expect(sendCount).toBe(1);
});

it('retains draft and recipient on Audience dispatch failure and displays failure error', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: audienceId } });
  fireEvent.change(input, { target: { value: 'Will fail to deliver' } });

  observed.rejectAudience = true;
  fireEvent.click(sendBtn);

  await waitFor(() => {
    expect(within(inbox).getByText('No se pudo preparar o enviar el mensaje. El borrador se conserva.')).toBeTruthy();
  });
  expect(input).toHaveProperty('value', 'Will fail to deliver');
  expect(selector).toHaveProperty('value', audienceId);
  expect(within(inbox).queryByText('Audience: envío aceptado; recepción sin confirmar.')).toBeNull();
  expect(within(inbox).queryByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeNull();
  observed.rejectAudience = false;
});

it('invalidates an in-flight Audience send when key is rotated before completion', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: audienceId } });
  fireEvent.change(input, { target: { value: 'Key rotation in flight' } });

  const original = cryptoUtils.encrypt;
  let release!: () => void, entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (key, plaintext) => {
    const value = await original(key, plaintext);
    if (JSON.parse(plaintext).type === 'CHAT_RESPONSE' && JSON.parse(plaintext).text === 'Key rotation in flight') {
      entered = true;
      await pause;
    }
    return value;
  });

  fireEvent.click(sendBtn);
  await waitFor(() => expect(entered).toBe(true));

  // Rotate key while send is pending
  await act(async () => {
    await signalState('A').rotateControlKey();
  });

  await act(async () => { release(); });

  // Verification: The stale completion did not clear the draft
  expect(input).toHaveProperty('value', 'Key rotation in flight');
  expect(selector).toHaveProperty('value', audienceId);
});

it('invalidates an in-flight Audience send when presentation session is rotated before completion', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: audienceId } });
  fireEvent.change(input, { target: { value: 'Session rotation in flight' } });

  const original = cryptoUtils.encrypt;
  let release!: () => void, entered = false;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (key, plaintext) => {
    const value = await original(key, plaintext);
    if (JSON.parse(plaintext).type === 'CHAT_RESPONSE' && JSON.parse(plaintext).text === 'Session rotation in flight') {
      entered = true;
      await pause;
    }
    return value;
  });

  fireEvent.click(sendBtn);
  await waitFor(() => expect(entered).toBe(true));

  // Rotate session while send is pending
  await act(async () => {
    for (const socket of sockets) {
      socket.receive({ type: 'PRESENTATION_SESSION_ROTATED', presentationSessionId: 'session-b' });
    }
  });

  await act(async () => { release(); });

  // Verification: Stale completion did not clear the draft
  expect(input).toHaveProperty('value', 'Session rotation in flight');
});

it('clears draft on successful Control-team dispatch with no permanent success message', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: 'control' } });
  fireEvent.change(input, { target: { value: 'Announcement for team' } });
  fireEvent.click(sendBtn);

  await waitFor(() => expect(input).toHaveProperty('value', ''));
  expect(selector).toHaveProperty('value', 'control');
  expect(within(inbox).queryByText('Audience: envío aceptado; recepción sin confirmar.')).toBeNull();
  expect(within(inbox).queryByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeNull();
  expect(within(inbox).queryByRole('alert')).toBeNull();
  const blue = await within(inbox).findByText('Announcement for team');
  expect(blue.closest('.group')!.classList.contains('bg-blue-950/30')).toBe(true);
});

it('retains draft and shows contextual failure alert when Control-team dispatch rejects', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: 'control' } });
  fireEvent.change(input, { target: { value: 'Draft to keep on rejection' } });

  observed.rejectSync = true;
  fireEvent.click(sendBtn);

  await waitFor(() => {
    expect(within(inbox).getByText('No se pudo preparar o enviar el mensaje. El borrador se conserva.')).toBeTruthy();
  });
  expect(input).toHaveProperty('value', 'Draft to keep on rejection');
  expect(selector).toHaveProperty('value', 'control');
  expect(within(inbox).queryByText('Audience: envío aceptado; recepción sin confirmar.')).toBeNull();
  expect(within(inbox).queryByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeNull();
  observed.rejectSync = false;
});

it('retains draft and shows contextual failure alert when Control-team dispatch returns false', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: 'control' } });
  fireEvent.change(input, { target: { value: 'Draft to keep on false' } });

  failControls = true;
  fireEvent.click(sendBtn);

  await waitFor(() => {
    expect(within(inbox).getByText('No se pudo preparar o enviar el mensaje. El borrador se conserva.')).toBeTruthy();
  });
  expect(input).toHaveProperty('value', 'Draft to keep on false');
  expect(selector).toHaveProperty('value', 'control');
  expect(within(inbox).queryByText('Audience: envío aceptado; recepción sin confirmar.')).toBeNull();
  expect(within(inbox).queryByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeNull();
  failControls = false;
});

it('prevents duplicate sends during an in-flight Control-team dispatch', async () => {
  const { conversation } = await setupConversation();
  const inbox = conversation(0);
  const selector = within(inbox).getByRole('combobox', { name: 'Destinatario' });
  const input = within(inbox).getByRole('textbox', { name: 'Mensaje' });
  const sendBtn = within(inbox).getByRole('button', { name: 'Enviar' });

  fireEvent.change(selector, { target: { value: 'control' } });
  fireEvent.change(input, { target: { value: 'Single team announcement' } });

  const original = cryptoUtils.encrypt;
  let release!: () => void, callCount = 0;
  const pause = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(cryptoUtils, 'encrypt').mockImplementation(async (key, plaintext) => {
    const value = await original(key, plaintext);
    if (JSON.parse(plaintext).type === 'CONTROL_ANNOUNCEMENT') {
      callCount++;
      await pause;
    }
    return value;
  });

  fireEvent.click(sendBtn);
  await waitFor(() => expect(callCount).toBe(1));

  // Second click while in-flight
  fireEvent.click(sendBtn);
  expect(sendBtn).toHaveProperty('disabled', true);
  expect(callCount).toBe(1);

  await act(async () => { release(); });
  await waitFor(() => expect(input).toHaveProperty('value', ''));
  expect(callCount).toBe(1);
});
