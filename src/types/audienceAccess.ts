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
}
