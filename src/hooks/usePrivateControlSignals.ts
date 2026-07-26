import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ControlKeyRotatedMessage,
  LiveAudioControlAuthorizedMessage,
  LiveAudioControlKeyTransferResultMessage,
  LiveAudioControlJoinRequestMessage,
  PrivateControlSignalMessage,
} from '../types/liveAudio';
import {
  advanceControlAuthorizationAttempt,
  createControlAuthorizationAttempt,
  type ControlAuthorizationAttempt,
} from '../features/liveAudio/utils/controlAuthorizationFlow';
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
type LiveAudioControlState = 'PRINCIPAL' | 'AUTHORIZED_SYNCING' | 'AUTHORIZED' | 'PENDING';
type WsSubscriber = (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
type WsSender = (type: string, payload?: unknown) => boolean;

export interface DecryptedPrivateControlSignal {
  fromParticipantId: string;
  keyId: string;
  plaintext: string;
  value: unknown;
  receivedAt: number;
  ephemeralPublicKey?: string;
}

export interface UsePrivateControlSignalsOptions {
  role: PrivateSignalRole;
  participantId: string;
  controlSessionId?: string;
  controlState?: LiveAudioControlState | null;
  sendMessage: WsSender;
  subscribeToWsMessage: WsSubscriber;
  transportReady?: boolean;
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
  sendPrivateSignalToParticipant: (participantId: string, participantPublicKeyBase64: string, value: unknown) => Promise<boolean>;
  getAudiencePublicKey: () => Promise<string | null>;
  requestAliases: () => Promise<boolean>;
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

const classifyPrivateSignal = (value: unknown): PrivateControlSignalMessage['signalClass'] => {
  if (value && typeof value === 'object' && 'type' in value) {
    const signalType = String((value as { type?: unknown }).type);
    if (signalType === 'PRIVATE_MESSAGE' || signalType === 'message') return 'PRIVATE_MESSAGE';
    if (signalType === 'ACTIVE_PROFILE' || signalType.includes('ALIAS')) return 'PROFILE_STATE';
  }
  return 'CONTROL_STATE';
};

export function usePrivateControlSignals(options: UsePrivateControlSignalsOptions): PrivateControlSignalsState {
  const {
    role,
    participantId,
    sendMessage,
    subscribeToWsMessage,
    transportReady = true,
    controlSessionId: providedControlSessionId,
    controlState,
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
  const pendingAuthorizationTransfersRef = useRef(new Map<string, {
    attempt: ControlAuthorizationAttempt;
    resolve: (approved: boolean) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>());

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
    for (const pending of pendingAuthorizationTransfersRef.current.values()) {
      clearTimeout(pending.timeoutId);
      pending.resolve(false);
    }
    pendingAuthorizationTransfersRef.current.clear();
  }, []);

  const ensureAudienceKeyPair = useCallback(async () => {
    const keyPair = audienceKeyPairRef.current ?? await generateEphemeralKeyPair();
    audienceKeyPairRef.current = keyPair;
    return keyPair;
  }, []);

  const publishControlPublicKey = useCallback(async () => {
    if (role !== 'control' || !transportReady) return;

    if (controlState !== 'PRINCIPAL') {
      return;
    }

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
  }, [controlSessionId, role, transportReady, controlState]);

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
    const audienceKeyPair = await ensureAudienceKeyPair();
    const sharedKey = await deriveSharedKey(audienceKeyPair.privateKey, controlKey);

    audienceKeyPairRef.current = audienceKeyPair;
    audienceSharedKeyRef.current = sharedKey;
    currentKeyIdRef.current = nextKeyId;
    currentControlPublicKeyRef.current = publicKeyBase64;
    usedNonceKeysRef.current.clear();
    setKeyId(nextKeyId);
    setControlPublicKey(publicKeyBase64);
  }, [ensureAudienceKeyPair]);

  const getAudiencePublicKey = useCallback(async (): Promise<string | null> => {
    if (role !== 'audience') return null;
    const keyPair = await ensureAudienceKeyPair();
    return exportPublicKey(keyPair);
  }, [ensureAudienceKeyPair, role]);

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
      signalClass: classifyPrivateSignal(value),
      fromParticipantId: participantId,
      ...(signalOptions.toControlSessionId ? { toControlSessionId: signalOptions.toControlSessionId } : {}),
      keyId: activeKeyId,
      ephemeralPublicKey,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [participantId, role]);

  const sendPrivateSignalToParticipant = useCallback(async (
    targetParticipantId: string,
    targetPublicKeyBase64: string,
    value: unknown
  ): Promise<boolean> => {
    if (role !== 'control' || !sessionKeyPairRef.current || !currentKeyIdRef.current || !currentControlPublicKeyRef.current) return false;

    const participantPublicKey = await importPublicKey(targetPublicKeyBase64);
    const sharedKey = await deriveSharedKey(sessionKeyPairRef.current.privateKey, participantPublicKey);
    const encrypted = await encrypt(sharedKey, serializeSignalValue(value));

    const message = makeSyncMessage({
      type: 'PRIVATE_CONTROL_SIGNAL' as const,
      signalClass: classifyPrivateSignal(value),
      fromParticipantId: participantId,
      toParticipantId: targetParticipantId,
      keyId: currentKeyIdRef.current,
      ephemeralPublicKey: currentControlPublicKeyRef.current,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [participantId, role]);

  const requestAliases = useCallback(async (): Promise<boolean> => {
    if (role !== 'control' || !transportReady) return false;
    const message = makeSyncMessage({ type: 'LIVE_AUDIO_REQUEST_ALIASES' as const });
    return sendMessageRef.current(message.type, message);
  }, [role, transportReady]);

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
    const transferId = createId('control-transfer');

    const message = makeSyncMessage({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZED' as const,
      controlSessionId: request.controlSessionId,
      authorizedByControlSessionId: controlSessionId,
      transferId,
      keyId: currentKeyIdRef.current,
      sessionPublicKey: currentControlPublicKeyRef.current,
      transferPublicKey: await exportPublicKey(transferKeyPair),
      encryptedSessionPrivateKey: encrypted.ciphertext,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    });

    const attempt = createControlAuthorizationAttempt({
      targetControlSessionId: request.controlSessionId,
      transferId,
      keyId: currentKeyIdRef.current,
      expiresAt: Date.now() + 10_000,
    });

    return new Promise<boolean>((resolve) => {
      const timeoutId = setTimeout(() => {
        const pending = pendingAuthorizationTransfersRef.current.get(transferId);
        if (!pending) return;
        const transition = advanceControlAuthorizationAttempt(
          pending.attempt,
          { type: 'TIMEOUT' },
          Date.now(),
        );
        pendingAuthorizationTransfersRef.current.delete(transferId);
        pending.resolve(transition.shouldApprove);
      }, 10_000);

      pendingAuthorizationTransfersRef.current.set(transferId, { attempt, resolve, timeoutId });
      if (!sendMessageRef.current(message.type, message)) {
        clearTimeout(timeoutId);
        pendingAuthorizationTransfersRef.current.delete(transferId);
        const transition = advanceControlAuthorizationAttempt(
          attempt,
          { type: 'TRANSFER_FAILED', reason: 'SEND_FAILED' },
          Date.now(),
        );
        resolve(transition.shouldApprove);
      }
    });
  }, [controlSessionId, role, transportReady]);

  const handlePrivateControlSignal = useCallback(async (payload: Record<string, unknown>) => {
    const signal = payload as unknown as PrivateControlSignalMessage;

    if (role === 'control') {
      if (!isValidPrivateControlSignal(payload, 'audience')) return;
      if (!sessionKeyPairRef.current || payload.keyId !== currentKeyIdRef.current) return;

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
        ephemeralPublicKey: signal.ephemeralPublicKey,
      });
    } else if (role === 'audience') {
      if (!audienceSharedKeyRef.current || payload.keyId !== currentKeyIdRef.current) return;
      if (signal.toParticipantId !== participantId) return;

      const plaintext = await decryptWithNonceReplayProtection(
        audienceSharedKeyRef.current,
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
    }
  }, [role, participantId]);

  const handleControlAuthorized = useCallback(async (payload: Record<string, unknown>) => {
    if (role !== 'control' || payload.controlSessionId !== controlSessionId) return;

    const message = payload as unknown as LiveAudioControlAuthorizedMessage;
    if (
      !message.transferId ||
      !message.encryptedSessionPrivateKey ||
      !message.nonce ||
      !message.transferPublicKey ||
      !message.sessionPublicKey ||
      !message.keyId ||
      !authorizationKeyPairRef.current
    ) {
      sendMessageRef.current('LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT', makeSyncMessage({
        type: 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT',
        controlSessionId,
        transferId: message.transferId || 'invalid-transfer',
        keyId: message.keyId || 'invalid-key',
        result: 'NACK',
        reason: 'INVALID_TRANSFER',
        createdAt: Date.now(),
      }));
      return;
    }

    try {
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
      sendMessageRef.current('LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT', makeSyncMessage({
        type: 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT',
        controlSessionId,
        transferId: message.transferId,
        keyId: message.keyId,
        result: 'ACK',
        createdAt: Date.now(),
      }));
    } catch (error) {
      sendMessageRef.current('LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT', makeSyncMessage({
        type: 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT',
        controlSessionId,
        transferId: message.transferId,
        keyId: message.keyId,
        result: 'NACK',
        reason: 'IMPORT_FAILED',
        createdAt: Date.now(),
      }));
      throw error;
    }
  }, [controlSessionId, role]);

  const handleControlTransferResult = useCallback((payload: Record<string, unknown>) => {
    const message = payload as unknown as LiveAudioControlKeyTransferResultMessage;
    const pending = pendingAuthorizationTransfersRef.current.get(message.transferId);
    if (!pending) return;
    const transition = advanceControlAuthorizationAttempt(
      pending.attempt,
      {
        type: 'ACK_RECEIVED',
        ack: {
          outcome: message.result,
          targetControlSessionId: message.controlSessionId,
          transferId: message.transferId,
          keyId: message.keyId,
          reason: message.reason,
        },
      },
      Date.now(),
    );
    if (transition.attempt === pending.attempt) return;
    clearTimeout(pending.timeoutId);
    pendingAuthorizationTransfersRef.current.delete(message.transferId);
    pending.resolve(transition.shouldApprove);
  }, []);

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
        return;
      }

      if (type === 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT') {
        handleControlTransferResult(payload);
      }
    });

    return unsubscribe;
  }, [
    clearPrivateState,
    handleControlAuthorized,
    handleControlTransferResult,
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
    sendPrivateSignalToParticipant,
    getAudiencePublicKey,
    requestAliases,
    requestControlAuthorization,
    authorizeSecondaryControl,
    clearPrivateState,
  };
}
