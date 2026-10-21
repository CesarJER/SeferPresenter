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
type LiveAudioControlState = 'PRINCIPAL' | 'AUTHORIZED' | 'PENDING';
type WsSubscriber = (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
type WsSender = (type: string, payload?: unknown) => boolean;

export interface DecryptedPrivateControlSignal {
  fromParticipantId: string;
  keyId: string;
  plaintext: string;
  value: unknown;
  receivedAt: number;
  ephemeralPublicKey?: string;
  signalId?: string;
  isControlSignal?: boolean;
}

export interface UsePrivateControlSignalsOptions {
  role: PrivateSignalRole;
  participantId: string;
  controlSessionId?: string;
  controlState?: LiveAudioControlState | null;
  sendMessage: WsSender;
  subscribeToWsMessage: WsSubscriber;
  transportReady?: boolean;
  isAudienceSessionCurrent?: () => boolean;
  getAudienceSessionEpoch?: () => string;
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
  sendPrivateSignalToControls: (value: unknown) => Promise<boolean>;
  getAudiencePublicKey: () => Promise<string | null>;
  requestAliases: (targetParticipantIds?: string[]) => Promise<boolean>;
  requestControlAuthorization: (verificationCode: string) => Promise<boolean>;
  authorizeSecondaryControl: (request: LiveAudioControlJoinRequestMessage, aliases?: Record<string, string>) => Promise<boolean>;
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
  const audienceKeyPromiseRef = useRef<Promise<CryptoKeyPair> | null>(null);
  const audienceNegotiationRef = useRef<{ keyId: string; publicKey: string; epoch?: string; promise: Promise<void> } | null>(null);
  const audienceSharedKeyRef = useRef<CryptoKey | null>(null);
  const authorizationKeyPairRef = useRef<CryptoKeyPair | null>(null);
  const usedNonceKeysRef = useRef<Set<string>>(new Set());
  const currentKeyIdRef = useRef<string | null>(null);
  const currentControlPublicKeyRef = useRef<string | null>(null);
  const lastAliasRequestTimeRef = useRef<number>(0);
  const privateGenerationRef = useRef(0);
  const contextRef = useRef({ transportReady, controlState, isAudienceSessionCurrent: options.isAudienceSessionCurrent });
  contextRef.current = { transportReady, controlState, isAudienceSessionCurrent: options.isAudienceSessionCurrent };
  const isAudienceCurrent = useCallback(() => contextRef.current.transportReady
    && (contextRef.current.isAudienceSessionCurrent?.() ?? true), []);
  const audienceEpochRef = useRef(options.getAudienceSessionEpoch);
  audienceEpochRef.current = options.getAudienceSessionEpoch;
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
    privateGenerationRef.current += 1;
    sessionKeyPairRef.current = null;
    audienceKeyPairRef.current = null;
    audienceKeyPromiseRef.current = null;
    audienceNegotiationRef.current = null;
    audienceSharedKeyRef.current = null;
    authorizationKeyPairRef.current = null;
    usedNonceKeysRef.current = new Set();
    currentKeyIdRef.current = null;
    currentControlPublicKeyRef.current = null;
    setKeyId(null);
    setControlPublicKey(null);
  }, []);

  const ensureAudienceKeyPair = useCallback(async () => {
    const generation = privateGenerationRef.current;
    const epoch = audienceEpochRef.current?.();
    if (!audienceKeyPairRef.current && !audienceKeyPromiseRef.current) {
      const pending = generateEphemeralKeyPair();
      audienceKeyPromiseRef.current = pending;
      void pending.catch(() => {
        if (audienceKeyPromiseRef.current === pending) audienceKeyPromiseRef.current = null;
      });
    }
    const keyPair = audienceKeyPairRef.current ?? await audienceKeyPromiseRef.current!;
    if (generation !== privateGenerationRef.current || epoch !== audienceEpochRef.current?.() || !isAudienceCurrent()) throw new Error('Private session changed');
    audienceKeyPairRef.current = keyPair;
    return keyPair;
  }, [isAudienceCurrent]);

  const publishControlPublicKey = useCallback(async () => {
    if (role !== 'control' || !transportReady) return;

    if (controlState !== 'PRINCIPAL') {
      return;
    }

    const generation = privateGenerationRef.current;
    const keyPair = sessionKeyPairRef.current ?? await generateSessionKeyPair();

    const nextKeyId = currentKeyIdRef.current ?? createId('control-key');
    const publicKey = await exportPublicKey(keyPair);
    if (generation !== privateGenerationRef.current || !contextRef.current.transportReady) return;
    sessionKeyPairRef.current = keyPair;

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

    const generation = privateGenerationRef.current;
    const keyPair = await generateSessionKeyPair();
    const nextKeyId = createId('control-key');
    const publicKey = await exportPublicKey(keyPair);
    if (generation !== privateGenerationRef.current || !contextRef.current.transportReady) return;
    privateGenerationRef.current += 1;

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

  const negotiateAudienceKey = useCallback((publicKeyBase64: string, nextKeyId: string): Promise<void> => {
    if (!isAudienceCurrent()) return Promise.resolve();
    const epoch = audienceEpochRef.current?.();
    if (currentKeyIdRef.current === nextKeyId && currentControlPublicKeyRef.current === publicKeyBase64) return Promise.resolve();
    const pending = audienceNegotiationRef.current;
    if (pending?.keyId === nextKeyId && pending.publicKey === publicKeyBase64 && pending.epoch === epoch) return pending.promise;
    const existingKeyPair = audienceKeyPairRef.current;
    const existingKeyPromise = audienceKeyPromiseRef.current;
    clearPrivateState();
    audienceKeyPairRef.current = existingKeyPair;
    audienceKeyPromiseRef.current = existingKeyPromise;
    const generation = privateGenerationRef.current;
    const promise = (async () => {
      const controlKey = await importPublicKey(publicKeyBase64);
      if (generation !== privateGenerationRef.current || epoch !== audienceEpochRef.current?.() || !isAudienceCurrent()) return;
      const audienceKeyPair = await ensureAudienceKeyPair();
      const sharedKey = await deriveSharedKey(audienceKeyPair.privateKey, controlKey);
      if (generation !== privateGenerationRef.current || epoch !== audienceEpochRef.current?.() || !isAudienceCurrent()) return;

      audienceKeyPairRef.current = audienceKeyPair;
      audienceSharedKeyRef.current = sharedKey;
      currentKeyIdRef.current = nextKeyId;
      currentControlPublicKeyRef.current = publicKeyBase64;
      usedNonceKeysRef.current.clear();
      setKeyId(nextKeyId);
      setControlPublicKey(publicKeyBase64);
    })();
    audienceNegotiationRef.current = { keyId: nextKeyId, publicKey: publicKeyBase64, epoch, promise };
    void promise.finally(() => {
      if (audienceNegotiationRef.current?.promise === promise) audienceNegotiationRef.current = null;
    }).catch(() => {});
    return promise;
  }, [clearPrivateState, ensureAudienceKeyPair, isAudienceCurrent]);

  const getAudiencePublicKey = useCallback(async (): Promise<string | null> => {
    if (role !== 'audience' || !isAudienceCurrent()) return null;
    const generation = privateGenerationRef.current;
    const epoch = audienceEpochRef.current?.();
    let keyPair: CryptoKeyPair;
    try {
      keyPair = await ensureAudienceKeyPair();
    } catch (error) {
      if (generation !== privateGenerationRef.current || epoch !== audienceEpochRef.current?.() || !isAudienceCurrent()) return null;
      throw error;
    }
    const publicKey = await exportPublicKey(keyPair);
    return generation === privateGenerationRef.current && epoch === audienceEpochRef.current?.() && isAudienceCurrent() ? publicKey : null;
  }, [ensureAudienceKeyPair, isAudienceCurrent, role]);

  const sendPrivateSignal = useCallback(async (
    value: unknown,
    signalOptions: SendPrivateSignalOptions = {},
  ): Promise<boolean> => {
    if (role !== 'audience' || !participantId || !isAudienceCurrent()) return false;
    const generation = privateGenerationRef.current;
    const epoch = audienceEpochRef.current?.();

    const sharedKey = audienceSharedKeyRef.current;
    const audienceKeyPair = audienceKeyPairRef.current;
    const activeKeyId = currentKeyIdRef.current;

    if (!sharedKey || !audienceKeyPair || !activeKeyId) return false;

    const encrypted = await encrypt(sharedKey, serializeSignalValue(value));
    const ephemeralPublicKey = await exportPublicKey(audienceKeyPair);
    if (generation !== privateGenerationRef.current || sharedKey !== audienceSharedKeyRef.current
      || epoch !== audienceEpochRef.current?.() || !isAudienceCurrent()) return false;
    const message = makeSyncMessage({
      type: 'PRIVATE_CONTROL_SIGNAL' as const,
      fromParticipantId: participantId,
      ...(signalOptions.toControlSessionId ? { toControlSessionId: signalOptions.toControlSessionId } : {}),
      keyId: activeKeyId,
      ephemeralPublicKey,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [isAudienceCurrent, participantId, role]);

  const sendPrivateSignalToParticipant = useCallback(async (
    targetParticipantId: string,
    targetPublicKeyBase64: string,
    value: unknown
  ): Promise<boolean> => {
    if (role !== 'control' || !sessionKeyPairRef.current || !currentKeyIdRef.current || !currentControlPublicKeyRef.current) return false;
    const generation = privateGenerationRef.current;
    const keyPair = sessionKeyPairRef.current;
    const activeKeyId = currentKeyIdRef.current;
    const publicKey = currentControlPublicKeyRef.current;

    const participantPublicKey = await importPublicKey(targetPublicKeyBase64);
    const sharedKey = await deriveSharedKey(keyPair.privateKey, participantPublicKey);
    const encrypted = await encrypt(sharedKey, serializeSignalValue(value));
    if (generation !== privateGenerationRef.current || keyPair !== sessionKeyPairRef.current
      || !contextRef.current.transportReady
      || !['PRINCIPAL', 'AUTHORIZED'].includes(contextRef.current.controlState ?? '')) return false;

    const message = makeSyncMessage({
      type: 'PRIVATE_CONTROL_SIGNAL' as const,
      fromParticipantId: participantId,
      toParticipantId: targetParticipantId,
      keyId: activeKeyId,
      ephemeralPublicKey: publicKey,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [participantId, role]);

  const sendPrivateSignalToControls = useCallback(async (
    value: unknown
  ): Promise<boolean> => {
    if (role !== 'control' || !sessionKeyPairRef.current || !currentKeyIdRef.current || !currentControlPublicKeyRef.current) return false;
    const generation = privateGenerationRef.current;
    const keyPair = sessionKeyPairRef.current;
    const activeKeyId = currentKeyIdRef.current;
    const publicKey = currentControlPublicKeyRef.current;

    const sharedKey = await deriveSharedKey(keyPair.privateKey, keyPair.publicKey);
    const encrypted = await encrypt(sharedKey, serializeSignalValue(value));
    if (generation !== privateGenerationRef.current || keyPair !== sessionKeyPairRef.current
      || !contextRef.current.transportReady
      || !['PRINCIPAL', 'AUTHORIZED'].includes(contextRef.current.controlState ?? '')) return false;

    const message = makeSyncMessage({
      type: 'PRIVATE_CONTROL_SIGNAL' as const,
      fromParticipantId: participantId,
      keyId: activeKeyId,
      ephemeralPublicKey: publicKey,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [participantId, role]);

  const requestAliases = useCallback(async (targetParticipantIds?: string[]): Promise<boolean> => {
    if (role !== 'control' || !transportReady) return false;
    
    const now = Date.now();
    if (now - lastAliasRequestTimeRef.current < 10_000) return false;
    lastAliasRequestTimeRef.current = now;

    const message = makeSyncMessage({ type: 'LIVE_AUDIO_REQUEST_ALIASES' as const, targetParticipantIds });
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
    aliases?: Record<string, string>,
  ): Promise<boolean> => {
    if (role !== 'control' || !transportReady || !request.recipientPublicKey) return false;
    if (!sessionKeyPairRef.current || !currentKeyIdRef.current || !currentControlPublicKeyRef.current) return false;

    const receiverPublicKey = await importPublicKey(request.recipientPublicKey);
    const transferKeyPair = await generateEphemeralKeyPair();
    const transferKey = await deriveSharedKey(transferKeyPair.privateKey, receiverPublicKey);
    const exportedPrivateKey = await exportPrivateKey(sessionKeyPairRef.current.privateKey);
    const encrypted = await encrypt(transferKey, exportedPrivateKey);

    let encryptedAliases;
    if (aliases) {
      encryptedAliases = await encrypt(transferKey, JSON.stringify(aliases));
    }

    const message = makeSyncMessage({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZED' as const,
      controlSessionId: request.controlSessionId,
      authorizedByControlSessionId: controlSessionId,
      keyId: currentKeyIdRef.current,
      sessionPublicKey: currentControlPublicKeyRef.current,
      transferPublicKey: await exportPublicKey(transferKeyPair),
      encryptedSessionPrivateKey: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptedAliases: encryptedAliases?.ciphertext,
      aliasesNonce: encryptedAliases?.nonce,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [controlSessionId, role, transportReady]);

  const handlePrivateControlSignal = useCallback(async (payload: Record<string, unknown>) => {
    const signal = payload as unknown as PrivateControlSignalMessage;
    const generation = privateGenerationRef.current;
    const epoch = audienceEpochRef.current?.();

    if (role === 'control') {
      if (!['PRINCIPAL', 'AUTHORIZED'].includes(contextRef.current.controlState ?? '')) return;
      if (!isValidPrivateControlSignal(payload, 'audience') && !isValidPrivateControlSignal(payload, 'control')) return;
      if (!sessionKeyPairRef.current || payload.keyId !== currentKeyIdRef.current) return;

      const participantPublicKey = await importPublicKey(signal.ephemeralPublicKey);
      const sharedKey = await deriveSharedKey(sessionKeyPairRef.current.privateKey, participantPublicKey);
      const plaintext = await decryptWithNonceReplayProtection(
        sharedKey,
        signal.ciphertext,
        signal.nonce,
        usedNonceKeysRef.current,
      );
      if (generation !== privateGenerationRef.current || signal.keyId !== currentKeyIdRef.current
        || !['PRINCIPAL', 'AUTHORIZED'].includes(contextRef.current.controlState ?? '')) return;

      onPrivateSignalRef.current?.({
        fromParticipantId: signal.fromParticipantId,
        keyId: signal.keyId,
        plaintext,
        value: parseSignalPlaintext(plaintext),
        receivedAt: Date.now(),
        ephemeralPublicKey: signal.ephemeralPublicKey,
        signalId: JSON.stringify([signal.keyId, signal.fromParticipantId, signal.nonce]),
        isControlSignal: !signal.toParticipantId && signal.ephemeralPublicKey === currentControlPublicKeyRef.current,
      });
    } else if (role === 'audience') {
      if (!isAudienceCurrent()) return;
      if (!audienceSharedKeyRef.current || payload.keyId !== currentKeyIdRef.current) return;
      if (signal.toParticipantId !== participantId) return;

      const plaintext = await decryptWithNonceReplayProtection(
        audienceSharedKeyRef.current,
        signal.ciphertext,
        signal.nonce,
        usedNonceKeysRef.current,
      );
      if (generation !== privateGenerationRef.current || signal.keyId !== currentKeyIdRef.current
        || epoch !== audienceEpochRef.current?.() || !isAudienceCurrent()) return;

      onPrivateSignalRef.current?.({
        fromParticipantId: signal.fromParticipantId,
        keyId: signal.keyId,
        plaintext,
        value: parseSignalPlaintext(plaintext),
        receivedAt: Date.now(),
      });
    }
  }, [isAudienceCurrent, role, participantId]);

  const handleControlAuthorized = useCallback(async (payload: Record<string, unknown>) => {
    if (role !== 'control' || payload.controlSessionId !== controlSessionId) return;
    const generation = privateGenerationRef.current;

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
    if (generation !== privateGenerationRef.current) return;

    sessionKeyPairRef.current = { privateKey, publicKey };
    usedNonceKeysRef.current.clear();
    currentKeyIdRef.current = message.keyId;
    currentControlPublicKeyRef.current = message.sessionPublicKey;
    setKeyId(message.keyId);
    setControlPublicKey(message.sessionPublicKey);

    if (message.encryptedAliases && message.aliasesNonce) {
      try {
        const decryptedAliasesJson = await decrypt(transferKey, message.encryptedAliases, message.aliasesNonce);
        const decryptedAliases = JSON.parse(decryptedAliasesJson);
        onPrivateSignalRef.current?.({
          type: 'PRIVATE_CONTROL_SIGNAL',
          fromParticipantId: 'system',
          toControlSessionId: controlSessionId,
          keyId: message.keyId,
          ephemeralPublicKey: '',
          ciphertext: '',
          plaintext: '',
          nonce: '',
          createdAt: Date.now(),
          receivedAt: Date.now(),
          value: {
            type: 'ALIASES_SYNC',
            aliases: decryptedAliases,
          }
        } as DecryptedPrivateControlSignal);
      } catch (e) {
        console.warn('LiveAudioControl: Failed to decrypt aliases from authorization message', e);
      }
    }
  }, [controlSessionId, role]);

  useEffect(() => {
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'PRESENTATION_SESSION_ROTATED') {
        clearPrivateState();
        return;
      }
      if (type === 'LIVE_AUDIO_CONTROL_PUBLIC_KEY' && role === 'audience') {
        const publicKey = typeof payload.publicKey === 'string' ? payload.publicKey : null;
        const nextKeyId = typeof payload.keyId === 'string' ? payload.keyId : null;
        if (publicKey && nextKeyId) {
          void negotiateAudienceKey(publicKey, nextKeyId).catch(reportError);
        }
        return;
      }

      if (type === 'CONTROL_KEY_ROTATED' && role === 'audience') {
        clearPrivateState();
        const rotation = payload as unknown as ControlKeyRotatedMessage;
        if (typeof rotation.publicKey === 'string' && typeof rotation.keyId === 'string') {
          const negotiation = negotiateAudienceKey(rotation.publicKey, rotation.keyId);
          const generation = privateGenerationRef.current;
          const epoch = audienceEpochRef.current?.();
          void negotiation
            .then(() => {
              if (privateGenerationRef.current === generation && epoch === audienceEpochRef.current?.()
                && isAudienceCurrent()) onControlKeyRotatedRef.current?.(rotation);
            })
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
        if (payload.reason === 'NO_AUTHORIZED_CONTROLS'
          || (typeof payload.keyId === 'string' && payload.keyId !== currentKeyIdRef.current)) {
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
    isAudienceCurrent,
    negotiateAudienceKey,
    reportError,
    role,
    subscribeToWsMessage,
  ]);

  useEffect(() => {
    if (role !== 'control' || !transportReady) return;
    void publishControlPublicKey().catch(reportError);
  }, [publishControlPublicKey, reportError, role, transportReady]);

  useEffect(() => clearPrivateState, [clearPrivateState, controlSessionId, role]);

  return {
    controlSessionId,
    keyId,
    controlPublicKey,
    ready: role === 'control' ? Boolean(sessionKeyPairRef.current && keyId) : Boolean(audienceSharedKeyRef.current && keyId && isAudienceCurrent()),
    publishControlPublicKey,
    rotateControlKey,
    sendPrivateSignal,
    sendPrivateSignalToParticipant,
    sendPrivateSignalToControls,
    getAudiencePublicKey,
    requestAliases,
    requestControlAuthorization,
    authorizeSecondaryControl,
    clearPrivateState,
  };
}
