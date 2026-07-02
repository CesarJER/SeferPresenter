import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bell } from 'lucide-react';
import { LiveAudioControlPanel } from './LiveAudioControlPanel';
import { PrivateControlInbox, type PrivateMessage } from './PrivateControlInbox';
import type { LiveAudioParticipant } from './LiveAudioParticipantRow';
import { PwaRestartButton } from '../../../../components/shared/PwaRestartButton';
import type {
  LiveAudioConnectionCountsMessage,
  LiveAudioOperationalSnapshot,
  LiveAudioParticipantStatusMessage,
  PendingControlAuthorization,
} from '../../../../types/liveAudio';
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

type ModerationEndpoint =
  | 'grant-speak'
  | 'revoke-speak'
  | 'mute-participant'
  | 'mute-all'
  | 'kick-participant'
  | 'rescue-participant';

export interface LiveAudioControlContainerProps {
  isControlAuthorized: boolean;
  authorizationRequests?: PendingControlAuthorization[];
  onApproveRequest?: (sessionId: string) => void;
  onRejectRequest?: (sessionId: string) => void;
  wsSend?: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage?: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
  controlSessionId?: string | null;
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
  isControlAuthorized,
  authorizationRequests = [],
  onApproveRequest = () => { },
  onRejectRequest = () => { },
  wsSend,
  subscribeToWsMessage,
  controlSessionId,
}: LiveAudioControlContainerProps) {
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isModeratorMuted, setIsModeratorMuted] = useState(true);
  const [listenVolume, setListenVolume] = useState(100);
  const [microphoneVolume, setMicrophoneVolume] = useState(100);
  const [isModeratorMusicMode, setIsModeratorMusicMode] = useState(false);
  const [participantsMap, setParticipantsMap] = useState<Record<string, LiveAudioParticipantStatusMessage>>({});
  const [participantAliases, setParticipantAliases] = useState<Record<string, string>>({});
  const [participantEphemeralKeys, setParticipantEphemeralKeys] = useState<Record<string, string>>({});
  const [participantMicrophoneConfigs, setParticipantMicrophoneConfigs] = useState<Record<string, { volume: number; musicMode: boolean }>>({});
  const [connectionCounts, setConnectionCounts] = useState<LiveAudioConnectionCountsMessage | null>(null);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const participantAliasesRef = useRef(participantAliases);
  const aliasRequestSignatureRef = useRef('');
  const lastSentListRef = useRef('');

  const { availability } = useLiveAudioAvailability();

  const {
    state,
    connectionQuality,
    publishMicrophone,
    unpublishMicrophone,
    isMicrophoneActive,
    participantId,
    remoteTracks,
    startRemoteAudio,
  } = useLiveAudio({
    role: 'control',
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
    if (!subscribeToWsMessage) return;
    const unsubscribe = subscribeToWsMessage((type, payload) => {
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
        setParticipantAliases(prev => {
          const next = { ...prev };
          snapshot.participants.forEach((participant) => {
            if (participant.role === 'audience' && participant.alias) {
              next[participant.participantId] = participant.alias;
            } else if (
              participant.role === 'audience' &&
              participant.isActiveAudience === false &&
              participant.isKicked !== true
            ) {
              delete next[participant.participantId];
            }
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
        setParticipantsMap(prev => ({ ...prev, [msg.participantId]: msg }));
        if (msg.activeListPublicKey) {
          setParticipantEphemeralKeys(prev => ({ ...prev, [msg.participantId]: msg.activeListPublicKey! }));
        }
        if (msg.isActiveAudience === false && msg.isKicked !== true) {
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
        const alias = sanitizeAlias(payload.alias);
        const activeListPublicKey = typeof payload.activeListPublicKey === 'string'
          ? payload.activeListPublicKey
          : '';
        if (!participantId || !alias || !activeListPublicKey) return;
        const isAliasVisibleToActiveParticipants = payload.isAliasVisibleToActiveParticipants === true;
        setParticipantAliases(prev => ({ ...prev, [participantId]: alias }));
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
        wsSend?.('LIVE_AUDIO_SNAPSHOT_PATCH', {
          type: 'LIVE_AUDIO_SNAPSHOT_PATCH',
          snapshot: {
            participants: [{
              participantId,
              role: 'audience',
              alias,
              isAliasVisibleToActiveParticipants,
            }],
          },
          createdAt: Date.now(),
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
    const alias = sanitizeAlias(data.alias);
    if (alias) {
      setParticipantAliases(prev => ({ ...prev, [signal.fromParticipantId]: alias }));
      wsSend?.('LIVE_AUDIO_SNAPSHOT_PATCH', {
        type: 'LIVE_AUDIO_SNAPSHOT_PATCH',
        snapshot: {
          participants: [{
            participantId: signal.fromParticipantId,
            role: 'audience',
            alias,
          }],
        },
        createdAt: Date.now(),
      });
    }

    if (signal.ephemeralPublicKey) {
      setParticipantEphemeralKeys(prev => ({ ...prev, [signal.fromParticipantId]: signal.ephemeralPublicKey! }));
    }

    if (typeof data.isAliasVisibleToActiveParticipants === 'boolean') {
      setParticipantsMap(prev => {
        const existing = prev[signal.fromParticipantId];
        if (!existing) return prev;
        return {
          ...prev,
          [signal.fromParticipantId]: {
            ...existing,
            isAliasVisibleToActiveParticipants: data.isAliasVisibleToActiveParticipants as boolean,
          },
        };
      });
      wsSend?.('LIVE_AUDIO_SNAPSHOT_PATCH', {
        type: 'LIVE_AUDIO_SNAPSHOT_PATCH',
        snapshot: {
          participants: [{
            participantId: signal.fromParticipantId,
            role: 'audience',
            isAliasVisibleToActiveParticipants: data.isAliasVisibleToActiveParticipants,
          }],
        },
        createdAt: Date.now(),
      });
    }

    const signalType = typeof data.type === 'string' ? data.type : '';
    const content = typeof data.text === 'string'
      ? data.text.trim()
      : typeof data.content === 'string'
        ? data.content.trim()
        : '';

    if ((signalType === 'PRIVATE_MESSAGE' || signalType === 'message') && content) {
      const fromAlias = alias || participantAliasesRef.current[signal.fromParticipantId] || 'Sin nick';
      setMessages(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fromAlias,
        content,
        timestamp: Date.now(),
      }]);
    }
  }, [wsSend]);

  const { sendPrivateSignalToParticipant, requestAliases, ready: privateSignalsReady } = usePrivateControlSignals({
    role: 'control',
    participantId: participantId || controlSessionId || 'control',
    controlSessionId: controlSessionId || undefined,
    sendMessage: wsSend || (() => false),
    subscribeToWsMessage: subscribeToWsMessage || (() => () => { }),
    transportReady: Boolean(isControlAuthorized && wsSend && subscribeToWsMessage),
    onPrivateSignal: handlePrivateSignal,
  });

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

    const unresolvedAudienceIds = getAudienceParticipantsNeedingAliasRequest(participantsMap, participantAliases);

    const signature = unresolvedAudienceIds.join('|');
    if (signature === aliasRequestSignatureRef.current) return;
    aliasRequestSignatureRef.current = signature;

    if (unresolvedAudienceIds.length > 0) {
      void requestAliases();
    }
  }, [participantAliases, participantsMap, privateSignalsReady, requestAliases]);

  const participants: LiveAudioParticipant[] = useMemo(() => (
    Object.values(participantsMap)
      .filter(p => p.role === 'audience' && p.connected !== false)
      .map(p => {
        const alias = participantAliases[p.participantId] || '';
        const isKicked = p.isKicked === true;
        const isActiveAudience = !isKicked && (
          p.isActiveAudience === true ||
          (Boolean(alias) && p.speakerState !== 'REVOKED')
        );
        const isMicrophoneActive = p.isMicrophoneActive ?? (p.speakerState === 'GRANTED' && p.isMuted === false);
        return {
          participantId: p.participantId,
          alias: alias || 'Sin nick',
          speakerState: p.speakerState,
          isMuted: p.isMuted ?? !isMicrophoneActive,
          isMicrophoneActive,
          isActiveAudience,
          isKicked,
          isAliasVisibleToActiveParticipants: p.isAliasVisibleToActiveParticipants,
          isAliasHiddenByControl: p.isAliasHiddenByControl,
          canViewActiveParticipants: p.canViewActiveParticipants,
          microphoneVolume: participantMicrophoneConfigs[p.participantId]?.volume ?? 100,
          isMusicMode: participantMicrophoneConfigs[p.participantId]?.musicMode ?? false,
        };
      })
  ), [participantAliases, participantMicrophoneConfigs, participantsMap]);

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
      await publishMicrophone({ musicMode: isModeratorMusicMode });
    } else {
      await unpublishMicrophone();
    }
  }, [isModeratorMuted, isModeratorMusicMode, publishMicrophone, unpublishMicrophone]);

  const handleModeratorMusicModeChange = useCallback((nextMusicMode: boolean) => {
    setIsModeratorMusicMode(nextMusicMode);
    if (!isMicrophoneActive || nextMusicMode === isModeratorMusicMode) return;

    void unpublishMicrophone()
      .then(() => publishMicrophone({ musicMode: nextMusicMode }))
      .catch((err) => {
        console.error('Failed to republish moderator microphone with music mode:', err);
      });
  }, [isMicrophoneActive, isModeratorMusicMode, publishMicrophone, unpublishMicrophone]);

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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      sendModerationMessage(endpoint, pid);
    } catch (err) {
      console.error(`Error in moderation action ${endpoint}`, err);
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

  if (availability !== 'enabled') {
    return null;
  }

  const portalTarget = document.getElementById('live-audio-inbox-portal-target');
  const hasUnread = messages.length > 0 || authorizationRequests.length > 0;

  return (
    <>
      {remoteTracks.map((remoteTrack) => (
        <LiveAudioTrackOutput
          key={remoteTrack.id}
          remoteTrack={remoteTrack}
          volumePercent={listenVolume}
        />
      ))}

      {portalTarget && createPortal(
        <div className="flex items-center gap-2">
          <PwaRestartButton controlMenu={true} connectionState={state} connectionQuality={connectionQuality} />

          <div className="relative">
            <button
              onClick={() => setIsInboxOpen(!isInboxOpen)}
              className={`flex items-center justify-center p-2 text-xs font-semibold rounded border transition-all cursor-pointer ${hasUnread
                ? 'bg-red-600 border-red-500 text-white animate-pulse'
                : isInboxOpen
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
                }`}
              title="Bandeja Privada"
            >
              <Bell size={14} />
              {hasUnread && (
                <span className="absolute -top-1 -right-1 bg-white text-red-600 text-[10px] font-bold px-1 rounded-full">
                  {messages.length + authorizationRequests.length}
                </span>
              )}
            </button>
          </div>

          <PrivateControlInbox
            isOpen={isInboxOpen}
            isControlAuthorized={isControlAuthorized}
            messages={messages}
            authorizationRequests={authorizationRequests}
            onApproveRequest={onApproveRequest}
            onRejectRequest={onRejectRequest}
            onDismissMessage={(id) => setMessages(prev => prev.filter(m => m.id !== id))}
          />
        </div>,
        portalTarget
      )}

      <LiveAudioControlPanel
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
        onSetAliasSharedVisibility={handleSetAliasSharedVisibility}
        onSetActiveListViewPermission={handleSetActiveListViewPermission}
        onRemove={handleRemove}
        onMicrophoneConfigChange={handleParticipantMicrophoneConfigChange}
        pendingWordCount={pendingWordCount}
      />
    </>
  );
}
