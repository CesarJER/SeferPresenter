// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWebSocketController, type WebSocketAdapter } from '../src/hooks/useWebSocket';
import { usePrivateControlSignals, type PrivateControlSignalsState, type DecryptedPrivateControlSignal } from '../src/hooks/usePrivateControlSignals';
import * as cryptoUtils from '../src/utils/cryptoUtils';
import Container from '../src/features/liveAudio/components/control/LiveAudioControlContainer';

const observed = vi.hoisted(() => ({
  signals: new Map<string, PrivateControlSignalsState>(),
  decrypted: new Map<string, DecryptedPrivateControlSignal[]>(),
  handlers: new Map<string, (signal: DecryptedPrivateControlSignal) => void>(),
  rejectSync: false,
  rejectAudience: false,
}));
vi.mock('../src/hooks/usePrivateControlSignals', async importOriginal => {
  const original = await importOriginal<typeof import('../src/hooks/usePrivateControlSignals')>();
  return { ...original, usePrivateControlSignals: (options: Parameters<typeof original.usePrivateControlSignals>[0]) => {
    const id = options.controlSessionId!;
    observed.handlers.set(id, options.onPrivateSignal!);
    const state = original.usePrivateControlSignals({ ...options, onPrivateSignal: signal => {
      observed.decrypted.set(id, [...(observed.decrypted.get(id) || []), signal]);
      options.onPrivateSignal?.(signal);
    } });
    const result = { ...state,
      sendPrivateSignalToParticipant: (...args: Parameters<typeof state.sendPrivateSignalToParticipant>) => observed.rejectAudience
        ? Promise.reject(new Error('Synthetic Audience failure')) : state.sendPrivateSignalToParticipant(...args),
      sendPrivateSignalToControls: (value: unknown) => observed.rejectSync
      ? Promise.reject(new Error('Synthetic sync failure')) : state.sendPrivateSignalToControls(value) };
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
      if (!frame.toParticipantId && holdControls) return;
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
  controlSessionId={id} controlState={id === 'A' ? 'PRINCIPAL' : authorized ? 'AUTHORIZED' : 'PENDING'}
  isControlAuthorized={id === 'A' || authorized} wsStatus="open" wsSend={connection.send} subscribeToWsMessage={connection.subscribe}
/>;
const signalState = (id: string) => observed.signals.get(id)!;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
  localStorage.setItem('sefer_control_operator_nick', 'Private Operator');
  sockets.length = 0; controllers.length = 0; keyFrame = undefined;
  failAudience = false; failControls = false; holdControls = false;
  observed.signals.clear(); observed.decrypted.clear(); observed.handlers.clear(); observed.rejectSync = false; observed.rejectAudience = false;
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
    await waitFor(() => expect(within(inboxes[sender]).getAllByText(/Audience:/).length).toBeGreaterThan(0));
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
  await waitFor(() => expect(within(inboxes[0]).getByText('Audience: envío aceptado; recepción sin confirmar.')).toBeTruthy());
  await waitFor(() => expect(observed.decrypted.get('audience')?.some(signal => (signal.value as Frame).text === 'Admission reply')).toBe(true));
  for (const index of [0, 1]) expect(within(card(index)).queryByText('"Admission reply"')).toBeNull();
});

it('applies an echoed reply only once under StrictMode', async () => {
  const { reply, card } = await setup(true);
  await reply();
  await waitFor(() => expect(within(card(1)).getByText('"Confidential answer"')).toBeTruthy());
  for (const index of [0, 1]) expect(within(card(index)).getAllByText('"Confidential answer"')).toHaveLength(1);
});

it.each(['false', 'reject'] as const)('reports Control sync %s separately while preserving encrypted Audience response', async failure => {
  const { a, inboxes, audience, reply } = await setup();
  failControls = failure === 'false'; observed.rejectSync = failure === 'reject';
  await reply();
  expect(within(inboxes[0]).getByText('Audience: envío aceptado; recepción sin confirmar.')).toBeTruthy();
  expect(within(inboxes[0]).getByText('Controles: no se pudo enviar la sincronización.')).toBeTruthy();
  expect(audience.socket.received.filter(frame => frame.type === 'PRIVATE_CONTROL_SIGNAL')).toHaveLength(1);
  expect(a.socket.sent.join('')).not.toContain('Confidential answer');
});

it.each(['false', 'reject'] as const)('reports Audience %s independently and retains the draft while the encrypted Control sync succeeds', async failure => {
  const { inboxes, reply, card } = await setup();
  failAudience = failure === 'false'; observed.rejectAudience = failure === 'reject';
  await reply();
  expect(within(inboxes[0]).getAllByText('Audience: no se pudo enviar la respuesta.').length).toBeGreaterThan(0);
  expect(within(inboxes[0]).getByText('Controles: sincronización enviada; recepción sin confirmar.')).toBeTruthy();
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
  await act(async () => { for (const socket of sockets) socket.receive({ type: 'PRESENTATION_SESSION_ROTATED' }); release(); await pause; });
  await waitFor(() => expect(screen.getByText('Controles: no se pudo enviar la sincronización.')).toBeTruthy());
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
