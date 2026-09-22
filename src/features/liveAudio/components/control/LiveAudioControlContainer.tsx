import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import { Bell } from 'lucide-react';
import { LiveAudioControlPanel } from './LiveAudioControlPanel';
import { PrivateControlInbox, type PrivateMessage } from './PrivateControlInbox';
import type { LiveAudioParticipant } from './LiveAudioParticipantRow';
import { assignStableAliasOrdinal, formatAliasForControl, type AliasOrdinalState } from '../../utils/aliasOrdinals';
import { PwaRestartButton } from '../../../../components/shared/PwaRestartButton';
import type {
  LiveAudioConnectionCountsMessage,
  LiveAudioOperationalSnapshot,
  LiveAudioParticipantStatusMessage,
  PendingControlAuthorization,
  LiveAudioControlJoinRequestMessage,
  LiveAudioControlState,
  LiveAudioExternalBroadcastState,
} from '../../../../types/liveAudio';
import type { WebSocketConnectionStatus } from '../../../../hooks/useWebSocket';
import { useLiveAudioAvailability } from '../../hooks/useLiveAudioAvailability';
import { useLiveAudio } from '../../hooks/useLiveAudio';
import { usePrivateControlSignals, type DecryptedPrivateControlSignal } from '../../../../hooks/usePrivateControlSignals';
import { LiveAudioTrackOutput } from '../shared/LiveAudioTrackOutput';
import { getAudienceParticipantsNeedingAliasRequest } from '../../utils/liveAudioAliasRequests';
import {
  computeVisibleActiveParticipants,
  hasVisibleParticipantsChanged,
  serializeVisibleParticipants,
} from '../../utils/activeParticipants';
import type { ScriptureNavState } from '../../../../types/presentation';
import type { SeferReaderState } from '../../../../hooks/useSeferReader';

const VoiceScriptureControl = import.meta.env.VITE_SEFER_VOICE_SCRIPTURE_BUILD === 'true'
  ? lazy(() => import('../../../voiceScripture/VoiceScriptureControl'))
  : null;

type ModerationEndpoint =
  | 'grant-speak'
  | 'revoke-speak'
  | 'mute-participant'
  | 'mute-all'
  | 'kick-participant'
  | 'rescue-participant';

export interface LiveAudioControlContainerProps {
  scriptureState?: ScriptureNavState | null;
  voiceSuggestionsTarget?: HTMLElement | null;
  onProjectScripture?: (state: SeferReaderState, command?: 'navigate') => void;
  isControlAuthorized: boolean;
  authorizationRequests?: PendingControlAuthorization[];
  onApproveRequest?: (sessionId: string) => void;
  onRejectRequest?: (sessionId: string) => void;
  wsSend?: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage?: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
  wsStatus?: WebSocketConnectionStatus;
  controlSessionId?: string | null;
  controlState?: LiveAudioControlState | null;
  verificationCode?: string | null;
}

const getSignalRecord = (signal: DecryptedPrivateControlSignal): Record<string, unknown> => {
  if (signal.value && typeof signal.value === 'object' && !Array.isArray(signal.value)) {
    return signal.value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(signal.plaintext) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const sanitizeAlias = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const alias = value.trim().slice(0, 80);
  return alias || null;
};

const clampVolume = (volume: number) => Math.max(0, Math.min(volume, 300));
const clampListenVolume = (volume: number) => Math.max(0, Math.min(volume, 100));

const snapshotParticipantToStatus = (
  participant: LiveAudioOperationalSnapshot['participants'][number],
): LiveAudioParticipantStatusMessage => ({
  type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
  participantId: participant.participantId,
  role: participant.role,
  speakerState: participant.speakerState,
  canSubscribe: participant.canSubscribe,
  canPublishAudio: participant.canPublishAudio,
  isMuted: participant.isMuted,
  isActiveAudience: participant.isActiveAudience,
  isMicrophoneActive: participant.isMicrophoneActive,
  isKicked: participant.isKicked,
  microphonePermissionState: participant.microphonePermissionState,
  microphoneTrackState: participant.microphoneTrackState,
  isAliasVisibleToActiveParticipants: participant.isAliasVisibleToActiveParticipants,
  canViewActiveParticipants: participant.canViewActiveParticipants,
  isAliasHiddenByControl: participant.isAliasHiddenByControl,
  activeListPublicKey: participant.activeListPublicKey,
  connected: participant.connected,
  updatedAt: participant.updatedAt,
});

export default function LiveAudioControlContainer({
  scriptureState = null,
  voiceSuggestionsTarget,
  onProjectScripture = () => { },
  isControlAuthorized,
  authorizationRequests = [],
  onApproveRequest = () => { },
  onRejectRequest = () => { },
  wsSend,
  subscribeToWsMessage,
  wsStatus,
  controlSessionId,
  controlState,
  verificationCode,
}: LiveAudioControlContainerProps) {
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [voiceReady, setVoiceReady] = useState(false);
  const [operatorNick, setOperatorNick] = useState(() => localStorage.getItem('sefer_control_operator_nick') || '');
  const [isModeratorMuted, setIsModeratorMuted] = useState(true);
  const [listenVolume, setListenVolume] = useState(100);
  const [microphoneVolume, setMicrophoneVolume] = useState(100);
  const [isModeratorMusicMode, setIsModeratorMusicMode] = useState(false);
  const [participantsMap, setParticipantsMap] = useState<Record<string, LiveAudioParticipantStatusMessage>>({});
  const [participantAliases, setParticipantAliases] = useState<Record<string, string>>({});
  const [participantAliasOrdinals, setParticipantAliasOrdinals] = useState<Record<string, number>>({});
  const aliasOrdinalStateRef = useRef<AliasOrdinalState>({ assignments: {}, nextByNormalizedAlias: {} });
  const [participantEphemeralKeys, setParticipantEphemeralKeys] = useState<Record<string, string>>({});
  const [participantMicrophoneConfigs, setParticipantMicrophoneConfigs] = useState<Record<string, { volume: number; musicMode: boolean }>>({});
  const [moderationError, setModerationError] = useState<string | null>(null);
  const [connectionCounts, setConnectionCounts] = useState<LiveAudioConnectionCountsMessage | null>(null);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [externalBroadcastState, setExternalBroadcastState] = useState<LiveAudioExternalBroadcastState>('off');
  const [externalBroadcastRevision, setExternalBroadcastRevision] = useState(0);
  const [joinRequests, setJoinRequests] = useState<Record<string, LiveAudioControlJoinRequestMessage>>({});
  const [accessMode, setAccessMode] = useState<'PUBLIC' | 'CONTROLLED'>('PUBLIC');
  const [audienceAccessRequests, setAudienceAccessRequests] = useState<Record<string, { requestedAt: number; accessState: 'WAITING' | 'BLOCKED' }>>({});
  const participantAliasesRef = useRef(participantAliases);
  const lastSentListRef = useRef('');
  const requestedAuthRef = useRef<string | null>(null);
  const moderatorConsentRevisionRef = useRef(0);
  const applyControllerConfig = useRef<(data: Record<string, unknown>) => void>(() => undefined);

  const { availability } = useLiveAudioAvailability();

  const {
    state,
    connectionQuality,
    publishMicrophone,
    unpublishMicrophone,
    isMicrophoneActive,
    participantId,
    remoteTracks,
    controlParticipants,
    localMicrophoneTrack,
    startRemoteAudio,
  } = useLiveAudio({
    role: 'control',
    controlSessionId: controlSessionId || undefined,
    autoConnect: availability === 'enabled' && isControlAuthorized,
    microphoneVolumePercent: microphoneVolume,
  });

  useEffect(() => {
    participantAliasesRef.current = participantAliases;
  }, [participantAliases]);

  useEffect(() => {
    setIsModeratorMuted(!isMicrophoneActive);
  }, [isMicrophoneActive]);

  useEffect(() => {
    if (externalBroadcastState === 'off') {
      moderatorConsentRevisionRef.current = externalBroadcastRevision;
      return;
    }
    if (moderatorConsentRevisionRef.current === externalBroadcastRevision) return;
    if (isMicrophoneActive) void unpublishMicrophone();
  }, [externalBroadcastRevision, externalBroadcastState, isMicrophoneActive, unpublishMicrophone]);

  useEffect(() => {
    if (!subscribeToWsMessage) return;
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'WELCOME' || type === 'SESSION_ACCESS_POLICY') {
        if (payload.accessMode === 'PUBLIC' || payload.accessMode === 'CONTROLLED') {
          setAccessMode(payload.accessMode);
          if (payload.accessMode === 'PUBLIC') setAudienceAccessRequests({});
        }
      }
      if (type === 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE') {
        const state = payload.state;
        const revision = payload.revision;
        if (state === 'off' || state === 'live' || state === 'recording') {
          setExternalBroadcastState(state);
          if (typeof revision === 'number' && Number.isInteger(revision) && revision >= 0) {
            setExternalBroadcastRevision(revision);
          }
        }
        return;
      }
      if (type === 'PRESENTATION_SESSION_ROTATED') {
        setParticipantsMap({});
        setParticipantAliases({});
        setParticipantAliasOrdinals({});
        aliasOrdinalStateRef.current = { assignments: {}, nextByNormalizedAlias: {} };
        setParticipantEphemeralKeys({});
        setMessages([]);
        setJoinRequests({});
        setConnectionCounts(null);
        setAudienceAccessRequests({});
        lastSentListRef.current = '';
        return;
      }
      if (type === 'LIVE_AUDIO_SNAPSHOT') {
        const snapshot = payload.snapshot as LiveAudioOperationalSnapshot | undefined;
        if (!snapshot || !Array.isArray(snapshot.participants)) return;
        setParticipantsMap(prev => {
          const next = { ...prev };
          snapshot.participants.forEach((participant) => {
            if (participant.role !== 'audience') return;
            const existing = next[participant.participantId];
            if (existing?.updatedAt && existing.updatedAt > participant.updatedAt) return;
            next[participant.participantId] = snapshotParticipantToStatus(participant);
          });
          return next;
        });
        setParticipantEphemeralKeys(prev => {
          const next = { ...prev };
          snapshot.participants.forEach((participant) => {
            if (participant.role !== 'audience') return;
            if (participant.activeListPublicKey) {
              next[participant.participantId] = participant.activeListPublicKey;
            } else if (participant.isActiveAudience === false && participant.isKicked !== true) {
              delete next[participant.participantId];
            }
          });
          return next;
        });
        setConnectionCounts({
          type: 'LIVE_AUDIO_CONNECTION_COUNTS',
          ...snapshot.connectionCounts,
        });
        setAccessMode(snapshot.policies.accessMode);
        setAudienceAccessRequests(Object.fromEntries(
          snapshot.audienceAccessRequests.map((request) => [request.participantId, {
            requestedAt: request.requestedAt,
            accessState: request.accessState,
          }]),
        ));
        return;
      }

      if (type === 'AUDIENCE_ACCESS_REQUEST' && typeof payload.participantId === 'string') {
        setAudienceAccessRequests(current => ({
          ...current,
          [payload.participantId as string]: {
            requestedAt: typeof payload.requestedAt === 'number' ? payload.requestedAt : Date.now(),
            accessState: 'WAITING',
          },
        }));
        return;
      }
      if (type === 'AUDIENCE_ACCESS_DECISION_RESULT' && typeof payload.participantId === 'string') {
        setAudienceAccessRequests(current => {
          if (payload.decision === 'BLOCK') {
            return {
              ...current,
              [payload.participantId as string]: {
                requestedAt: current[payload.participantId as string]?.requestedAt ?? Date.now(),
                accessState: 'BLOCKED',
              },
            };
          }
          if (payload.decision === 'UNBLOCK') {
            return {
              ...current,
              [payload.participantId as string]: {
                requestedAt: current[payload.participantId as string]?.requestedAt ?? Date.now(),
                accessState: 'WAITING',
              },
            };
          }
          const next = { ...current };
          delete next[payload.participantId as string];
          return next;
        });
        return;
      }

      if (
        type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' &&
        payload.controlSessionId === controlSessionId &&
        payload.controlState === 'PRINCIPAL'
      ) {
        lastSentListRef.current = '';
        return;
      }

      if (type === 'LIVE_AUDIO_PARTICIPANT_STATUS') {
        const msg = payload as unknown as LiveAudioParticipantStatusMessage;
        setParticipantsMap(prev => {
          const existing = prev[msg.participantId];
          if (existing && JSON.stringify(existing) === JSON.stringify(msg)) return prev;
          return { ...prev, [msg.participantId]: msg };
        });
        if (msg.activeListPublicKey) {
          setParticipantEphemeralKeys(prev => ({ ...prev, [msg.participantId]: msg.activeListPublicKey! }));
        }
        if (msg.role === 'audience' && msg.isActiveAudience === false && msg.isKicked !== true) {
          setParticipantAliases(prev => {
            const next = { ...prev };
            delete next[msg.participantId];
            return next;
          });
          setParticipantEphemeralKeys(prev => {
            const next = { ...prev };
            delete next[msg.participantId];
            return next;
          });
        }
        return;
      }

      if (type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE') {
        const participantId = typeof payload.participantId === 'string' ? payload.participantId : '';
        const activeListPublicKey = typeof payload.activeListPublicKey === 'string'
          ? payload.activeListPublicKey
          : '';
        if (!participantId || !activeListPublicKey) return;
        const isAliasVisibleToActiveParticipants = payload.isAliasVisibleToActiveParticipants === true;
        setParticipantEphemeralKeys(prev => ({ ...prev, [participantId]: activeListPublicKey }));
        setParticipantsMap(prev => {
          const existing = prev[participantId];
          if (!existing) return prev;
          return {
            ...prev,
            [participantId]: {
              ...existing,
              isAliasVisibleToActiveParticipants,
              activeListPublicKey,
            },
          };
        });
        return;
      }

      if (type === 'LIVE_AUDIO_KICK_PARTICIPANT') {
        const kickedParticipantId = typeof payload.participantId === 'string' ? payload.participantId : null;
        if (!kickedParticipantId) return;
        setParticipantsMap(prev => {
          const existing = prev[kickedParticipantId];
          if (!existing) return prev;
          return {
            ...prev,
            [kickedParticipantId]: {
              ...existing,
              speakerState: 'REVOKED',
              canPublishAudio: false,
              isMuted: true,
              isActiveAudience: false,
              isMicrophoneActive: false,
              isKicked: true,
              updatedAt: Date.now(),
            },
          };
        });
        return;
      }

      if (type === 'LIVE_AUDIO_CONNECTION_COUNTS') {
        setConnectionCounts(payload as unknown as LiveAudioConnectionCountsMessage);
        return;
      }

      if (type === 'LIVE_AUDIO_CONTROL_JOIN_REQUEST') {
        const msg = payload as unknown as LiveAudioControlJoinRequestMessage;
        if (msg.controlSessionId) {
          setJoinRequests(prev => ({ ...prev, [msg.controlSessionId]: msg }));
        }
        return;
      }
    });
    return unsubscribe;
  }, [controlSessionId, subscribeToWsMessage, wsSend]);

  useEffect(() => {
    if (!isControlAuthorized || !wsSend) return;
    wsSend('LIVE_AUDIO_SNAPSHOT_REQUEST', {
      type: 'LIVE_AUDIO_SNAPSHOT_REQUEST',
      controlSessionId: controlSessionId || undefined,
      createdAt: Date.now(),
    });
  }, [controlSessionId, isControlAuthorized, wsSend]);

  const handlePrivateSignal = useCallback((signal: DecryptedPrivateControlSignal) => {
    const data = getSignalRecord(signal);

    if (data.type === 'ALIASES_SYNC' && data.aliases && typeof data.aliases === 'object') {
      const aliases = data.aliases as Record<string, string>;
      for (const [id, alias] of Object.entries(aliases)) {
        aliasOrdinalStateRef.current = assignStableAliasOrdinal(aliasOrdinalStateRef.current, id, alias);
      }
      setParticipantAliasOrdinals({ ...aliasOrdinalStateRef.current.assignments });
      setParticipantAliases(prev => ({ ...prev, ...aliases }));
      return;
    }

    if ((data.type === 'CONTROL_PROFILE' || data.type === 'CONTROL_MICROPHONE_CONFIG')
      && signal.fromParticipantId !== participantId
      && !controlParticipants.some(control => control.participantId === signal.fromParticipantId)) return;
    if (data.type === 'CONTROL_MICROPHONE_CONFIG') { applyControllerConfig.current(data); return; }
    if (data.type === 'CONTROL_PROFILE') {
      setParticipantAliases(prev => ({ ...prev, [signal.fromParticipantId]: sanitizeAlias(data.alias) || 'Sin nick' }));
      const volume = data.volume;
      if (typeof volume === 'number' && Number.isFinite(volume)) setParticipantMicrophoneConfigs(prev => ({ ...prev, [signal.fromParticipantId]: { volume: clampVolume(volume), musicMode: data.musicMode === true } }));
      return;
    }
    const alias = sanitizeAlias(data.alias);
    if (alias) {
      aliasOrdinalStateRef.current = assignStableAliasOrdinal(aliasOrdinalStateRef.current, signal.fromParticipantId, alias);
      setParticipantAliasOrdinals({ ...aliasOrdinalStateRef.current.assignments });
      setParticipantAliases(prev => {
        if (prev[signal.fromParticipantId] === alias) return prev;
        return { ...prev, [signal.fromParticipantId]: alias };
      });
    }

    if (signal.ephemeralPublicKey) {
      setParticipantEphemeralKeys(prev => {
        if (prev[signal.fromParticipantId] === signal.ephemeralPublicKey) return prev;
        return { ...prev, [signal.fromParticipantId]: signal.ephemeralPublicKey! };
      });
    }

    if (typeof data.isAliasVisibleToActiveParticipants === 'boolean') {
      const visible = data.isAliasVisibleToActiveParticipants as boolean;
      setParticipantsMap(prev => {
        const existing = prev[signal.fromParticipantId];
        if (!existing || existing.isAliasVisibleToActiveParticipants === visible) return prev;
        return {
          ...prev,
          [signal.fromParticipantId]: {
            ...existing,
            isAliasVisibleToActiveParticipants: visible,
          },
        };
      });
      wsSend?.('LIVE_AUDIO_SNAPSHOT_PATCH', {
        type: 'LIVE_AUDIO_SNAPSHOT_PATCH',
        snapshot: {
          participants: [{
            participantId: signal.fromParticipantId,
            role: 'audience',
            isAliasVisibleToActiveParticipants: visible,
          }],
        },
        createdAt: Date.now(),
      });
    }

    if (data.type === 'MESSAGE_REPLY_SYNC') {
      const messageId = typeof data.messageId === 'string' ? data.messageId : '';
      const targetParticipantId = typeof data.targetParticipantId === 'string' ? data.targetParticipantId : '';
      const responseText = typeof data.responseText === 'string' ? data.responseText : '';
      const repliedBy = typeof data.repliedBy === 'string' ? data.repliedBy : 'Control';
      const repliedAt = typeof data.repliedAt === 'number' ? data.repliedAt : Date.now();
      if (responseText) {
        setMessages(prev => prev.map(m => {
          if (m.id === messageId || (targetParticipantId && m.fromParticipantId === targetParticipantId)) {
            const existingReplies = m.replies || [];
            return {
              ...m,
              replies: [...existingReplies, { responseText, repliedBy, repliedAt }],
            };
          }
          return m;
        }));
      }
      return;
    }



    if (data.type === 'CONTROL_ANNOUNCEMENT') {
      const content = typeof data.text === 'string'
        ? data.text.trim()
        : typeof data.content === 'string'
          ? data.content.trim()
          : '';
      if (content) {
        const fromAlias = typeof data.senderNick === 'string' && data.senderNick ? data.senderNick : 'Control';
        setMessages(prev => [...prev, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fromAlias,
          content,
          timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
          isInterControl: true,
        }]);
      }
      return;
    }

    const signalType = typeof data.type === 'string' ? data.type : '';
    const content = typeof data.text === 'string'
      ? data.text.trim()
      : typeof data.content === 'string'
        ? data.content.trim()
        : '';

    if ((signalType === 'PRIVATE_MESSAGE' || signalType === 'message' || signalType === 'ACCESS_REQUEST') && content) {
      const fromAlias = alias || participantAliasesRef.current[signal.fromParticipantId] || 'Sin nick';
      const isWaitingRoom = Boolean(audienceAccessRequests[signal.fromParticipantId]);
      setMessages(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fromAlias,
        content,
        timestamp: Date.now(),
        fromParticipantId: signal.fromParticipantId,
        ephemeralPublicKey: signal.ephemeralPublicKey,
        isWaitingRoom,
      }]);
    }
  }, [audienceAccessRequests, wsSend, controlParticipants, participantId]);

  const {
    sendPrivateSignalToParticipant,
    sendPrivateSignalToControls,
    requestAliases,
    ready: privateSignalsReady,
    requestControlAuthorization,
    authorizeSecondaryControl
  } = usePrivateControlSignals({
    role: 'control',
    participantId: participantId || controlSessionId || 'control',
    controlSessionId: controlSessionId || undefined,
    controlState,
    sendMessage: wsSend || (() => false),
    subscribeToWsMessage: subscribeToWsMessage || (() => () => { }),
    transportReady: wsStatus === 'open',
    onPrivateSignal: handlePrivateSignal,
  });

  const controlRosterKey = controlParticipants.map(control => control.participantId).join(',');
  // Control nicknames travel only through the existing encrypted control channel.
  useEffect(() => {
    if (!privateSignalsReady || !participantId) return;
    const publish = () => void sendPrivateSignalToControls({ type: 'CONTROL_PROFILE', alias: operatorNick.trim().slice(0, 80), volume: microphoneVolume, musicMode: isModeratorMusicMode }).catch(() => undefined);
    publish();
    const timer = setInterval(publish, 15_000);
    return () => clearInterval(timer);
  }, [operatorNick, participantId, privateSignalsReady, sendPrivateSignalToControls, microphoneVolume, isModeratorMusicMode, controlRosterKey]);

  useEffect(() => {
    if (controlState === 'PENDING' && verificationCode && requestedAuthRef.current !== verificationCode) {
      requestedAuthRef.current = verificationCode;
      void requestControlAuthorization(verificationCode).catch((err) => {
        console.warn('LiveAudioControl: Failed to request control authorization crypto:', err);
      });
    }
  }, [controlState, verificationCode, requestControlAuthorization]);

  const handleApproveRequest = useCallback((sessionId: string) => {
    const joinReq = joinRequests[sessionId];
    if (joinReq) {
      void authorizeSecondaryControl(joinReq, participantAliasesRef.current)
        .catch(err => console.error('Failed to authorize secondary control crypto', err))
        .finally(() => onApproveRequest(sessionId));
    } else {
      onApproveRequest(sessionId);
    }
    setJoinRequests(prev => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, [authorizeSecondaryControl, joinRequests, onApproveRequest, participantAliasesRef]);

  const handleReplyToParticipant = useCallback((messageId: string, targetParticipantId: string, text: string) => {
    if (!targetParticipantId || !text.trim()) return;
    const targetPublicKey = participantEphemeralKeys[targetParticipantId];
    if (!targetPublicKey) {
      console.warn('LiveAudioControl: Cannot reply - participant public key not available for', targetParticipantId);
      return;
    }

    const storedNick = localStorage.getItem('sefer_control_operator_nick') || '';
    const isNickPublic = localStorage.getItem('sefer_control_nick_public') === 'true';
    const effectiveNick = isNickPublic && storedNick.trim() ? `Control (${storedNick.trim()})` : 'Control';
    const internalNick = storedNick.trim() ? `Control (${storedNick.trim()})` : 'Control';
    const now = Date.now();

    void sendPrivateSignalToParticipant(targetParticipantId, targetPublicKey, {
      type: 'CHAT_RESPONSE',
      text: text.trim(),
      senderNick: effectiveNick,
      timestamp: now,
    });

    const syncPayload = {
      type: 'MESSAGE_REPLY_SYNC',
      messageId,
      targetParticipantId,
      responseText: text.trim(),
      repliedBy: internalNick,
      repliedAt: now,
    };
    wsSend?.('PRIVATE_CONTROL_SIGNAL', syncPayload);

    setMessages(prev => prev.map(m => {
      if (m.id === messageId || (messageId.startsWith('access-') && m.fromParticipantId === targetParticipantId)) {
        const existingReplies = m.replies || [];
        return {
          ...m,
          replies: [...existingReplies, { responseText: text.trim(), repliedBy: internalNick, repliedAt: now }],
        };
      }
      return m;
    }));
  }, [participantEphemeralKeys, sendPrivateSignalToParticipant, wsSend]);

  const handleSendInterControlMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    const storedNick = localStorage.getItem('sefer_control_operator_nick') || '';
    const internalNick = storedNick.trim() ? `Control (${storedNick.trim()})` : 'Control';
    const now = Date.now();

    const announcement = {
      type: 'CONTROL_ANNOUNCEMENT',
      text: text.trim(),
      senderNick: internalNick,
      timestamp: now,
    };
    sendPrivateSignalToControls(announcement);
  }, [sendPrivateSignalToControls]);

  const handleDismissMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleAudienceAccessDecision = useCallback((
    targetParticipantId: string,
    decision: 'ADMIT' | 'REJECT' | 'BLOCK' | 'UNBLOCK',
  ) => {
    wsSend?.('AUDIENCE_ACCESS_DECISION', {
      participantId: targetParticipantId,
      decision,
      createdAt: Date.now(),
    });
  }, [wsSend]);

  const handleAccessModeChange = useCallback(() => {
    if (controlState !== 'PRINCIPAL') return;
    wsSend?.('SESSION_ACCESS_POLICY_UPDATE', {
      accessMode: accessMode === 'PUBLIC' ? 'CONTROLLED' : 'PUBLIC',
      createdAt: Date.now(),
    });
  }, [accessMode, controlState, wsSend]);

  const computeVisibleList = useCallback((): string[] => (
    computeVisibleActiveParticipants(participantsMap, participantAliases)
  ), [participantAliases, participantsMap]);

  const distributeVisibleList = useCallback(async () => {
    if (!privateSignalsReady) return;

    const list = computeVisibleList();
    const viewers = Object.values(participantsMap).filter((participant) => (
      participant.role === 'audience' &&
      participant.isActiveAudience === true &&
      participant.canViewActiveParticipants === true &&
      participant.isKicked !== true
    ));
    const viewerSignature = viewers
      .map((viewer) => `${viewer.participantId}:${participantEphemeralKeys[viewer.participantId] ?? ''}`)
      .sort()
      .join('|');
    const serialized = `${serializeVisibleParticipants(list)}\u001f${viewerSignature}`;
    if (!hasVisibleParticipantsChanged([serialized], lastSentListRef.current)) return;
    lastSentListRef.current = serialized;

    const payload = {
      type: 'VISIBLE_ACTIVE_PARTICIPANTS',
      participants: list,
      updatedAt: Date.now(),
    };

    for (const viewer of viewers) {
      const publicKey = participantEphemeralKeys[viewer.participantId];
      if (publicKey) {
        await sendPrivateSignalToParticipant(viewer.participantId, publicKey, payload);
      }
    }
  }, [
    computeVisibleList,
    participantEphemeralKeys,
    participantsMap,
    privateSignalsReady,
    sendPrivateSignalToParticipant,
  ]);

  useEffect(() => {
    void distributeVisibleList();
  }, [distributeVisibleList]);

  useEffect(() => {
    if (!privateSignalsReady) return;

    const unresolvedAudienceIds = getAudienceParticipantsNeedingAliasRequest(
      participantsMap,
      participantAliases,
      Object.keys(audienceAccessRequests),
    );
    if (unresolvedAudienceIds.length === 0) return;

    void requestAliases(unresolvedAudienceIds);
    const timer = window.setInterval(() => void requestAliases(unresolvedAudienceIds), 20_000);
    return () => window.clearInterval(timer);
  }, [audienceAccessRequests, participantAliases, participantsMap, privateSignalsReady, requestAliases]);

  const participants: LiveAudioParticipant[] = useMemo(() => (
    Object.values(participantsMap)
      .filter(p => p.role === 'audience' && p.connected !== false)
      .map(p => {
        const alias = participantAliases[p.participantId] || '';
        const isKicked = p.isKicked === true;
        const isActiveAudience = !isKicked && p.isActiveAudience === true;
        const isMicrophoneActive = p.isMicrophoneActive ?? (p.speakerState === 'GRANTED' && p.isMuted === false);
        return {
          participantId: p.participantId,
          alias: alias ? formatAliasForControl(alias, participantAliasOrdinals[p.participantId]) : 'Sin nick',
          speakerState: p.speakerState,
          isMuted: p.isMuted ?? !isMicrophoneActive,
          isMicrophoneActive,
          microphoneTrackState: p.microphoneTrackState,
          isActiveAudience,
          isKicked,
          isAliasVisibleToActiveParticipants: p.isAliasVisibleToActiveParticipants,
          isAliasHiddenByControl: p.isAliasHiddenByControl,
          canViewActiveParticipants: p.canViewActiveParticipants,
          microphoneVolume: participantMicrophoneConfigs[p.participantId]?.volume ?? 100,
          isMusicMode: participantMicrophoneConfigs[p.participantId]?.musicMode ?? false,
        };
      })
  ), [participantAliasOrdinals, participantAliases, participantMicrophoneConfigs, participantsMap]);

  const activeUsers = participants.filter(p => p.isActiveAudience && !p.isKicked).length;
  const pendingWordCount = participants.filter(p => p.speakerState === 'REQUESTED' && !p.isKicked).length;
  const totalAudience = connectionCounts?.totalConnections ?? participants.length;

  const handleStartListening = useCallback(() => {
    void startRemoteAudio().catch((err) => {
      console.warn('LiveAudioControl: Failed to start remote audio:', err);
    });
  }, [startRemoteAudio]);

  const handleToggleModeratorMic = useCallback(async () => {
    if (isModeratorMuted) {
      if (
        externalBroadcastState !== 'off' &&
        moderatorConsentRevisionRef.current !== externalBroadcastRevision
      ) {
        const accepted = window.confirm(
          externalBroadcastState === 'recording'
            ? 'La sesión está declarada en directo y grabándose. Confirma que tu voz puede emitirse y quedar grabada. Evita identificarte y comprueba que no haya voces de fondo; pueden generarse subtítulos automáticos.'
            : 'La sesión está declarada en directo. Confirma que tu voz puede emitirse públicamente. Evita identificarte y comprueba que no haya voces de fondo.',
        );
        if (!accepted) return;
        moderatorConsentRevisionRef.current = externalBroadcastRevision;
      }
      await publishMicrophone({ musicMode: isModeratorMusicMode });
    } else {
      await unpublishMicrophone();
    }
  }, [externalBroadcastRevision, externalBroadcastState, isModeratorMuted, isModeratorMusicMode, publishMicrophone, unpublishMicrophone]);

  const handleExternalBroadcastStateChange = useCallback((nextState: LiveAudioExternalBroadcastState) => {
    wsSend?.('LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE', {
      type: 'LIVE_AUDIO_SET_EXTERNAL_BROADCAST_STATE',
      state: nextState,
      createdAt: Date.now(),
    });
  }, [wsSend]);

  const handleModeratorMusicModeChange = useCallback((nextMusicMode: boolean) => {
    setIsModeratorMusicMode(nextMusicMode);
    if (!isMicrophoneActive || nextMusicMode === isModeratorMusicMode) return;

    void unpublishMicrophone()
      .then(() => publishMicrophone({ musicMode: nextMusicMode }))
      .catch((err) => {
        console.error('Failed to republish moderator microphone with music mode:', err);
      });
  }, [isMicrophoneActive, isModeratorMusicMode, publishMicrophone, unpublishMicrophone]);

  applyControllerConfig.current = (data) => {
    if (data.targetParticipantId !== participantId) return;
    if (typeof data.volume === 'number' && Number.isFinite(data.volume)) setMicrophoneVolume(clampVolume(data.volume));
    if (typeof data.musicMode === 'boolean') handleModeratorMusicModeChange(data.musicMode);
  };

  const sendModerationMessage = useCallback((endpoint: ModerationEndpoint, pid?: string) => {
    if (!wsSend) return false;

    const base = {
      issuedByParticipantId: participantId || undefined,
      createdAt: Date.now(),
    };

    switch (endpoint) {
      case 'grant-speak':
        if (!pid) return false;
        return wsSend('LIVE_AUDIO_GRANT_SPEAK', {
          type: 'LIVE_AUDIO_GRANT_SPEAK',
          participantId: pid,
          ...base,
        });
      case 'revoke-speak':
        if (!pid) return false;
        return wsSend('LIVE_AUDIO_REVOKE_SPEAK', {
          type: 'LIVE_AUDIO_REVOKE_SPEAK',
          participantId: pid,
          ...base,
        });
      case 'mute-participant':
        if (!pid) return false;
        return wsSend('LIVE_AUDIO_MUTE_PARTICIPANT', {
          type: 'LIVE_AUDIO_MUTE_PARTICIPANT',
          participantId: pid,
          ...base,
        });
      case 'mute-all':
        return wsSend('LIVE_AUDIO_MUTE_ALL', {
          type: 'LIVE_AUDIO_MUTE_ALL',
          ...base,
        });
      case 'kick-participant':
        if (!pid) return false;
        return wsSend('LIVE_AUDIO_KICK_PARTICIPANT', {
          type: 'LIVE_AUDIO_KICK_PARTICIPANT',
          participantId: pid,
          ...base,
        });
      case 'rescue-participant':
        if (!pid) return false;
        return wsSend('LIVE_AUDIO_RESCUE_PARTICIPANT', {
          type: 'LIVE_AUDIO_RESCUE_PARTICIPANT',
          participantId: pid,
          ...base,
        });
      default:
        return false;
    }
  }, [participantId, wsSend]);

  const doModerationAction = useCallback(async (endpoint: ModerationEndpoint, pid?: string) => {
    if (!controlSessionId) return;
    setModerationError(null);
    try {
      const response = await fetch(`/api/livekit/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'control',
          controlSessionId,
          participantId: pid,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`);
      }
      sendModerationMessage(endpoint, pid);
    } catch (err) {
      console.error(`Error in moderation action ${endpoint}`, err);
      setModerationError(err instanceof Error ? err.message : 'No se pudo aplicar la acción de moderación');
    }
  }, [controlSessionId, sendModerationMessage]);

  const handleMuteAll = useCallback(() => {
    const openSpeakers = participants.filter(p => p.speakerState === 'GRANTED' && p.isMicrophoneActive && !p.isMuted);
    if (openSpeakers.length > 0) {
      openSpeakers.forEach(p => void doModerationAction('mute-participant', p.participantId));
      return;
    }

    participants
      .filter(p => p.speakerState === 'GRANTED' && !p.isKicked)
      .forEach(p => void doModerationAction('revoke-speak', p.participantId));
  }, [doModerationAction, participants]);

  const handleGrantAll = useCallback(() => {
    const queued = participants.filter(p => p.speakerState === 'REQUESTED' && !p.isKicked);
    const targets = queued.length > 0
      ? queued
      : participants.filter(p => p.speakerState === 'LISTENER' && p.isActiveAudience && !p.isKicked);

    targets.forEach(p => void doModerationAction('grant-speak', p.participantId));
  }, [doModerationAction, participants]);

  const handleParticipantMicrophoneConfigChange = useCallback((id: string, config: { volume?: number; musicMode?: boolean }) => {
    setParticipantMicrophoneConfigs(prev => {
      const current = prev[id] || { volume: 100, musicMode: false };
      const next = { ...current };
      if (config.volume !== undefined) next.volume = clampVolume(config.volume);
      if (config.musicMode !== undefined) next.musicMode = config.musicMode;

      const targetPublicKey = participantEphemeralKeys[id];
      if (targetPublicKey) {
        void sendPrivateSignalToParticipant(id, targetPublicKey, {
          type: 'SET_MICROPHONE_CONFIG',
          ...config
        });
      }

      return { ...prev, [id]: next };
    });
  }, [participantEphemeralKeys, sendPrivateSignalToParticipant]);

  const handleSetAliasSharedVisibility = useCallback((id: string, hidden: boolean) => {
    wsSend?.('LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY', {
      type: 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY',
      participantId: id,
      isAliasHiddenByControl: hidden,
      createdAt: Date.now(),
    });
    setParticipantsMap(prev => {
      const existing = prev[id];
      if (!existing) return prev;
      return { ...prev, [id]: { ...existing, isAliasHiddenByControl: hidden } };
    });
  }, [wsSend]);

  const handleSetActiveListViewPermission = useCallback((id: string, canView: boolean) => {
    wsSend?.('LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION', {
      type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION',
      participantId: id,
      canViewActiveParticipants: canView,
      createdAt: Date.now(),
    });
    setParticipantsMap(prev => {
      const existing = prev[id];
      if (!existing) return prev;
      return { ...prev, [id]: { ...existing, canViewActiveParticipants: canView } };
    });

    const publicKey = participantEphemeralKeys[id];
    if (!publicKey) return;

    const list = canView ? computeVisibleList() : [];
    void sendPrivateSignalToParticipant(id, publicKey, {
      type: 'VISIBLE_ACTIVE_PARTICIPANTS',
      participants: list,
      updatedAt: Date.now(),
    });
  }, [computeVisibleList, participantEphemeralKeys, sendPrivateSignalToParticipant, wsSend]);

  const handleRemove = useCallback((id: string) => {
    wsSend?.('LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT', {
      type: 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT',
      participantId: id,
      createdAt: Date.now(),
    });
    setParticipantsMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setParticipantAliases(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [wsSend]);

  const voiceTracks = [
    ...(localMicrophoneTrack && !isModeratorMuted ? [{ id: 'local-mic', track: localMicrophoneTrack, label: operatorNick || 'Mi micrófono' }] : []),
    ...remoteTracks.filter(remote => {
      const participant = participantsMap[remote.participantId || ''];
      const control = controlParticipants.find(p => p.participantId === remote.participantId);
      return control ? control.isMicrophoneActive : participant?.role === 'audience' && participant.isMuted !== true && participant.connected !== false;
    }).map(remote => ({ id: remote.participantId || remote.id, track: remote.track, label: participantAliases[remote.participantId || ''] || 'Sin nick' })),
  ];
  const voiceParticipantId = selectedVoiceId === 'local-mic' ? participantId : selectedVoiceId;
  const selectVoice = (id: string) => {
    const trackId = id === participantId ? 'local-mic' : id;
    if (trackId && trackId === selectedVoiceId) { setSelectedVoiceId(''); return; }
    if (!trackId || !voiceReady || !voiceTracks.some(track => track.id === trackId)) return;
    setSelectedVoiceId(trackId);
  };
  const controllers: LiveAudioParticipant[] = controlParticipants
    .map(p => ({ participantId: p.participantId, alias: participantAliases[p.participantId] || 'Sin nick',
      speakerState: 'GRANTED', isMuted: !p.isMicrophoneActive, isMicrophoneActive: p.isMicrophoneActive,
      isActiveAudience: false, isKicked: false,
      microphoneVolume: participantMicrophoneConfigs[p.participantId]?.volume,
      isMusicMode: participantMicrophoneConfigs[p.participantId]?.musicMode }));
  if (participantId) controllers.unshift({ participantId, alias: operatorNick.trim() || 'Sin nick', speakerState: 'GRANTED',
    isMuted: isModeratorMuted, isMicrophoneActive, isActiveAudience: false, isKicked: false,
    microphoneVolume, isMusicMode: isModeratorMusicMode });
  const voiceRuntime = VoiceScriptureControl && isControlAuthorized && availability === 'enabled' ? <Suspense fallback={null}>
    <VoiceScriptureControl tracks={voiceTracks} selectedId={selectedVoiceId} onSelectionChange={setSelectedVoiceId}
      onAvailabilityChange={setVoiceReady} suggestionsTarget={voiceSuggestionsTarget}
      scriptureState={scriptureState} onProject={onProjectScripture} />
  </Suspense> : null;

  const portalTarget = document.getElementById('live-audio-inbox-portal-target');
  const accessRequestItems = Object.entries(audienceAccessRequests).map(([id, request]) => ({
    participantId: id,
    alias: participantAliases[id]
      ? formatAliasForControl(participantAliases[id], participantAliasOrdinals[id])
      : 'Sincronizando alias…',
    ...request,
  }));
  const pendingAccessCount = Object.values(audienceAccessRequests).filter((r) => r.accessState === 'WAITING').length;
  const unreadCount = messages.length + authorizationRequests.length + pendingAccessCount;
  const hasUnread = unreadCount > 0;
  const inboxPortal = portalTarget ? createPortal(
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleAccessModeChange}
        disabled={controlState !== 'PRINCIPAL'}
        className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        title="Solo el Control principal puede cambiar el modo de acceso"
      >
        Acceso: {accessMode === 'PUBLIC' ? 'Público' : 'Controlado'}
      </button>
      <PwaRestartButton controlMenu={true} connectionState={state} connectionQuality={connectionQuality} />
      <div className="relative">
        <button
          onClick={() => setIsInboxOpen(!isInboxOpen)}
          className={`flex items-center justify-center p-2 text-xs font-semibold rounded border transition-all cursor-pointer ${
            hasUnread ? 'bg-red-600 border-red-500 text-white animate-pulse'
              : isInboxOpen ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
          }`}
          title="Bandeja Privada"
          aria-label={`Bandeja Privada: ${unreadCount} solicitudes pendientes`}
        >
          <Bell size={14} />
          {hasUnread && (
            <span className="absolute -top-1 -right-1 bg-white text-red-600 text-[10px] font-bold px-1 rounded-full">
              {unreadCount}
            </span>
          )}
        </button>
      </div>
      <PrivateControlInbox
        isOpen={isInboxOpen}
        isControlAuthorized={isControlAuthorized}
        messages={messages}
        authorizationRequests={authorizationRequests}
        audienceAccessRequests={accessRequestItems}
        onApproveRequest={handleApproveRequest}
        onRejectRequest={onRejectRequest}
        onDismissMessage={handleDismissMessage}
        onAudienceAccessDecision={handleAudienceAccessDecision}
        onReplyToParticipant={handleReplyToParticipant}
        onSendInterControlMessage={handleSendInterControlMessage}
        onOperatorNickChange={setOperatorNick}
      />
    </div>,
    portalTarget,
  ) : null;

  if (availability !== 'enabled') return inboxPortal;

  return (
    <>
      {remoteTracks.map((remoteTrack) => (
        <LiveAudioTrackOutput
          key={remoteTrack.id}
          remoteTrack={remoteTrack}
          volumePercent={listenVolume}
        />
      ))}

      {inboxPortal}
      {voiceRuntime}

      <LiveAudioControlPanel
        controllers={controllers}
        selectedVoiceParticipantId={voiceParticipantId || ''}
        voiceSelectableIds={voiceReady ? voiceTracks.map(track => track.id === 'local-mic' ? participantId || '' : track.id) : []}
        onSelectVoice={selectVoice}
        ownVoiceSelected={selectedVoiceId === 'local-mic'}
        onControllerMicrophoneConfigChange={(id, config) => {
          if (id !== participantId) {
            void sendPrivateSignalToControls({ type: 'CONTROL_MICROPHONE_CONFIG', targetParticipantId: id, ...config }).catch(() => undefined);
            return;
          }
          if (config.volume !== undefined) setMicrophoneVolume(clampVolume(config.volume));
          if (config.musicMode !== undefined) void handleModeratorMusicModeChange(config.musicMode);
        }}
        totalAudience={totalAudience}
        activeUsers={activeUsers}
        isModeratorMuted={isModeratorMuted}
        onStartListening={handleStartListening}
        onToggleModeratorMic={handleToggleModeratorMic}
        listenVolume={listenVolume}
        onListenVolumeChange={(volume) => setListenVolume(clampListenVolume(volume))}
        microphoneVolume={microphoneVolume}
        onMicrophoneVolumeChange={(volume) => setMicrophoneVolume(clampVolume(volume))}
        isModeratorMusicMode={isModeratorMusicMode}
        onModeratorMusicModeChange={handleModeratorMusicModeChange}
        participants={participants}
        isControlAuthorized={isControlAuthorized}
        onMuteAll={handleMuteAll}
        onGrantAllQueue={handleGrantAll}
        onGrant={(id) => void doModerationAction('grant-speak', id)}
        onRevoke={(id) => void doModerationAction('revoke-speak', id)}
        onMute={(id) => void doModerationAction('mute-participant', id)}
        onKick={(id) => void doModerationAction('kick-participant', id)}
        onRescue={(id) => void doModerationAction('rescue-participant', id)}
        onBlock={(id) => handleAudienceAccessDecision(id, 'BLOCK')}
        onSetAliasSharedVisibility={handleSetAliasSharedVisibility}
        onSetActiveListViewPermission={handleSetActiveListViewPermission}
        onRemove={handleRemove}
        onMicrophoneConfigChange={handleParticipantMicrophoneConfigChange}
        pendingWordCount={pendingWordCount}
        externalBroadcastState={externalBroadcastState}
        onExternalBroadcastStateChange={handleExternalBroadcastStateChange}
        moderationError={moderationError}
      />
    </>
  );
}
