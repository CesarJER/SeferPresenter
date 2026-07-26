import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LiveAudioControlAuthorizationStateMessage,
  LiveAudioControlState,
  PendingControlAuthorization,
} from '../types/liveAudio';
import { makeSyncMessage } from '../utils/syncProtocol';
import type { WebSocketConnectionStatus } from './useWebSocket';

type WsSubscriber = (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
type WsSender = (type: string, payload?: unknown) => boolean;

export interface UseControlAuthorizationOptions {
  wsStatus: WebSocketConnectionStatus;
  sendMessage: WsSender;
  subscribeToWsMessage: WsSubscriber;
}

export interface ControlAuthorizationState {
  controlSessionId: string | null;
  controlState: LiveAudioControlState | null;
  principalControlSessionId: string | null;
  verificationCode: string | null;
  codeExpiresAt: number | null;
  secondsRemaining: number;
  pendingControls: PendingControlAuthorization[];
  allowDelegatedModerators: boolean;
  canAuthorize: boolean;
  approveControl: (controlSessionId: string) => boolean;
  rejectControl: (controlSessionId: string) => boolean;
}

const getSecondsRemaining = (expiresAt: number | null): number => {
  if (!expiresAt) return 0;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
};

const isControlState = (value: unknown): value is LiveAudioControlState =>
  value === 'PRINCIPAL' || value === 'PENDING' || value === 'AUTHORIZED_SYNCING' || value === 'AUTHORIZED';

const normalizePendingControls = (value: unknown): PendingControlAuthorization[] => {
  if (!Array.isArray(value)) return [];

  return value.filter((entry): entry is PendingControlAuthorization => {
    if (!entry || typeof entry !== 'object') return false;
    const pending = entry as Partial<PendingControlAuthorization>;
    return (
      typeof pending.controlSessionId === 'string' &&
      typeof pending.verificationCode === 'string' &&
      typeof pending.codeExpiresAt === 'number' &&
      typeof pending.connectedAt === 'number'
    );
  });
};

export function useControlAuthorization(options: UseControlAuthorizationOptions): ControlAuthorizationState {
  const { wsStatus, sendMessage, subscribeToWsMessage } = options;
  const [controlSessionId, setControlSessionId] = useState<string | null>(null);
  const [controlState, setControlState] = useState<LiveAudioControlState | null>(null);
  const [principalControlSessionId, setPrincipalControlSessionId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [pendingControls, setPendingControls] = useState<PendingControlAuthorization[]>([]);
  const [allowDelegatedModerators, setAllowDelegatedModerators] = useState(true);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const sendMessageRef = useRef(sendMessage);
  const revisionRef = useRef<{
    presentationSessionId: string | null;
    serverEpoch: string | null;
    stateRevision: number;
  }>({
    presentationSessionId: null,
    serverEpoch: null,
    stateRevision: -1,
  });

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const canAuthorize = useMemo(() => {
    if (controlState === 'PRINCIPAL') return true;
    return allowDelegatedModerators && controlState === 'AUTHORIZED';
  }, [allowDelegatedModerators, controlState]);

  const applyAuthorizationState = useCallback((payload: Record<string, unknown>) => {
    const message = payload as unknown as LiveAudioControlAuthorizationStateMessage;

    if (typeof message.controlSessionId === 'string') setControlSessionId(message.controlSessionId);
    if (isControlState(message.controlState)) setControlState(message.controlState);
    setPrincipalControlSessionId(
      typeof message.principalControlSessionId === 'string' ? message.principalControlSessionId : null,
    );
    setVerificationCode(typeof message.verificationCode === 'string' ? message.verificationCode : null);
    setCodeExpiresAt(typeof message.codeExpiresAt === 'number' ? message.codeExpiresAt : null);
    setAllowDelegatedModerators(message.allowDelegatedModerators !== false);
    setPendingControls(normalizePendingControls(message.pendingControls));
  }, []);

  const acceptRevision = useCallback((payload: Record<string, unknown>): boolean => {
    const presentationSessionId = typeof payload.presentationSessionId === 'string'
      ? payload.presentationSessionId
      : null;
    const serverEpoch = typeof payload.serverEpoch === 'string' ? payload.serverEpoch : null;
    const stateRevision = Number.isInteger(payload.stateRevision) ? Number(payload.stateRevision) : null;
    if (!presentationSessionId || !serverEpoch || stateRevision === null) return true;

    const current = revisionRef.current;
    const sameStream = (
      current.presentationSessionId === presentationSessionId &&
      current.serverEpoch === serverEpoch
    );
    if (!sameStream) {
      revisionRef.current = { presentationSessionId, serverEpoch, stateRevision };
      return true;
    }
    if (stateRevision < current.stateRevision) return false;
    if (current.stateRevision >= 0 && stateRevision > current.stateRevision + 1) {
      sendMessageRef.current('LIVE_AUDIO_SNAPSHOT_REQUEST', makeSyncMessage({
        type: 'LIVE_AUDIO_SNAPSHOT_REQUEST',
        controlSessionId: undefined,
        lastAppliedStateRevision: current.stateRevision,
        reason: 'GAP',
        createdAt: Date.now(),
      }));
      return false;
    }
    revisionRef.current.stateRevision = stateRevision;
    return true;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'WELCOME') {
        if (typeof payload.controlSessionId === 'string') setControlSessionId(payload.controlSessionId);
        if (isControlState(payload.controlState)) setControlState(payload.controlState);
        if (
          typeof payload.presentationSessionId === 'string' &&
          typeof payload.serverEpoch === 'string' &&
          Number.isInteger(payload.stateRevision)
        ) {
          revisionRef.current = {
            presentationSessionId: payload.presentationSessionId,
            serverEpoch: payload.serverEpoch,
            stateRevision: Number(payload.stateRevision),
          };
        }
        return;
      }

      if (type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE') {
        if (!acceptRevision(payload)) return;
        applyAuthorizationState(payload);
        return;
      }

      if (type === 'LIVE_AUDIO_SNAPSHOT') {
        const snapshot = payload.snapshot;
        if (!snapshot || typeof snapshot !== 'object') return;
        const value = snapshot as Record<string, unknown>;
        if (
          typeof value.presentationSessionId === 'string' &&
          typeof value.serverEpoch === 'string' &&
          Number.isInteger(value.stateRevision)
        ) {
          revisionRef.current = {
            presentationSessionId: value.presentationSessionId,
            serverEpoch: value.serverEpoch,
            stateRevision: Number(value.stateRevision),
          };
        }
      }
    });

    return unsubscribe;
  }, [acceptRevision, applyAuthorizationState, subscribeToWsMessage]);

  useEffect(() => {
    setSecondsRemaining(getSecondsRemaining(codeExpiresAt));
    if (!codeExpiresAt) return;

    const timer = window.setInterval(() => {
      setSecondsRemaining(getSecondsRemaining(codeExpiresAt));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [codeExpiresAt]);

  useEffect(() => {
    if (wsStatus === 'closed' || wsStatus === 'error') {
      setPendingControls([]);
    }
  }, [wsStatus]);

  const sendDecision = useCallback((targetControlSessionId: string, decision: 'APPROVE' | 'REJECT') => {
    if (!controlSessionId || !canAuthorize) return false;

    const message = makeSyncMessage({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION' as const,
      targetControlSessionId,
      decision,
      issuedByControlSessionId: controlSessionId,
      createdAt: Date.now(),
    });

    return sendMessageRef.current(message.type, message);
  }, [canAuthorize, controlSessionId]);

  return {
    controlSessionId,
    controlState,
    principalControlSessionId,
    verificationCode,
    codeExpiresAt,
    secondsRemaining,
    pendingControls,
    allowDelegatedModerators,
    canAuthorize,
    approveControl: (targetControlSessionId: string) => sendDecision(targetControlSessionId, 'APPROVE'),
    rejectControl: (targetControlSessionId: string) => sendDecision(targetControlSessionId, 'REJECT'),
  };
}
