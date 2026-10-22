import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecryptedPrivateControlSignal, PrivateControlSignalsState } from './usePrivateControlSignals';
import { conversationIdFor, isConversationOperationId } from '../utils/privateConversations';
import { isValidEphemeralParticipantId } from '../utils/validation';

export interface ConversationMessage {
  id: string;
  conversationId: string;
  participantId: string;
  text: string;
  sender: string;
  timestamp: number;
  audienceQueued?: boolean;
  controlsQueued?: boolean;
}

export function useControlConversations(options: {
  presentationSessionId?: string | null;
  isCurrent: () => boolean;
  getEpoch: () => number;
  getRecipient: (id: string) => { publicKey: string; epoch: number } | null;
  signals: Pick<PrivateControlSignalsState, 'keyId' | 'sendPrivateSignalToParticipant' | 'sendPrivateSignalToControls'>;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const current = useRef(options);
  current.current = options;
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const clear = useCallback(() => { generation.current++; setMessages([]); }, []);

  const append = useCallback((message: ConversationMessage) => {
    setMessages(previous => {
      const existing = previous.find(item => item.id === message.id);
      if (existing) {
        // Dispatch results may be filled after an encrypted sender echo, never replace message identity/content.
        if (existing.conversationId !== message.conversationId || existing.participantId !== message.participantId
          || existing.text !== message.text || existing.sender !== message.sender || existing.timestamp !== message.timestamp) return previous;
        return previous.map(item => item === existing ? { ...item,
          ...(message.audienceQueued === undefined ? {} : { audienceQueued: message.audienceQueued }),
          ...(message.controlsQueued === undefined ? {} : { controlsQueued: message.controlsQueued }),
        } : item);
      }
      return [...previous, message];
    });
  }, []);

  const receive = useCallback((signal: DecryptedPrivateControlSignal) => {
    const context = current.current;
    const data = signal.value as Record<string, unknown> | null;
    const sessionId = context.presentationSessionId;
    if (!context.isCurrent() || !sessionId || !data || typeof data !== 'object' || signal.keyId !== context.signals.keyId) return;
    if (data.type !== 'CONTROL_CONVERSATION_MESSAGE' || !signal.isControlSignal) return;
    const participantId = data.participantId;
    if (!isValidEphemeralParticipantId(participantId)) return;
    const conversationId = conversationIdFor(sessionId, participantId);
    if (!isConversationOperationId(data.operationId) || data.version !== 1 || typeof data.audienceQueued !== 'boolean') return;
    if (data.conversationId !== conversationId || data.presentationSessionId !== sessionId) return;
    if (typeof data.createdAt !== 'number' || !Number.isSafeInteger(data.createdAt)) return;
    if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 1000) return;
    if (typeof data.operator !== 'string' || data.operator.length > 80) return;
    // Contextual replies belong to MESSAGE_REPLY_SYNC and the inbox's green reply trail.
    if (data.replyTo !== undefined) return;
    append({ id: data.operationId, conversationId, participantId,
      text: data.text.trim(), sender: data.operator, timestamp: data.createdAt,
      audienceQueued: data.audienceQueued, controlsQueued: true,
    });
  }, [append]);

  const send = useCallback(async (participantId: string, text: string) => {
    const context = current.current;
    const failed = { audienceQueued: false, controlsQueued: false };
    const sessionId = context.presentationSessionId;
    const recipient = context.getRecipient(participantId);
    const publicKey = recipient?.publicKey;
    if (!sessionId || !publicKey || !context.isCurrent() || !context.signals.keyId
      || !text.trim() || text.length > 1000 || !globalThis.crypto?.randomUUID) return failed;
    const epoch = context.getEpoch(), initialGeneration = generation.current;
    const isCurrent = () => generation.current === initialGeneration && current.current.isCurrent()
      && current.current.getEpoch() === epoch && current.current.presentationSessionId === sessionId
      && current.current.signals.keyId === context.signals.keyId
      && current.current.getRecipient(participantId)?.publicKey === publicKey
      && current.current.getRecipient(participantId)?.epoch === recipient?.epoch;
    const storedNick = localStorage.getItem('sefer_control_operator_nick')?.trim().slice(0, 50) || '';
    const operator = storedNick ? `Control (${storedNick})` : 'Control';
    const senderNick = localStorage.getItem('sefer_control_nick_public') === 'true' ? operator : 'Control';
    const operationId = crypto.randomUUID(), createdAt = Date.now();
    const conversationId = conversationIdFor(sessionId, participantId);
    const message: ConversationMessage = { id: operationId, conversationId, participantId,
      text: text.trim(), sender: operator, timestamp: createdAt };
    const delivery = { type: 'CHAT_RESPONSE', text: message.text, senderNick, timestamp: createdAt,
      operationId, conversationId, presentationSessionId: sessionId };
    if (new TextEncoder().encode(JSON.stringify(delivery)).length > 2800) return failed;
    append(message);
    const audienceQueued = await context.signals.sendPrivateSignalToParticipant(participantId, publicKey, delivery, isCurrent).catch(() => false);
    if (!isCurrent()) {
      if (generation.current === initialGeneration && current.current.isCurrent()) append({ ...message, audienceQueued, controlsQueued: false });
      return { audienceQueued, controlsQueued: false, operationId };
    }
    const controlsQueued = await context.signals.sendPrivateSignalToControls({ type: 'CONTROL_CONVERSATION_MESSAGE', version: 1,
      operationId, conversationId, presentationSessionId: sessionId, participantId,
      text: message.text, operator, createdAt, audienceQueued,
    }, isCurrent).catch(() => false);
    if (generation.current === initialGeneration && current.current.isCurrent()) append({ ...message, audienceQueued, controlsQueued });
    return { audienceQueued, controlsQueued, operationId };
  }, [append]);
  return { messages, receive, send, clear };
}
