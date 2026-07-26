export type ControlAuthorizationAttemptStatus =
  | 'AWAITING_ACK'
  | 'APPROVED'
  | 'FAILED'
  | 'TIMED_OUT';

export interface ControlAuthorizationAttempt {
  targetControlSessionId: string;
  transferId: string;
  keyId: string;
  expiresAt: number;
  status: ControlAuthorizationAttemptStatus;
  failureReason?: string;
}

export interface ControlAuthorizationAck {
  outcome: 'ACK' | 'NACK';
  targetControlSessionId: string;
  transferId: string;
  keyId: string;
  reason?: string;
}

export type ControlAuthorizationEvent =
  | { type: 'ACK_RECEIVED'; ack: ControlAuthorizationAck }
  | { type: 'TRANSFER_FAILED'; reason?: string }
  | { type: 'TIMEOUT' };

export interface ControlAuthorizationTransition {
  attempt: ControlAuthorizationAttempt;
  shouldApprove: boolean;
}

export const createControlAuthorizationAttempt = (
  input: Omit<ControlAuthorizationAttempt, 'status' | 'failureReason'>,
): ControlAuthorizationAttempt => ({
  ...input,
  status: 'AWAITING_ACK',
});

const isCorrelatedAck = (
  attempt: ControlAuthorizationAttempt,
  ack: ControlAuthorizationAck,
): boolean => (
  ack.targetControlSessionId === attempt.targetControlSessionId
  && ack.transferId === attempt.transferId
  && ack.keyId === attempt.keyId
);

export const advanceControlAuthorizationAttempt = (
  attempt: ControlAuthorizationAttempt,
  event: ControlAuthorizationEvent,
  now: number,
): ControlAuthorizationTransition => {
  if (attempt.status !== 'AWAITING_ACK') {
    return { attempt, shouldApprove: false };
  }

  if (now >= attempt.expiresAt || event.type === 'TIMEOUT') {
    return {
      attempt: {
        ...attempt,
        status: 'TIMED_OUT',
        failureReason: 'ACK_TIMEOUT',
      },
      shouldApprove: false,
    };
  }

  if (event.type === 'TRANSFER_FAILED') {
    return {
      attempt: {
        ...attempt,
        status: 'FAILED',
        failureReason: event.reason || 'TRANSFER_FAILED',
      },
      shouldApprove: false,
    };
  }

  if (!isCorrelatedAck(attempt, event.ack)) {
    return { attempt, shouldApprove: false };
  }

  if (event.ack.outcome === 'NACK') {
    return {
      attempt: {
        ...attempt,
        status: 'FAILED',
        failureReason: event.ack.reason || 'TRANSFER_REJECTED',
      },
      shouldApprove: false,
    };
  }

  return {
    attempt: {
      ...attempt,
      status: 'APPROVED',
    },
    shouldApprove: true,
  };
};
