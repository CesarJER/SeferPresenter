import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePrivateControlSignals } from './usePrivateControlSignals';
import type { useAudienceAccess } from './useAudienceAccess';
import type { useAudienceSession } from './useAudienceSession';
import type { WebSocketConnectionStatus } from './useWebSocket';
import type { LiveAudioExternalBroadcastState } from '../types/liveAudio';

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
  const [microphoneConfig, setMicrophoneConfig] = useState<{ volume?: number; musicMode?: boolean } | null>(null);
  const [receivedControlMessages, setReceivedControlMessages] = useState<Array<{
    id: string; senderNick: string; text: string; timestamp: number;
  }>>([]);

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
        const text = payload.text.trim();
        setReceivedControlMessages(previous => [...previous, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          senderNick: typeof payload.senderNick === 'string' && payload.senderNick ? payload.senderNick : 'Control',
          text,
          timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
        }]);
      } else if (payload.type === 'VISIBLE_ACTIVE_PARTICIPANTS' && Array.isArray(payload.participants)) {
        setVisibleParticipants(payload.participants.filter((value): value is string => typeof value === 'string'));
      } else if (payload.type === 'SET_MICROPHONE_CONFIG') {
        setMicrophoneConfig(previous => ({ ...previous,
          ...(typeof payload.volume === 'number' ? { volume: payload.volume } : {}),
          ...(typeof payload.musicMode === 'boolean' ? { musicMode: payload.musicMode } : {}),
        }));
      }
    },
  });

  const { authorized, isCurrentWsBinding } = access;
  const { logout } = audienceSession;
  const { sendPrivateSignal } = privateSignals;
  const sendSessionMessage = useCallback((type: string, payload?: unknown) =>
    isCurrentWsBinding() && wsSend(type, payload), [isCurrentWsBinding, wsSend]);

  useEffect(() => subscribeToWsMessage((type, payload) => {
    if (type === 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE') {
      if (payload.state === 'off' || payload.state === 'live' || payload.state === 'recording') {
        setExternalBroadcastState(payload.state);
        if (typeof payload.revision === 'number' && Number.isInteger(payload.revision)) setExternalBroadcastRevision(payload.revision);
      }
      return;
    }
    if (!isCurrentWsBinding()) return;
    if (type === 'LIVE_AUDIO_REQUEST_ALIASES' && submittedAlias && !authorized) {
      void sendPrivateSignal({ type: 'ACCESS_REQUEST', alias: submittedAlias });
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
