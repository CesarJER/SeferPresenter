import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ControlKeyRotatedMessage,
  LiveAudioControlAuthorizedMessage,
  LiveAudioControlJoinRequestMessage,
  PrivateControlSignalMessage,
} from '../types/liveAudio';
import {
  decrypt,
  decryptWithNonceReplayProtection,
  deriveSharedKey,
  encrypt,
  exportPrivateKey,
  exportPublicKey,
  generateEphemeralKeyPair,
  generateSessionKeyPair,
  importPrivateKey,
  importPublicKey,
} from '../utils/cryptoUtils';
import { makeSyncMessage } from '../utils/syncProtocol';
import { isValidPrivateControlSignal } from '../utils/validation';

type PrivateSignalRole = 'control' | 'audience';
type WsSubscriber = (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
type WsSender = (type: string, payload?: unknown) => boolean;

export interface DecryptedPrivateControlSignal {
  fromParticipantId: string;
  keyId: string;
  plaintext: string;
  value: unknown;
  receivedAt: number;
}

export interface UsePrivateControlSignalsOptions {
  role: PrivateSignalRole;
  participantId: string;
  sendMessage: WsSender;
  subscribeToWsMessage: WsSubscriber;
  transportReady?: boolean;
  controlSessionId?: string;
  onPrivateSignal?: (signal: DecryptedPrivateControlSignal) => void;
  onControlKeyRotated?: (message: ControlKeyRotatedMessage) => void;
  onError?: (error: unknown) => void;
}

export interface SendPrivateSignalOptions {
  toControlSessionId?: string;
}

export interface PrivateControlSignalsState {
  controlSessionId: string;
  keyId: string | null;
  controlPublicKey: string | null;
  ready: boolean;
  publishControlPublicKey: () => Promise<void>;
  rotateControlKey: () => Promise<void>;
  sendPrivateSignal: (value: unknown, options?: SendPrivateSignalOptions) => Promise<boolean>;
  requestControlAuthorization: (verificationCode: string) => Promise<boolean>;
  authorizeSecondaryControl: (request: LiveAudioControlJoinRequestMessage) => Promise<boolean>;
  clearPrivateState: () => void;
}

const createId = (prefix: string): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${randomId}`;
};

const parseSignalPlaintext = (plaintext: string): unknown => {
  try {
    return JSON.parse(plaintext) as unknown;
  } catch {
    return plaintext;
  }
};

const serializeSignalValue = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

export function usePrivateControlSignals(options: UsePrivateControlSignalsOptions): PrivateControlSignalsState {
  const {
    role,
    participantId,
    sendMessage,
    subscribeToWsMessage,
    transportReady = true,
    controlSessionId: providedControlSessionId,
    onPrivateSignal,
    onControlKeyRotated,
    onError,
  } = options;

  const [keyId, setKeyId] = useState<string | null>(null);
  const [controlPublicKey, setControlPublicKey] = useState<string | null>(null);
  const controlSessionId = useMemo(
    () => providedControlSessionId ?? createId('control-session'),
    [providedControlSessionId],
  );

  const sessionKeyPairRef = useRef<CryptoKeyPair | null>(null);
  const audienceKeyPairRef = useRef<CryptoKeyPair | null>(null);
  const audienceSharedKeyRef = useRef<CryptoKey | null>(null);
  const authorizationKeyPairRef = useRef<CryptoKeyPair | null>(null);
  const usedNonceKeysRef = useRef<Set<string>>(new Set());
  const currentKeyIdRef = useRef<string | null>(null);
  const currentControlPublicKeyRef = useRef<string | null>(null);
  const sendMessageRef = useRef(sendMessage);
  const onPrivateSignalRef = useRef(onPrivateSignal);
  const onControlKeyRotatedRef = useRef(onControlKeyRotated);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
    onPrivateSignalRef.current = onPrivateSignal;
    onControlKeyRotatedRef.current = onControlKeyRotated;
    onErrorRef.current = onError;
  }, [sendMessage, onPrivateSignal, onControlKeyRotated, onError]);

  const reportError = useCallback((error: unknown) => {
    onErrorRef.current?.(error);
  }, []);

  const clearPrivateState = useCallback(() => {
    sessionKeyPairRef.current = null;
    audienceKeyPairRef.current = null;
    audienceSharedKeyRef.current = null;
    authorizationKeyPairRef.current = null;
    usedNonceKeysRef.current.clear();
    currentKeyIdRef.current = null;
    currentControlPublicKeyRef.current = null;
    setKeyId(null);
    setControlPublicKey(null);
  }, []);

  const publishControlPublicKey = useCallback(async () => {
    if (role !== 'control' || !transportReady) return;

    const keyPair = sessionKeyPairRef.current ?? await generateSessionKeyPair();
    sessionKeyPairRef.current = keyPair;

    const nextKeyId = currentKeyIdRef.current ?? createId('control-key');
    const publicKey = await exportPublicKey(keyPair);

    currentKeyIdRef.current = nextKeyId;
    currentControlPublicKeyRef.current = publicKey;
    setKeyId(nextKeyId);
    setControlPublicKey(publicKey);

    const message = makeSyncMessage({
      type: 'LIVE_AUDIO_CONTROL_PUBLIC_KEY' as const,
      controlSessionId,
      keyId: nextKeyId,
      publicKey,
      createdAt: Date.now(),
    });

    sendMessageRef.current(message.type, message);
  }, [controlSessionId, role, transportReady]);

  const rotateControlKey = useCallback(async () => {
    if (role !== 'control' || !transportReady) return;

    const keyPair = await generateSessionKeyPair();
    const nextKeyId = createId('control-key');
    const publicKey = await exportPublicKey(keyPair);

    sessionKeyPairRef.current = keyPair;
    usedNonceKeysRef.current.clear();
    currentKeyIdRef.current = nextKeyId;
    currentControlPublicKeyRef.current = publicKey;
    setKeyId(nextKeyId);
    setControlPublicKey(publicKey);

    const message = makeSyncMessage({
      type: 'CONTROL_KEY_ROTATED' as const,
      controlSessionId,
      keyId: nextKeyId,
      publicKey,
      createdAt: Date.now(),
    });

    sendMessageRef.current(message.type, message);
  }, [controlSessionId, role, transportReady]);

  const negotiateAudienceKey = useCallback(async (publicKeyBase64: string, nextKeyId: string) => {
    const controlKey = await importPublicKey(publicKeyBase64);
    const audienceKeyPair = await generateEphemeralKeyPair();
    const sharedKey = await deriveSharedKey(audienceKeyPair.privateKey, controlKey);

    audienceKeyPairRef.current = audienceKeyPair;
    audienceSharedKeyRef.current = sharedKey;
    currentKeyIdRef.current = nextKeyId;
    currentControlPublicKeyRef.current = publicKeyBase64;
    usedNonceKeysRef.current.clear();
    setKeyId(nextKeyId);
    setControlPublicKey(publicKeyBase64);
  }, []);

  const sendPrivateSignal = useCallback(async (
    value: unknown,
    signalOptions: SendPrivateSignalOptions = {},
  ): Promise<boolean> => {
    if (role !== 'audience') return false;

    const sharedKey = audienceSharedKeyRef.current;
    const audienceKeyPair = audienceKeyPairRef.current;
    const activeKeyId = currentKeyIdRef.current;

    if (!sharedKey || !audienceKeyPair || !activeKeyId) return false;

    const encrypted = await encrypt(sharedKey, serializeSignalValue(value));
    const ephemeralPublicKey = await exportPublicKey(audienceKeyPair);
    const message = makeSyncMessage({
      type: 'PRIVATE_CONTROL_SIGNAL' as const,
      fromParticipantId: participantId,
      toControlSessionId: signalOptions.toControlSessionId ?? controlSessionId,
      keyId: activeKeyId,
      ephemeralPublicKey,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [controlSessionId, participantId, role]);

  const requestControlAuthorization = useCallback(async (verificationCode: string): Promise<boolean> => {
    if (role !== 'control' || !transportReady) return false;

    const keyPair = authorizationKeyPairRef.current ?? await generateEphemeralKeyPair();
    authorizationKeyPairRef.current = keyPair;

    const message = makeSyncMessage({
      type: 'LIVE_AUDIO_CONTROL_JOIN_REQUEST' as const,
      controlSessionId,
      verificationCode,
      recipientPublicKey: await exportPublicKey(keyPair),
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [controlSessionId, role, transportReady]);

  const authorizeSecondaryControl = useCallback(async (
    request: LiveAudioControlJoinRequestMessage,
  ): Promise<boolean> => {
    if (role !== 'control' || !transportReady || !request.recipientPublicKey) return false;
    if (!sessionKeyPairRef.current || !currentKeyIdRef.current || !currentControlPublicKeyRef.current) return false;

    const receiverPublicKey = await importPublicKey(request.recipientPublicKey);
    const transferKeyPair = await generateEphemeralKeyPair();
    const transferKey = await deriveSharedKey(transferKeyPair.privateKey, receiverPublicKey);
    const exportedPrivateKey = await exportPrivateKey(sessionKeyPairRef.current.privateKey);
    const encrypted = await encrypt(transferKey, exportedPrivateKey);

    const message = makeSyncMessage({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZED' as const,
      controlSessionId: request.controlSessionId,
      authorizedByControlSessionId: controlSessionId,
      keyId: currentKeyIdRef.current,
      sessionPublicKey: currentControlPublicKeyRef.current,
      transferPublicKey: await exportPublicKey(transferKeyPair),
      encryptedSessionPrivateKey: encrypted.ciphertext,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [controlSessionId, role, transportReady]);

  const handlePrivateControlSignal = useCallback(async (payload: Record<string, unknown>) => {
    if (role !== 'control') return;
    if (!isValidPrivateControlSignal(payload, 'audience')) return;
    if (!sessionKeyPairRef.current || payload.keyId !== currentKeyIdRef.current) return;

    const signal = payload as unknown as PrivateControlSignalMessage;
    const participantPublicKey = await importPublicKey(signal.ephemeralPublicKey);
    const sharedKey = await deriveSharedKey(sessionKeyPairRef.current.privateKey, participantPublicKey);
    const plaintext = await decryptWithNonceReplayProtection(
      sharedKey,
      signal.ciphertext,
      signal.nonce,
      usedNonceKeysRef.current,
    );

    onPrivateSignalRef.current?.({
      fromParticipantId: signal.fromParticipantId,
      keyId: signal.keyId,
      plaintext,
      value: parseSignalPlaintext(plaintext),
      receivedAt: Date.now(),
    });
  }, [role]);

  const handleControlAuthorized = useCallback(async (payload: Record<string, unknown>) => {
    if (role !== 'control' || payload.controlSessionId !== controlSessionId) return;

    const message = payload as unknown as LiveAudioControlAuthorizedMessage;
    if (
      !message.encryptedSessionPrivateKey ||
      !message.nonce ||
      !message.transferPublicKey ||
      !message.sessionPublicKey ||
      !message.keyId ||
      !authorizationKeyPairRef.current
    ) {
      return;
    }

    const senderPublicKey = await importPublicKey(message.transferPublicKey);
    const transferKey = await deriveSharedKey(authorizationKeyPairRef.current.privateKey, senderPublicKey);
    const exportedPrivateKey = await decrypt(transferKey, message.encryptedSessionPrivateKey, message.nonce);
    const privateKey = await importPrivateKey(exportedPrivateKey);
    const publicKey = await importPublicKey(message.sessionPublicKey);

    sessionKeyPairRef.current = { privateKey, publicKey };
    usedNonceKeysRef.current.clear();
    currentKeyIdRef.current = message.keyId;
    currentControlPublicKeyRef.current = message.sessionPublicKey;
    setKeyId(message.keyId);
    setControlPublicKey(message.sessionPublicKey);
  }, [controlSessionId, role]);

  useEffect(() => {
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'LIVE_AUDIO_CONTROL_PUBLIC_KEY' && role === 'audience') {
        const publicKey = typeof payload.publicKey === 'string' ? payload.publicKey : null;
        const nextKeyId = typeof payload.keyId === 'string' ? payload.keyId : null;
        if (publicKey && nextKeyId) {
          void negotiateAudienceKey(publicKey, nextKeyId).catch(reportError);
        }
        return;
      }

      if (type === 'CONTROL_KEY_ROTATED' && role === 'audience') {
        const rotation = payload as unknown as ControlKeyRotatedMessage;
        audienceKeyPairRef.current = null;
        audienceSharedKeyRef.current = null;
        usedNonceKeysRef.current.clear();
        if (typeof rotation.publicKey === 'string' && typeof rotation.keyId === 'string') {
          void negotiateAudienceKey(rotation.publicKey, rotation.keyId)
            .then(() => onControlKeyRotatedRef.current?.(rotation))
            .catch(reportError);
        } else {
          currentKeyIdRef.current = null;
          currentControlPublicKeyRef.current = null;
          setKeyId(null);
          setControlPublicKey(null);
        }
        return;
      }

      if (type === 'CONTROL_KEY_ROTATED' && role === 'control') {
        usedNonceKeysRef.current.clear();
        if (payload.reason === 'NO_AUTHORIZED_CONTROLS') {
          clearPrivateState();
        }
        return;
      }

      if (type === 'PRIVATE_CONTROL_SIGNAL') {
        void handlePrivateControlSignal(payload).catch(reportError);
        return;
      }

      if (type === 'LIVE_AUDIO_CONTROL_AUTHORIZED') {
        void handleControlAuthorized(payload).catch(reportError);
      }
    });

    return unsubscribe;
  }, [
    clearPrivateState,
    handleControlAuthorized,
    handlePrivateControlSignal,
    negotiateAudienceKey,
    reportError,
    role,
    subscribeToWsMessage,
  ]);

  useEffect(() => {
    if (role !== 'control' || !transportReady) return;
    void publishControlPublicKey().catch(reportError);
  }, [publishControlPublicKey, reportError, role, transportReady]);

  useEffect(() => clearPrivateState, [clearPrivateState]);

  return {
    controlSessionId,
    keyId,
    controlPublicKey,
    ready: role === 'control' ? Boolean(sessionKeyPairRef.current && keyId) : Boolean(audienceSharedKeyRef.current && keyId),
    publishControlPublicKey,
    rotateControlKey,
    sendPrivateSignal,
    requestControlAuthorization,
    authorizeSecondaryControl,
    clearPrivateState,
  };
}
