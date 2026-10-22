import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePrivateControlSignals } from './usePrivateControlSignals';
import type { useAudienceAccess } from './useAudienceAccess';
import type { useAudienceSession } from './useAudienceSession';
import type { WebSocketConnectionStatus } from './useWebSocket';
import type { LiveAudioExternalBroadcastState, LiveAudioConnectionState, MicrophoneTrackState } from '../types/liveAudio';
import { conversationIdFor, isConversationOperationId } from '../utils/privateConversations';

export interface AudienceMediaStatus {
  liveAudioConnectionState: LiveAudioConnectionState;
  isMicrophoneActive: boolean;
  microphoneTrackState: MicrophoneTrackState;
}

const unavailableMedia: AudienceMediaStatus = {
  liveAudioConnectionState: 'unavailable', isMicrophoneActive: false, microphoneTrackState: 'off',
};

export interface AudienceParticipationOptions {
  access: ReturnType<typeof useAudienceAccess>;
  audienceSession: ReturnType<typeof useAudienceSession>;
  wsStatus: WebSocketConnectionStatus;
  wsSend: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
}

export function useAudienceParticipationOwner({ access, audienceSession, wsStatus, wsSend, subscribeToWsMessage }: AudienceParticipationOptions) {
  const participantId = access.participantId;
  const [isActive, setIsActive] = useState(false);
  const [isPendingWord, setIsPendingWord] = useState(false);
  const [isWordGranted, setIsWordGranted] = useState(false);
  const [isKicked, setIsKicked] = useState(false);
  const [keyRotationCount, setKeyRotationCount] = useState(0);
  const [canViewActiveParticipants, setCanViewActiveParticipants] = useState(false);
  const [visibleParticipants, setVisibleParticipants] = useState<string[]>([]);
  const [externalBroadcastState, setExternalBroadcastState] = useState<LiveAudioExternalBroadcastState>('off');
  const [externalBroadcastRevision, setExternalBroadcastRevision] = useState(0);
  const [submittedAlias, setSubmittedAlias] = useState<string | null>(null);
  const lastPrivateProfileSignatureRef = useRef('');
  const [mediaStatus, setMediaStatus] = useState(unavailableMedia);
  const currentAccessRef = useRef(access);
  currentAccessRef.current = access;
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [microphoneConfig, setMicrophoneConfig] = useState<{ volume?: number; musicMode?: boolean } | null>(null);
  const [receivedControlMessages, setReceivedControlMessages] = useState<Array<{
    id: string; senderNick: string; text: string; timestamp: number; correlated?: boolean; replyTo?: string;
  }>>([]);
  const receivedOperations = useRef(new Set<string>());

  const privateSignals = usePrivateControlSignals({
    role: 'audience', participantId: participantId ?? '',
    sendMessage: wsSend, subscribeToWsMessage,
    transportReady: wsStatus === 'open' && Boolean(participantId && access.credential),
    isAudienceSessionCurrent: access.isCurrentWsBinding,
    getAudienceSessionEpoch: access.getWsBindingEpoch,
    onControlKeyRotated: () => setKeyRotationCount(value => value + 1),
    onPrivateSignal: signal => {
      const payload = signal.value as Record<string, unknown> | null;
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'CHAT_RESPONSE' && typeof payload.text === 'string' && payload.text.trim()) {
        const correlated = payload.operationId !== undefined || payload.conversationId !== undefined || payload.presentationSessionId !== undefined;
        const sessionId = currentAccessRef.current.presentationSessionId;
        if (correlated && (!currentAccessRef.current.authorized || !sessionId || !participantId
          || !isConversationOperationId(payload.operationId) || payload.presentationSessionId !== sessionId
          || payload.conversationId !== conversationIdFor(sessionId, participantId)
          || payload.text.length > 1000 || (payload.replyTo !== undefined && (typeof payload.replyTo !== 'string' || payload.replyTo.length > 256)))) return;
        const id = correlated ? payload.operationId as string : signal.signalId;
        if (!id || receivedOperations.current.has(id)) return;
        receivedOperations.current.add(id);
        const text = payload.text.trim();
        setReceivedControlMessages(previous => [...previous, {
          id, correlated, replyTo: typeof payload.replyTo === 'string' ? payload.replyTo : undefined,
          senderNick: typeof payload.senderNick === 'string' && payload.senderNick ? payload.senderNick : 'Control',
          text,
          timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
        }]);
      } else if (payload.type === 'VISIBLE_ACTIVE_PARTICIPANTS' && canViewActiveParticipants && Array.isArray(payload.participants)) {
        setVisibleParticipants(payload.participants.filter((value): value is string => typeof value === 'string'));
      } else if (payload.type === 'SET_MICROPHONE_CONFIG') {
        setMicrophoneConfig(previous => ({ ...previous,
          ...(typeof payload.volume === 'number' ? { volume: payload.volume } : {}),
          ...(typeof payload.musicMode === 'boolean' ? { musicMode: payload.musicMode } : {}),
        }));
      }
    },
  });

  const { authorized, isCurrentWsBinding, getWsBindingEpoch } = access;
  const { logout } = audienceSession;
  const { sendPrivateSignal, getAudiencePublicKey } = privateSignals;
  const sendSessionMessage = useCallback((type: string, payload?: unknown) =>
    isCurrentWsBinding() && wsSend(type, payload), [isCurrentWsBinding, wsSend]);

  const canParticipate = useCallback(() => mountedRef.current && currentAccessRef.current.authorized
    && currentAccessRef.current.isCurrentWsBinding(), []);
  const socialReady = wsStatus === 'open' && canParticipate() && privateSignals.ready;
  const mediaConnected = mediaStatus.liveAudioConnectionState === 'connected' || mediaStatus.liveAudioConnectionState === 'reconnected';
  const mediaGrantAvailable = isWordGranted && mediaConnected;

  const publishActiveProfile = useCallback(async (alias: string, visible: boolean) => {
    if (!alias || !canParticipate()) return false;
    const epoch = getWsBindingEpoch();
    const activeListPublicKey = await getAudiencePublicKey().catch(() => null);
    if (!activeListPublicKey || !canParticipate() || epoch !== getWsBindingEpoch()) return false;
    return sendSessionMessage('LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', {
      type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', participantId, activeListPublicKey,
      isAliasVisibleToActiveParticipants: visible, createdAt: Date.now(),
    });
  }, [getWsBindingEpoch, canParticipate, participantId, getAudiencePublicKey, sendSessionMessage]);

  const activate = useCallback((alias: string, visible: boolean) => {
    if (!canParticipate() || !privateSignals.ready || isKicked || !alias.trim()) return false;
    audienceSession.login(alias);
    audienceSession.setAliasVisible(visible);
    setIsActive(true); setIsPendingWord(false); setIsWordGranted(false);
    return true;
  }, [audienceSession, canParticipate, isKicked, privateSignals.ready]);

  const leave = useCallback(() => {
    setIsActive(false); setIsPendingWord(false); setIsWordGranted(false); setIsKicked(false);
    setCanViewActiveParticipants(false); setVisibleParticipants([]);
    sendSessionMessage('LIVE_AUDIO_PARTICIPANT_STATUS', {
      type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId, role: 'audience', speakerState: 'REVOKED',
      canSubscribe: true, canPublishAudio: false, isMuted: true, isActiveAudience: false,
      isMicrophoneActive: false, microphoneTrackState: 'off', liveAudioConnectionState: mediaStatus.liveAudioConnectionState,
      isKicked: false, updatedAt: Date.now(),
    });
    sendSessionMessage('AUDIENCE_ACCESS_LEAVE', { createdAt: Date.now() });
    audienceSession.logout();
  }, [audienceSession, mediaStatus.liveAudioConnectionState, participantId, sendSessionMessage]);

  const requestWord = useCallback(() => {
    if (!canParticipate() || !privateSignals.ready || !isActive || isKicked || mediaGrantAvailable) return;
    setIsPendingWord(true);
  }, [canParticipate, isActive, isKicked, mediaGrantAvailable, privateSignals.ready]);
  const cancelRequest = useCallback(() => {
    if (!canParticipate() || !privateSignals.ready || !isActive || isKicked) return;
    setIsPendingWord(false);
    void sendPrivateSignal({ type: 'CANCEL_REQUEST_WORD', alias: audienceSession.nick || undefined });
  }, [audienceSession.nick, canParticipate, isActive, isKicked, privateSignals.ready, sendPrivateSignal]);
  const sendPrivateMessage = useCallback((text: string, replyTo?: string) => {
    if (!privateSignals.ready || !isCurrentWsBinding() || isKicked) return Promise.resolve(false);
    const sessionId = currentAccessRef.current.presentationSessionId;
    if (!sessionId || !participantId || !text.trim() || text.length > 1000
      || (replyTo && !receivedOperations.current.has(replyTo))) return Promise.resolve(false);
    return sendPrivateSignal({ type: 'PRIVATE_MESSAGE', text: text.trim(), alias: audienceSession.nick || submittedAlias || undefined,
      operationId: crypto.randomUUID(), presentationSessionId: sessionId,
      conversationId: conversationIdFor(sessionId, participantId), createdAt: Date.now(), replyTo });
  }, [audienceSession.nick, isCurrentWsBinding, isKicked, participantId, privateSignals.ready, sendPrivateSignal, submittedAlias]);
  const changeAliasVisibility = useCallback((visible: boolean) => {
    if (canParticipate()) audienceSession.setAliasVisible(visible);
  }, [audienceSession, canParticipate]);

  useEffect(() => {
    if (canParticipate() && audienceSession.isLoggedIn && !isKicked) setIsActive(true);
  }, [audienceSession.isLoggedIn, canParticipate, isKicked, socialReady]);

  useEffect(() => {
    if (!socialReady) return;
    const microphoneActive = isActive && mediaGrantAvailable && mediaStatus.isMicrophoneActive;
    sendSessionMessage('LIVE_AUDIO_PARTICIPANT_STATUS', {
      type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId, role: 'audience',
      speakerState: !isActive ? 'REVOKED' : mediaGrantAvailable ? 'GRANTED' : isPendingWord ? 'REQUESTED' : 'LISTENER',
      canSubscribe: true, canPublishAudio: isActive && mediaGrantAvailable,
      isMuted: !microphoneActive, isActiveAudience: isActive,
      ...mediaStatus, isMicrophoneActive: microphoneActive,
      microphoneTrackState: isActive && mediaGrantAvailable ? mediaStatus.microphoneTrackState : 'off',
      isKicked, microphonePermissionState: 'unknown', updatedAt: Date.now(),
    });
  }, [isActive, isKicked, isPendingWord, mediaGrantAvailable, mediaStatus, participantId, sendSessionMessage, socialReady]);

  useEffect(() => {
    if (!socialReady || !isActive || !audienceSession.nick) return;
    const signature = JSON.stringify([privateSignals.keyId, keyRotationCount, getWsBindingEpoch(),
      audienceSession.nick, audienceSession.aliasVisible, isPendingWord, mediaGrantAvailable]);
    if (signature === lastPrivateProfileSignatureRef.current) return;
    let cancelled = false;
    const epoch = getWsBindingEpoch();
    void (async () => {
      if (!await publishActiveProfile(audienceSession.nick, audienceSession.aliasVisible)) return;
      if (cancelled || !canParticipate() || epoch !== getWsBindingEpoch()) return;
      const sent = await sendPrivateSignal({
        type: isPendingWord ? 'REQUEST_WORD' : mediaGrantAvailable ? 'ACTIVE_STATE' : 'ACTIVE_PROFILE',
        alias: audienceSession.nick, isAliasVisibleToActiveParticipants: audienceSession.aliasVisible,
        speakerState: mediaGrantAvailable ? 'GRANTED' : isPendingWord ? 'REQUESTED' : 'LISTENER',
      });
      if (sent && !cancelled) lastPrivateProfileSignatureRef.current = signature;
    })();
    return () => { cancelled = true; };
  }, [getWsBindingEpoch, audienceSession.aliasVisible, audienceSession.nick, canParticipate, isActive,
    isPendingWord, mediaGrantAvailable, keyRotationCount, privateSignals.keyId, publishActiveProfile, sendPrivateSignal, socialReady]);

  useEffect(() => subscribeToWsMessage((type, payload) => {
    if (type === 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE') {
      if (payload.state === 'off' || payload.state === 'live' || payload.state === 'recording') {
        setExternalBroadcastState(payload.state);
        if (typeof payload.revision === 'number' && Number.isInteger(payload.revision)) setExternalBroadcastRevision(payload.revision);
      }
      return;
    }
    if (!isCurrentWsBinding()) return;
    if (type === 'LIVE_AUDIO_REQUEST_ALIASES') {
      lastPrivateProfileSignatureRef.current = '';
      setKeyRotationCount(value => value + 1);
      if (submittedAlias && !authorized) void sendPrivateSignal({ type: 'ACCESS_REQUEST', alias: submittedAlias });
    } else if (type === 'LIVE_AUDIO_MUTE_ALL' && isWordGranted) {
      const excluded = Array.isArray(payload.excludeParticipantIds) ? payload.excludeParticipantIds : [];
      if (!excluded.includes(participantId)) { setIsActive(true); setIsPendingWord(false); }
    } else if (payload.participantId === participantId) {
      if (type === 'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION') {
        setCanViewActiveParticipants(payload.canViewActiveParticipants === true);
        if (!payload.canViewActiveParticipants) setVisibleParticipants([]);
      } else if (type === 'LIVE_AUDIO_GRANT_SPEAK' || type === 'LIVE_AUDIO_MUTE_PARTICIPANT') {
        setIsActive(true); setIsWordGranted(true); setIsPendingWord(false);
        if (type === 'LIVE_AUDIO_GRANT_SPEAK') setIsKicked(false);
      } else if (type === 'LIVE_AUDIO_REVOKE_SPEAK' || type === 'LIVE_AUDIO_RESCUE_PARTICIPANT') {
        setIsActive(true); setIsWordGranted(false); setIsPendingWord(false);
        if (type === 'LIVE_AUDIO_RESCUE_PARTICIPANT') setIsKicked(false);
      } else if (type === 'LIVE_AUDIO_KICK_PARTICIPANT' || type === 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT') {
        setIsActive(false); setIsPendingWord(false); setIsWordGranted(false);
        setIsKicked(type === 'LIVE_AUDIO_KICK_PARTICIPANT');
        setCanViewActiveParticipants(false); setVisibleParticipants([]);
        logout();
      }
    }
  }), [authorized, isCurrentWsBinding, isWordGranted, logout, participantId, sendPrivateSignal, submittedAlias, subscribeToWsMessage]);

  const dismissControlMessage = useCallback((id: string) => {
    setReceivedControlMessages(previous => previous.filter(message => message.id !== id));
  }, []);

  return {
    audienceSession, socialReady, canParticipate, activate, leave, requestWord, cancelRequest, sendPrivateMessage, changeAliasVisibility,
    setMediaStatus,
    participantId, privateSignals, sendSessionMessage, submittedAlias, setSubmittedAlias,
    lastPrivateProfileSignatureRef,
    receivedControlMessages, dismissControlMessage, microphoneConfig,
    isActive, setIsActive, isPendingWord, setIsPendingWord, isWordGranted, setIsWordGranted,
    isKicked, setIsKicked, keyRotationCount,
    canViewActiveParticipants, setCanViewActiveParticipants, visibleParticipants, setVisibleParticipants,
    externalBroadcastState, externalBroadcastRevision,
  };
}

export const AudienceParticipationContext = createContext<ReturnType<typeof useAudienceParticipationOwner> | null>(null);

export function useAudienceParticipation() {
  const value = useContext(AudienceParticipationContext);
  if (!value) throw new Error('Audience participation requires its stable owner');
  return value;
}
