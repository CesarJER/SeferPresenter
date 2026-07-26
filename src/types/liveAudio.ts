export type LiveAudioAvailability = 'enabled' | 'disabled' | 'misconfigured' | 'unsupported';
export type LiveAudioConnectionQuality =
  | 'excellent'
  | 'good'
  | 'poor'
  | 'lost'
  | 'unknown';

export type LiveAudioParticipantRole = 'audience' | 'control' | 'presenter';
export type LiveAudioOperationalRole = 'pasivo' | 'activo' | 'cola' | 'orador' | 'control' | 'presenter';
export type MicrophonePermissionState = 'unknown' | 'prompt' | 'denied' | 'granted' | 'unavailable';
export type MicrophoneTrackState =
  | 'notRequested'
  | 'off'
  | 'publishing'
  | 'mutedByUser'
  | 'mutedByControl'
  | 'error';
export type LiveAudioConnectionState =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'reconnected'
  | 'reconnectFailed'
  | 'disconnected'
  | 'permissionDenied'
  | 'unavailable';

export interface LiveAudioMicrophoneDiagnostics {
  secureContext: boolean;
  mediaDevicesAvailable: boolean;
  permissionState: PermissionState | 'unsupported' | 'unknown';
  lastErrorName: string | null;
  lastErrorMessage: string | null;
}

export type ControlPrincipalState = 'PRINCIPAL';
export type ControlSecondaryState = 'PENDING' | 'AUTHORIZED_SYNCING' | 'AUTHORIZED';
export type LiveAudioControlState = ControlPrincipalState | ControlSecondaryState;
export type SpeakerState = 'LISTENER' | 'REQUESTED' | 'GRANTED' | 'MUTED' | 'REVOKED';

export interface LiveAudioRemoteTrack {
  id: string;
  track: MediaStreamTrack;
  attach: (element: HTMLMediaElement) => void;
  detach: (element: HTMLMediaElement) => void;
  participantId: string | null;
  participantIdentity: string | null;
}

export interface PendingControlAuthorization {
  controlSessionId: string;
  verificationCode: string;
  codeExpiresAt: number;
  connectedAt: number;
  recipientPublicKey?: string;
  joinRequestId?: string;
}

export interface LiveAudioParticipantStatusMessage {
  type: 'LIVE_AUDIO_PARTICIPANT_STATUS';
  participantId: string;
  role: LiveAudioParticipantRole;
  operationalRole?: LiveAudioOperationalRole;
  microphonePermissionState?: MicrophonePermissionState;
  microphoneTrackState?: MicrophoneTrackState;
  speakerState: SpeakerState;
  controlState?: ControlPrincipalState | ControlSecondaryState;
  canSubscribe: boolean;
  canPublishAudio: boolean;
  isMuted?: boolean;
  isActiveAudience?: boolean;
  isMicrophoneActive?: boolean;
  isKicked?: boolean;
  isAliasVisibleToActiveParticipants?: boolean;
  canViewActiveParticipants?: boolean;
  isAliasHiddenByControl?: boolean;
  connected?: boolean;
  updatedAt?: number;
}

export interface LiveAudioConnectionCountsMessage {
  type: 'LIVE_AUDIO_CONNECTION_COUNTS';
  totalConnections: number;
  audienceConnections: number;
  controlConnections: number;
  presenterConnections: number;
  updatedAt?: number;
}

export interface LiveAudioGrantSpeakMessage {
  type: 'LIVE_AUDIO_GRANT_SPEAK';
  participantId: string;
  issuedByParticipantId?: string;
  createdAt?: number;
}

export interface LiveAudioRevokeSpeakMessage {
  type: 'LIVE_AUDIO_REVOKE_SPEAK';
  participantId: string;
  issuedByParticipantId?: string;
  createdAt?: number;
}

export interface LiveAudioMuteParticipantMessage {
  type: 'LIVE_AUDIO_MUTE_PARTICIPANT';
  participantId: string;
  issuedByParticipantId?: string;
  createdAt?: number;
}

export interface LiveAudioMuteAllMessage {
  type: 'LIVE_AUDIO_MUTE_ALL';
  issuedByParticipantId?: string;
  excludeParticipantIds?: string[];
  createdAt?: number;
}

export interface LiveAudioKickParticipantMessage {
  type: 'LIVE_AUDIO_KICK_PARTICIPANT';
  participantId: string;
  issuedByParticipantId?: string;
  createdAt?: number;
}

export interface LiveAudioRescueParticipantMessage {
  type: 'LIVE_AUDIO_RESCUE_PARTICIPANT';
  participantId: string;
  issuedByParticipantId?: string;
  createdAt?: number;
}

export interface LiveAudioSetActiveListViewPermissionMessage {
  type: 'LIVE_AUDIO_SET_ACTIVE_LIST_VIEW_PERMISSION';
  participantId: string;
  canViewActiveParticipants: boolean;
  createdAt?: number;
}

export interface LiveAudioSetAliasSharedVisibilityMessage {
  type: 'LIVE_AUDIO_SET_ALIAS_SHARED_VISIBILITY';
  participantId: string;
  isAliasHiddenByControl: boolean;
  createdAt?: number;
}

export interface LiveAudioRemoveActiveParticipantMessage {
  type: 'LIVE_AUDIO_REMOVE_ACTIVE_PARTICIPANT';
  participantId: string;
  createdAt?: number;
}

export interface LiveAudioActiveParticipantProfileMessage {
  type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE';
  participantId: string;
  isAliasVisibleToActiveParticipants: boolean;
  createdAt?: number;
}

export interface LiveAudioActiveListViewPermissionMessage {
  type: 'LIVE_AUDIO_ACTIVE_LIST_VIEW_PERMISSION';
  participantId: string;
  canViewActiveParticipants: boolean;
  createdAt?: number;
}

export interface LiveAudioControlPublicKeyMessage {
  type: 'LIVE_AUDIO_CONTROL_PUBLIC_KEY';
  controlSessionId: string;
  keyId: string;
  publicKey: string;
  createdAt?: number;
}

export interface LiveAudioControlJoinRequestMessage {
  type: 'LIVE_AUDIO_CONTROL_JOIN_REQUEST';
  controlSessionId: string;
  verificationCode: string;
  recipientPublicKey?: string;
  createdAt?: number;
}

export interface LiveAudioControlAuthorizedMessage {
  type: 'LIVE_AUDIO_CONTROL_AUTHORIZED';
  controlSessionId: string;
  authorizedByControlSessionId: string;
  transferId: string;
  keyId: string;
  sessionPublicKey: string;
  transferPublicKey: string;
  encryptedSessionPrivateKey: string;
  nonce: string;
  createdAt?: number;
}

export interface LiveAudioControlKeyTransferResultMessage {
  type: 'LIVE_AUDIO_CONTROL_KEY_TRANSFER_RESULT';
  controlSessionId: string;
  transferId: string;
  keyId: string;
  result: 'ACK' | 'NACK';
  reason?: 'IMPORT_FAILED' | 'INVALID_TRANSFER' | 'KEY_MISMATCH';
  createdAt?: number;
}

export interface LiveAudioControlAuthorizationStateMessage {
  type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE';
  controlSessionId: string;
  controlState: LiveAudioControlState;
  principalControlSessionId?: string;
  verificationCode?: string;
  codeExpiresAt?: number;
  allowDelegatedModerators: boolean;
  pendingControls?: PendingControlAuthorization[];
  updatedAt?: number;
}

export interface LiveAudioControlAuthorizationDecisionMessage {
  type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION';
  targetControlSessionId: string;
  decision: 'APPROVE' | 'REJECT';
  issuedByControlSessionId?: string;
  createdAt?: number;
}

export interface ControlKeyRotatedMessage {
  type: 'CONTROL_KEY_ROTATED';
  keyId: string;
  publicKey?: string;
  controlSessionId?: string;
  reason?: 'CONTROL_ROTATION' | 'NO_AUTHORIZED_CONTROLS';
  createdAt?: number;
}

export interface PrivateControlSignalMessage {
  type: 'PRIVATE_CONTROL_SIGNAL';
  signalClass: 'PROFILE_STATE' | 'PRIVATE_MESSAGE' | 'CONTROL_STATE';
  fromParticipantId: string;
  toControlSessionId?: string;
  toParticipantId?: string;
  keyId: string;
  ephemeralPublicKey: string;
  ciphertext: string;
  nonce: string;
  messageId?: string;
  createdAt?: number;
}

export interface PrivateControlSignalResultMessage {
  type: 'PRIVATE_CONTROL_SIGNAL_RESULT';
  messageId: string;
  result: 'ACK' | 'NACK';
  reason?: 'INVALID_SIGNAL' | 'RATE_LIMIT' | 'NO_RECIPIENT';
  retryAfterMs?: number;
  createdAt?: number;
}

export interface LiveAudioRequestAliasesMessage {
  type: 'LIVE_AUDIO_REQUEST_ALIASES';
  createdAt?: number;
}

export interface LiveAudioOperationalParticipantSnapshot {
  participantId: string;
  role: LiveAudioParticipantRole;
  operationalRole: LiveAudioOperationalRole;
  microphonePermissionState: MicrophonePermissionState;
  microphoneTrackState: MicrophoneTrackState;
  speakerState: SpeakerState;
  canSubscribe: boolean;
  canPublishAudio: boolean;
  isMuted: boolean;
  isActiveAudience: boolean;
  isMicrophoneActive: boolean;
  isKicked: boolean;
  isAliasVisibleToActiveParticipants?: boolean;
  canViewActiveParticipants?: boolean;
  isAliasHiddenByControl?: boolean;
  connected: boolean;
  connectedAt?: number;
  disconnectedAt?: number;
  updatedAt: number;
}

export interface LiveAudioOperationalControlSnapshot {
  controlSessionId: string;
  clientId: string;
  controlState: LiveAudioControlState;
  connectedAt: number;
  authorizedAt: number;
  codeExpiresAt?: number;
}

export interface LiveAudioOperationalQuizAggregateSnapshot {
  submittedAnswersBySlideId: Record<string, number>;
  finalScoreRanges?: Record<string, number>;
  totalFinalScores: number;
  updatedAt: number | null;
}

export interface LiveAudioOperationalSnapshot {
  snapshotId: string;
  createdAt: number;
  presentationSessionId: string;
  serverEpoch: string;
  stateRevision: number;
  connectionCounts: {
    totalConnections: number;
    audienceConnections: number;
    controlConnections: number;
    presenterConnections: number;
    updatedAt: number;
  };
  participants: LiveAudioOperationalParticipantSnapshot[];
  interventionQueue: string[];
  authorizations: {
    principalControlSessionId: string | null;
    controls: LiveAudioOperationalControlSnapshot[];
    pendingControls: PendingControlAuthorization[];
    allowDelegatedModerators: boolean;
  };
  liveKit: {
    enabled?: boolean;
    available?: boolean;
    participants: Array<{
      participantId: string;
      role: LiveAudioParticipantRole;
      room?: string;
      speakerState: SpeakerState;
      canSubscribe: boolean;
      canPublish: boolean;
      expiresAt?: number;
    }>;
    speakers: string[];
    muted: string[];
    kicked: string[];
  };
  quizAggregate: LiveAudioOperationalQuizAggregateSnapshot;
}

export interface LiveAudioSnapshotRequestMessage {
  type: 'LIVE_AUDIO_SNAPSHOT_REQUEST';
  controlSessionId?: string;
  lastAppliedStateRevision?: number;
  reason?: 'CONNECT' | 'RECONNECT' | 'GAP' | 'STALE_SNAPSHOT' | 'NACK';
  createdAt?: number;
}

export interface LiveAudioSnapshotMessage {
  type: 'LIVE_AUDIO_SNAPSHOT';
  snapshot: LiveAudioOperationalSnapshot;
  createdAt?: number;
}

export interface LiveAudioSnapshotPatchMessage {
  type: 'LIVE_AUDIO_SNAPSHOT_PATCH';
  snapshot: Partial<LiveAudioOperationalSnapshot>;
  createdAt?: number;
}

export interface LiveAudioStatusResponse {
  enabled: boolean;
  available?: boolean;
  reason?: string;
}

export interface LiveAudioTokenResponse {
  livekitUrl: string;
  token: string;
  refreshCredential: string;
  expiresAt: number;
  participantIdentity: string;
  participantId: string;
}

export type LiveAudioBroadcastMessage =
  | LiveAudioParticipantStatusMessage
  | LiveAudioConnectionCountsMessage
  | LiveAudioGrantSpeakMessage
  | LiveAudioRevokeSpeakMessage
  | LiveAudioMuteParticipantMessage
  | LiveAudioMuteAllMessage
  | LiveAudioKickParticipantMessage
  | LiveAudioRescueParticipantMessage
  | LiveAudioSetActiveListViewPermissionMessage
  | LiveAudioSetAliasSharedVisibilityMessage
  | LiveAudioRemoveActiveParticipantMessage
  | LiveAudioActiveParticipantProfileMessage
  | LiveAudioActiveListViewPermissionMessage
  | LiveAudioControlPublicKeyMessage
  | LiveAudioControlJoinRequestMessage
  | LiveAudioControlAuthorizedMessage
  | LiveAudioControlKeyTransferResultMessage
  | LiveAudioControlAuthorizationStateMessage
  | LiveAudioControlAuthorizationDecisionMessage
  | ControlKeyRotatedMessage
  | PrivateControlSignalMessage
  | PrivateControlSignalResultMessage
  | LiveAudioRequestAliasesMessage
  | LiveAudioSnapshotRequestMessage
  | LiveAudioSnapshotMessage
  | LiveAudioSnapshotPatchMessage;
