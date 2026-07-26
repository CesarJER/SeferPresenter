export type SessionAccessMode = 'PUBLIC' | 'CONTROLLED';
export type AudienceAccessState =
  | 'LOADING'
  | 'REQUEST_REQUIRED'
  | 'WAITING'
  | 'ADMITTED'
  | 'REJECTED'
  | 'BLOCKED'
  | 'CREDENTIAL_OBSOLETE';

export interface AudienceAccessSnapshot {
  presentationSessionId: string;
  accessMode: SessionAccessMode;
  participantId: string | null;
  accessState: AudienceAccessState;
  retryAt?: number;
  expiresAt?: number;
  stateRevision: number;
}

export interface AudienceAccessStateMessage extends AudienceAccessSnapshot {
  type: 'AUDIENCE_ACCESS_STATE';
  eventId?: string;
}

export interface AudienceAccessRequestMessage {
  type: 'AUDIENCE_ACCESS_REQUEST';
  participantId: string;
  requestedAt: number;
}

export interface AudienceAccessDecisionMessage {
  type: 'AUDIENCE_ACCESS_DECISION';
  participantId: string;
  decision: 'ADMIT' | 'REJECT' | 'BLOCK';
  createdAt?: number;
}

export interface SessionAccessPolicyMessage {
  type: 'SESSION_ACCESS_POLICY';
  accessMode: SessionAccessMode;
  updatedAt: number;
}
