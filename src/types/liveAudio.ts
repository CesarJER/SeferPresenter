export type LiveAudioAvailability = 'enabled' | 'disabled' | 'misconfigured' | 'unsupported';

export type LiveAudioParticipantRole = 'audience' | 'control' | 'presenter';
export type LiveAudioConnectionState =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'reconnected'
  | 'reconnectFailed'
  | 'disconnected'
  | 'permissionDenied'
  | 'unavailable';

export type ControlPrincipalState = 'PRINCIPAL';
export type ControlSecondaryState = 'PENDING' | 'AUTHORIZED';
export type LiveAudioControlState = ControlPrincipalState | ControlSecondaryState;
export type SpeakerState = 'LISTENER' | 'REQUESTED' | 'GRANTED' | 'MUTED' | 'REVOKED';

export interface LiveAudioRemoteTrack {
  id: string;
  track: MediaStreamTrack;
  participantId: string | null;
  participantIdentity: string | null;
}

export interface PendingControlAuthorization {
  controlSessionId: string;
  verificationCode: string;
  codeExpiresAt: number;
  connectedAt: number;
}

export interface LiveAudioParticipantStatusMessage {
  type: 'LIVE_AUDIO_PARTICIPANT_STATUS';
  participantId: string;
  role: LiveAudioParticipantRole;
  speakerState: SpeakerState;
  controlState?: ControlPrincipalState | ControlSecondaryState;
  canSubscribe: boolean;
  canPublishAudio: boolean;
  isMuted?: boolean;
  isActiveAudience?: boolean;
  isMicrophoneActive?: boolean;
  isKicked?: boolean;
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
  keyId?: string;
  sessionPublicKey?: string;
  transferPublicKey?: string;
  encryptedSessionPrivateKey?: string;
  nonce?: string;
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
  fromParticipantId: string;
  toControlSessionId?: string;
  toParticipantId?: string;
  keyId: string;
  ephemeralPublicKey: string;
  ciphertext: string;
  nonce: string;
  createdAt?: number;
}

export interface LiveAudioRequestAliasesMessage {
  type: 'LIVE_AUDIO_REQUEST_ALIASES';
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
  | LiveAudioControlPublicKeyMessage
  | LiveAudioControlJoinRequestMessage
  | LiveAudioControlAuthorizedMessage
  | LiveAudioControlAuthorizationStateMessage
  | LiveAudioControlAuthorizationDecisionMessage
  | ControlKeyRotatedMessage
  | PrivateControlSignalMessage
  | LiveAudioRequestAliasesMessage;
