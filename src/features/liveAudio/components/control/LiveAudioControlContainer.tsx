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
  LiveAudioControlJoinRequestMessage,
  LiveAudioControlState,
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
import {
  createControlSyncReducerState,
  reduceControlSyncEnvelope,
  type ControlSyncReducerState,
} from '../../utils/controlSyncReducer';
import {
  assignStableAliasOrdinal,
  formatAliasForControl,
  type AliasOrdinalState,
} from '../../utils/aliasOrdinals';
import {
  replacePrivateControlOverlay,
  type PrivateControlOverlaySnapshot,
} from '../../utils/privateControlOverlay';

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
  connected: participant.connected,
  updatedAt: participant.updatedAt,
});

interface ControlOperationalView {
  participants: Record<string, LiveAudioParticipantStatusMessage>;
  connectionCounts: LiveAudioConnectionCountsMessage | null;
  accessMode: 'PUBLIC' | 'CONTROLLED';
  recordingAvailable: boolean;
  recordingMutable: boolean;
  recordingState: 'NOT_RECORDING' | 'RECORDING';
  recordingEpoch: number;
  audienceAccessRequests: Record<string, number>;
}

interface ControlOperationalDelta {
  type: string;
  payload: Record<string, unknown>;
}

const snapshotToOperationalView = (snapshot: LiveAudioOperationalSnapshot): ControlOperationalView => {
  const participants: Record<string, LiveAudioParticipantStatusMessage> = {};
  for (const participant of snapshot.participants) {
    if (participant.role !== 'audience') continue;
    participants[participant.participantId] = snapshotParticipantToStatus(participant);
  }
  return {
    participants,
    connectionCounts: {
      type: 'LIVE_AUDIO_CONNECTION_COUNTS',
      ...snapshot.connectionCounts,
    },
    accessMode: snapshot.policies.accessMode,
    recordingAvailable: snapshot.policies.recordingAvailable,
    recordingMutable: snapshot.policies.recordingMutable,
    recordingState: snapshot.policies.recordingState,
    recordingEpoch: snapshot.policies.recordingEpoch,
    audienceAccessRequests: Object.fromEntries(
      snapshot.audienceAccessRequests.map((request) => [request.participantId, request.requestedAt]),
    ),
  };
};

const applyOperationalDelta = (
  state: ControlOperationalView,
  delta: ControlOperationalDelta,
): ControlOperationalView => {
  if (delta.type === 'LIVE_AUDIO_PARTICIPANT_STATUS') {
    const participant = delta.payload as unknown as LiveAudioParticipantStatusMessage;
    return {
      ...state,
      participants: {
        ...state.participants,
        [participant.participantId]: participant,
      },
    };
  }
  if (delta.type === 'LIVE_AUDIO_CONNECTION_COUNTS') {
    return {
      ...state,
      connectionCounts: delta.payload as unknown as LiveAudioConnectionCountsMessage,
    };
  }
  if (
    delta.type === 'SESSION_ACCESS_POLICY' &&
    (delta.payload.accessMode === 'PUBLIC' || delta.payload.accessMode === 'CONTROLLED')
  ) {
    return {
      ...state,
      accessMode: delta.payload.accessMode,
      ...(delta.payload.accessMode === 'PUBLIC' ? { audienceAccessRequests: {} } : {}),
    };
  }
  if (
    delta.type === 'SESSION_RECORDING_POLICY' &&
    (delta.payload.recordingState === 'NOT_RECORDING' || delta.payload.recordingState === 'RECORDING')
  ) {
    const nextParticipants = Object.fromEntries(
      Object.entries(state.participants).map(([participantId, participant]) => [
        participantId,
        delta.payload.recordingState === 'RECORDING'
          ? {
              ...participant,
              canPublishAudio: false,
              isMicrophoneActive: false,
              isMuted: true,
              microphoneTrackState: participant.speakerState === 'GRANTED'
                ? 'mutedByControl'
                : participant.microphoneTrackState,
            }
          : participant.speakerState === 'GRANTED'
            ? { ...participant, canPublishAudio: true }
            : participant,
      ]),
    );
    return {
      ...state,
      participants: nextParticipants,
      recordingAvailable: delta.payload.recordingAvailable === true,
      recordingMutable: delta.payload.recordingMutable === true,
      recordingState: delta.payload.recordingState,
      recordingEpoch: typeof delta.payload.recordingEpoch === 'number'
        ? delta.payload.recordingEpoch
        : state.recordingEpoch,
    };
  }
  if (
    delta.type === 'AUDIENCE_ACCESS_REQUEST' &&
    typeof delta.payload.participantId === 'string'
  ) {
    return {
      ...state,
      audienceAccessRequests: {
        ...state.audienceAccessRequests,
        [delta.payload.participantId]: typeof delta.payload.requestedAt === 'number'
          ? delta.payload.requestedAt
          : Date.now(),
      },
    };
  }
  if (
    delta.type === 'AUDIENCE_ACCESS_DECISION_RESULT' &&
    typeof delta.payload.participantId === 'string'
  ) {
    const next = { ...state.audienceAccessRequests };
    delete next[delta.payload.participantId];
    return { ...state, audienceAccessRequests: next };
  }
  return state;
};

export default function LiveAudioControlContainer({
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
  const [isModeratorMuted, setIsModeratorMuted] = useState(true);
  const [listenVolume, setListenVolume] = useState(100);
  const [microphoneVolume, setMicrophoneVolume] = useState(100);
  const [isModeratorMusicMode, setIsModeratorMusicMode] = useState(false);
  const [participantsMap, setParticipantsMap] = useState<Record<string, LiveAudioParticipantStatusMessage>>({});
  const [participantAliases, setParticipantAliases] = useState<Record<string, string>>({});
  const [participantAliasOrdinals, setParticipantAliasOrdinals] = useState<Record<string, number>>({});
  const [participantEphemeralKeys, setParticipantEphemeralKeys] = useState<Record<string, string>>({});
  const [participantMicrophoneConfigs, setParticipantMicrophoneConfigs] = useState<Record<string, { volume: number; musicMode: boolean }>>({});
  const [connectionCounts, setConnectionCounts] = useState<LiveAudioConnectionCountsMessage | null>(null);
  const [messages, setMessages] = useState<PrivateMessage[]>([]);
  const [joinRequests, setJoinRequests] = useState<Record<string, LiveAudioControlJoinRequestMessage>>({});
  const [accessMode, setAccessMode] = useState<'PUBLIC' | 'CONTROLLED'>('PUBLIC');
  const [recordingPolicy, setRecordingPolicy] = useState<{
    recordingAvailable: boolean;
    recordingMutable: boolean;
    recordingState: 'NOT_RECORDING' | 'RECORDING';
    recordingEpoch: number;
  }>({
    recordingAvailable: false,
    recordingMutable: false,
    recordingState: 'NOT_RECORDING',
    recordingEpoch: 0,
  });
  const [audienceAccessRequests, setAudienceAccessRequests] = useState<Record<string, number>>({});
  const participantAliasesRef = useRef(participantAliases);
  const aliasRequestSignatureRef = useRef('');
  const lastSentListRef = useRef('');
  const requestedAuthRef = useRef<string | null>(null);
  const operationalSyncRef = useRef<ControlSyncReducerState<ControlOperationalView, ControlOperationalDelta>>(
    createControlSyncReducerState(),
  );
  const aliasOrdinalStateRef = useRef<AliasOrdinalState>({
    assignments: {},
    nextByNormalizedAlias: {},
  });
  const privateOverlayRef = useRef<PrivateControlOverlaySnapshot | null>(null);
  const privateOverlayRevisionRef = useRef(0);
  const overlayPublishSequenceRef = useRef<Promise<void>>(Promise.resolve());

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
    if (!subscribeToWsMessage) return;
    const unsubscribe = subscribeToWsMessage((type, payload) => {
      if (type === 'PRESENTATION_SESSION_ROTATED') {
        setParticipantsMap({});
        setParticipantAliases({});
        setParticipantAliasOrdinals({});
        setParticipantEphemeralKeys({});
        setMessages([]);
        setJoinRequests({});
        setConnectionCounts(null);
        setAudienceAccessRequests({});
        operationalSyncRef.current = createControlSyncReducerState();
        aliasOrdinalStateRef.current = { assignments: {}, nextByNormalizedAlias: {} };
        privateOverlayRef.current = null;
        privateOverlayRevisionRef.current = 0;
        lastSentListRef.current = '';
        setRecordingPolicy((current) => ({
          ...current,
          recordingState: payload.recordingState === 'RECORDING' ? 'RECORDING' : 'NOT_RECORDING',
          recordingEpoch: typeof payload.recordingEpoch === 'number' ? payload.recordingEpoch : 0,
        }));
        return;
      }
      if (type === 'WELCOME' || type === 'SESSION_ACCESS_POLICY') {
        if (payload.accessMode === 'PUBLIC' || payload.accessMode === 'CONTROLLED') {
          setAccessMode(payload.accessMode);
        }
      }
      if (type === 'LIVE_AUDIO_SNAPSHOT') {
        const snapshot = payload.snapshot as LiveAudioOperationalSnapshot | undefined;
        if (!snapshot || !Array.isArray(snapshot.participants)) return;
        if (
          typeof snapshot.presentationSessionId !== 'string' ||
          typeof snapshot.serverEpoch !== 'string' ||
          !Number.isInteger(snapshot.stateRevision)
        ) return;
        const result = reduceControlSyncEnvelope(
          operationalSyncRef.current,
          {
            type: 'SNAPSHOT',
            sessionId: snapshot.presentationSessionId,
            serverEpoch: snapshot.serverEpoch,
            stateRevision: snapshot.stateRevision,
            state: snapshotToOperationalView(snapshot),
          },
          applyOperationalDelta,
        );
        operationalSyncRef.current = result.sync;
        if (result.sync.value) {
          setParticipantsMap(result.sync.value.participants);
          setConnectionCounts(result.sync.value.connectionCounts);
          setAccessMode(result.sync.value.accessMode);
          setRecordingPolicy({
            recordingAvailable: result.sync.value.recordingAvailable,
            recordingMutable: result.sync.value.recordingMutable,
            recordingState: result.sync.value.recordingState,
            recordingEpoch: result.sync.value.recordingEpoch,
          });
          setAudienceAccessRequests(result.sync.value.audienceAccessRequests);
        }
        return;
      }

      const revision = payload.stateRevision;
      const eventId = payload.eventId;
      const sessionId = payload.presentationSessionId;
      const serverEpoch = payload.serverEpoch;
      if (
        Number.isInteger(revision) &&
        typeof eventId === 'string' &&
        typeof sessionId === 'string' &&
        typeof serverEpoch === 'string'
      ) {
        const result = reduceControlSyncEnvelope(
          operationalSyncRef.current,
          {
            type: 'DELTA',
            sessionId,
            serverEpoch,
            stateRevision: Number(revision),
            eventId,
            delta: { type, payload },
          },
          applyOperationalDelta,
        );
        operationalSyncRef.current = result.sync;
        if (result.requestSnapshot) {
          wsSend?.('LIVE_AUDIO_SNAPSHOT_REQUEST', {
            type: 'LIVE_AUDIO_SNAPSHOT_REQUEST',
            controlSessionId: controlSessionId || undefined,
            lastAppliedStateRevision: result.sync.stateRevision < 0 ? 0 : result.sync.stateRevision,
            reason: 'GAP',
            createdAt: Date.now(),
          });
        }
        if (result.sync.value) {
          setParticipantsMap(result.sync.value.participants);
          setConnectionCounts(result.sync.value.connectionCounts);
          setAccessMode(result.sync.value.accessMode);
          setRecordingPolicy({
            recordingAvailable: result.sync.value.recordingAvailable,
            recordingMutable: result.sync.value.recordingMutable,
            recordingState: result.sync.value.recordingState,
            recordingEpoch: result.sync.value.recordingEpoch,
          });
          setAudienceAccessRequests(result.sync.value.audienceAccessRequests);
        }
        if (
          type === 'LIVE_AUDIO_PARTICIPANT_STATUS' ||
          type === 'LIVE_AUDIO_CONNECTION_COUNTS'
        ) return;
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
        return;
      }

      if (type === 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE') {
        const participantId = typeof payload.participantId === 'string' ? payload.participantId : '';
        if (!participantId) return;
        const isAliasVisibleToActiveParticipants = payload.isAliasVisibleToActiveParticipants === true;
        setParticipantsMap(prev => {
          const existing = prev[participantId];
          if (!existing) return prev;
          return {
            ...prev,
            [participantId]: {
              ...existing,
              isAliasVisibleToActiveParticipants,
            },
          };
        });
        wsSend?.('LIVE_AUDIO_SNAPSHOT_PATCH', {
          type: 'LIVE_AUDIO_SNAPSHOT_PATCH',
          snapshot: {
            participants: [{
              participantId,
              role: 'audience',
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
        return;
      }

      if (type === 'LIVE_AUDIO_CONTROL_JOIN_REQUEST') {
        const msg = payload as unknown as LiveAudioControlJoinRequestMessage;
        if (msg.controlSessionId) {
          setJoinRequests(prev => ({ ...prev, [msg.controlSessionId]: msg }));
        }
        return;
      }
      if (type === 'AUDIENCE_ACCESS_REQUEST' && typeof payload.participantId === 'string') {
        setAudienceAccessRequests((current) => ({
          ...current,
          [payload.participantId as string]: typeof payload.requestedAt === 'number'
            ? payload.requestedAt
            : Date.now(),
        }));
        return;
      }
      if (type === 'AUDIENCE_ACCESS_DECISION_RESULT' && typeof payload.participantId === 'string') {
        setAudienceAccessRequests((current) => {
          const next = { ...current };
          delete next[payload.participantId as string];
          return next;
        });
      }
    });
    return unsubscribe;
  }, [controlSessionId, subscribeToWsMessage, wsSend]);

  useEffect(() => {
    if (!isControlAuthorized || !wsSend || wsStatus !== 'open') return;
    wsSend('LIVE_AUDIO_SNAPSHOT_REQUEST', {
      type: 'LIVE_AUDIO_SNAPSHOT_REQUEST',
      controlSessionId: controlSessionId || undefined,
      lastAppliedStateRevision: operationalSyncRef.current.stateRevision < 0
        ? 0
        : operationalSyncRef.current.stateRevision,
      reason: operationalSyncRef.current.identity ? 'RECONNECT' : 'CONNECT',
      createdAt: Date.now(),
    });
  }, [controlSessionId, isControlAuthorized, wsSend, wsStatus]);

  const handlePrivateSignal = useCallback((signal: DecryptedPrivateControlSignal) => {
    const data = getSignalRecord(signal);
    const alias = sanitizeAlias(data.alias);
    if (alias) {
      aliasOrdinalStateRef.current = assignStableAliasOrdinal(
        aliasOrdinalStateRef.current,
        signal.fromParticipantId,
        alias,
      );
      setParticipantAliasOrdinals({ ...aliasOrdinalStateRef.current.assignments });
      setParticipantAliases(prev => ({ ...prev, [signal.fromParticipantId]: alias }));
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
      const fromAlias = alias || participantAliasesRef.current[signal.fromParticipantId] || 'Alias no recuperable';
      setMessages(prev => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fromAlias,
        content,
        timestamp: Date.now(),
      }]);
    }
  }, [wsSend]);

  const {
    sendPrivateSignalToParticipant,
    requestAliases,
    ready: privateSignalsReady,
    keyId: privateKeyId,
    requestControlAuthorization,
    authorizeSecondaryControl,
    encryptControlOverlay,
    decryptControlOverlay,
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

  useEffect(() => {
    if (!subscribeToWsMessage) return;
    return subscribeToWsMessage((type, payload) => {
      if (type !== 'LIVE_AUDIO_PRIVATE_OVERLAY_SNAPSHOT') return;
      if (
        typeof payload.keyId !== 'string' ||
        typeof payload.ciphertext !== 'string' ||
        typeof payload.nonce !== 'string' ||
        !Number.isSafeInteger(payload.privateStateRevision)
      ) return;
      const overlayKeyId = payload.keyId;
      const overlayCiphertext = payload.ciphertext;
      const overlayNonce = payload.nonce;
      const overlayRevision = Number(payload.privateStateRevision);

      void decryptControlOverlay({
        keyId: overlayKeyId,
        ciphertext: overlayCiphertext,
        nonce: overlayNonce,
      }).then((decrypted) => {
        const applied = replacePrivateControlOverlay(privateOverlayRef.current, decrypted, {
          expectedKeyId: overlayKeyId,
          currentTechnicalStateRevision: operationalSyncRef.current.stateRevision,
        });
        if (!applied.ok) {
          wsSend?.('LIVE_AUDIO_PRIVATE_OVERLAY_RESULT', {
            result: 'NACK',
            keyId: overlayKeyId,
            privateStateRevision: overlayRevision,
            reason: applied.reason,
          });
          return;
        }
        privateOverlayRef.current = applied.value;
        privateOverlayRevisionRef.current = applied.value.privateStateRevision;
        const aliases: Record<string, string> = {};
        const ordinals: Record<string, number> = {};
        const ephemeralKeys: Record<string, string> = {};
        const microphoneConfigs: Record<string, { volume: number; musicMode: boolean }> = {};
        const nextByNormalizedAlias: Record<string, number> = {};
        Object.entries(applied.value.participants).forEach(([id, participant]) => {
          aliases[id] = participant.alias;
          ordinals[id] = participant.aliasOrdinal;
          const normalized = participant.alias.trim().replace(/\s+/gu, ' ').normalize('NFC').toLocaleLowerCase();
          nextByNormalizedAlias[normalized] = Math.max(
            nextByNormalizedAlias[normalized] ?? 0,
            participant.aliasOrdinal + 1,
          );
          if (participant.ephemeralPublicKey) ephemeralKeys[id] = participant.ephemeralPublicKey;
          if (participant.microphoneConfig) microphoneConfigs[id] = participant.microphoneConfig;
        });
        aliasOrdinalStateRef.current = { assignments: ordinals, nextByNormalizedAlias };
        setParticipantAliases(aliases);
        setParticipantAliasOrdinals(ordinals);
        setParticipantEphemeralKeys(ephemeralKeys);
        setParticipantMicrophoneConfigs(microphoneConfigs);
        wsSend?.('LIVE_AUDIO_PRIVATE_OVERLAY_RESULT', {
          result: 'ACK',
          keyId: applied.value.keyId,
          privateStateRevision: applied.value.privateStateRevision,
        });
      }).catch(() => {
        wsSend?.('LIVE_AUDIO_PRIVATE_OVERLAY_RESULT', {
          result: 'NACK',
          keyId: overlayKeyId,
          privateStateRevision: overlayRevision,
          reason: 'DECRYPT_FAILED',
        });
      });
    });
  }, [decryptControlOverlay, subscribeToWsMessage, wsSend]);

  useEffect(() => {
    if (
      controlState !== 'PRINCIPAL' ||
      !privateSignalsReady ||
      !privateKeyId ||
      !wsSend
    ) return;
    const timer = window.setTimeout(() => {
      overlayPublishSequenceRef.current = overlayPublishSequenceRef.current.then(async () => {
        const privateStateRevision = privateOverlayRevisionRef.current + 1;
        const participants = Object.fromEntries(
          Object.entries(participantAliases).map(([id, alias]) => [
            id,
            {
              alias,
              aliasOrdinal: participantAliasOrdinals[id] ?? 0,
              ...(participantEphemeralKeys[id]
                ? { ephemeralPublicKey: participantEphemeralKeys[id] }
                : {}),
              ...(participantMicrophoneConfigs[id]
                ? { microphoneConfig: participantMicrophoneConfigs[id] }
                : {}),
            },
          ]),
        );
        const snapshot: PrivateControlOverlaySnapshot = {
          type: 'PRIVATE_CONTROL_OVERLAY_SNAPSHOT',
          keyId: privateKeyId,
          privateStateRevision,
          basedOnStateRevision: Math.max(0, operationalSyncRef.current.stateRevision),
          participants,
        };
        const encrypted = await encryptControlOverlay(snapshot);
        if (!encrypted || encrypted.keyId !== privateKeyId) return;
        privateOverlayRef.current = snapshot;
        privateOverlayRevisionRef.current = privateStateRevision;
        wsSend('LIVE_AUDIO_PRIVATE_OVERLAY_PUBLISH', {
          messageId: crypto.randomUUID(),
          keyId: encrypted.keyId,
          privateStateRevision,
          basedOnStateRevision: snapshot.basedOnStateRevision,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
        });
      }).catch((error) => {
        console.warn('LiveAudioControl: private overlay publication failed', error);
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [
    controlState,
    encryptControlOverlay,
    participantAliasOrdinals,
    participantAliases,
    participantEphemeralKeys,
    participantMicrophoneConfigs,
    privateKeyId,
    privateSignalsReady,
    wsSend,
  ]);

  useEffect(() => {
    if (controlState === 'PENDING' && verificationCode && requestedAuthRef.current !== verificationCode) {
      requestedAuthRef.current = verificationCode;
      void requestControlAuthorization(verificationCode).catch((err) => {
        console.warn('LiveAudioControl: Failed to request control authorization crypto:', err);
      });
    }
  }, [controlState, verificationCode, requestControlAuthorization]);

  const handleApproveRequest = useCallback((sessionId: string) => {
    const pending = authorizationRequests.find(request => request.controlSessionId === sessionId);
    const joinReq = joinRequests[sessionId] ?? (
      pending?.recipientPublicKey
        ? {
            type: 'LIVE_AUDIO_CONTROL_JOIN_REQUEST' as const,
            controlSessionId: pending.controlSessionId,
            verificationCode: pending.verificationCode,
            recipientPublicKey: pending.recipientPublicKey,
            messageId: pending.joinRequestId,
          }
        : null
    );
    if (!joinReq) {
      console.error('Cannot authorize Control without its current E2E public key');
      return;
    }

    void authorizeSecondaryControl(joinReq)
      .then((transferred) => {
        if (!transferred) return;
        onApproveRequest(sessionId);
        setJoinRequests(prev => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      })
      .catch(err => console.error('Failed to authorize secondary control crypto', err));
  }, [authorizationRequests, authorizeSecondaryControl, joinRequests, onApproveRequest]);

  const handleDismissMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleAudienceAccessDecision = useCallback((
    targetParticipantId: string,
    decision: 'ADMIT' | 'REJECT' | 'BLOCK',
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

  const handleRecordingStateChange = useCallback((nextState: 'NOT_RECORDING' | 'RECORDING') => {
    const sessionId = operationalSyncRef.current.identity?.sessionId;
    if (
      controlState !== 'PRINCIPAL' ||
      !recordingPolicy.recordingMutable ||
      nextState === recordingPolicy.recordingState ||
      !sessionId
    ) return;
    wsSend?.('SESSION_RECORDING_POLICY_UPDATE', {
      type: 'SESSION_RECORDING_POLICY_UPDATE',
      commandId: crypto.randomUUID(),
      presentationSessionId: sessionId,
      expectedStateRevision: operationalSyncRef.current.stateRevision,
      recordingState: nextState,
    });
  }, [controlState, recordingPolicy.recordingMutable, recordingPolicy.recordingState, wsSend]);

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
        const isActiveAudience = !isKicked && p.isActiveAudience === true;
        const isMicrophoneActive = p.isMicrophoneActive ?? (p.speakerState === 'GRANTED' && p.isMuted === false);
        return {
          participantId: p.participantId,
          alias: alias
            ? formatAliasForControl(alias, participantAliasOrdinals[p.participantId] ?? 0)
            : 'Sincronizando alias…',
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

  const doModerationAction = useCallback((endpoint: ModerationEndpoint, pid?: string) => {
    if (!controlSessionId) return;
    if (!sendModerationMessage(endpoint, pid)) {
      console.error(`Error sending authoritative moderation action ${endpoint}`);
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

  const portalTarget = document.getElementById('live-audio-inbox-portal-target');
  const accessRequestItems = Object.entries(audienceAccessRequests).map(([id, requestedAt]) => ({
    participantId: id,
    alias: participantAliases[id]
      ? formatAliasForControl(participantAliases[id], participantAliasOrdinals[id] ?? 0)
      : 'Sincronizando alias…',
    requestedAt,
  }));
  const hasUnread = messages.length > 0 || authorizationRequests.length > 0 || accessRequestItems.length > 0;
  const inboxPortal = portalTarget ? createPortal(
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleAccessModeChange}
        disabled={controlState !== 'PRINCIPAL'}
        className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        title="Solo el Control principal puede cambiar el modo de acceso"
      >
        Acceso: {accessMode === 'PUBLIC' ? 'Público' : 'Controlado'}
      </button>
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
              {messages.length + authorizationRequests.length + accessRequestItems.length}
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
      />
    </div>,
    portalTarget,
  ) : null;

  if (availability !== 'enabled') {
    return inboxPortal;
  }

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

      <LiveAudioControlPanel
        totalAudience={totalAudience}
        activeUsers={activeUsers}
        isModeratorMuted={isModeratorMuted}
        onStartListening={handleStartListening}
        onToggleModeratorMic={handleToggleModeratorMic}
        listenVolume={listenVolume}
        onListenVolumeChange={(volume) => setListenVolume(clampListenVolume(volume))}
        microphoneVolume={microphoneVolume}
        recordingState={recordingPolicy.recordingState}
        recordingEpoch={recordingPolicy.recordingEpoch}
        recordingMutable={recordingPolicy.recordingAvailable && recordingPolicy.recordingMutable && controlState === 'PRINCIPAL'}
        onRecordingStateChange={handleRecordingStateChange}
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
