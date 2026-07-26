import { describe, expect, it } from 'vitest';
import {
  advanceControlAuthorizationAttempt,
  createControlAuthorizationAttempt,
  type ControlAuthorizationAck,
  type ControlAuthorizationAttempt,
} from '../../src/features/liveAudio/utils/controlAuthorizationFlow';

const NOW = 1_000;

const makeAttempt = (
  overrides: Partial<ControlAuthorizationAttempt> = {},
): ControlAuthorizationAttempt => createControlAuthorizationAttempt({
  targetControlSessionId: 'control-secondary',
  transferId: 'transfer-one',
  keyId: 'session-key-one',
  expiresAt: NOW + 5_000,
  ...overrides,
});

const makeAck = (
  overrides: Partial<ControlAuthorizationAck> = {},
): ControlAuthorizationAck => ({
  outcome: 'ACK',
  targetControlSessionId: 'control-secondary',
  transferId: 'transfer-one',
  keyId: 'session-key-one',
  ...overrides,
});

describe('control authorization flow', () => {
  it('approves only after a fully correlated ACK', () => {
    const result = advanceControlAuthorizationAttempt(
      makeAttempt(),
      { type: 'ACK_RECEIVED', ack: makeAck() },
      NOW,
    );

    expect(result).toMatchObject({
      attempt: { status: 'APPROVED' },
      shouldApprove: true,
    });
  });

  it('does not approve when the encrypted transfer fails', () => {
    const result = advanceControlAuthorizationAttempt(
      makeAttempt(),
      { type: 'TRANSFER_FAILED', reason: 'ENCRYPTION_FAILED' },
      NOW,
    );

    expect(result).toMatchObject({
      attempt: {
        status: 'FAILED',
        failureReason: 'ENCRYPTION_FAILED',
      },
      shouldApprove: false,
    });
  });

  it('does not approve a correlated NACK', () => {
    const result = advanceControlAuthorizationAttempt(
      makeAttempt(),
      {
        type: 'ACK_RECEIVED',
        ack: makeAck({ outcome: 'NACK', reason: 'PRIVATE_KEY_IMPORT_FAILED' }),
      },
      NOW,
    );

    expect(result).toMatchObject({
      attempt: {
        status: 'FAILED',
        failureReason: 'PRIVATE_KEY_IMPORT_FAILED',
      },
      shouldApprove: false,
    });
  });

  it('times out without approving when no ACK arrives', () => {
    const result = advanceControlAuthorizationAttempt(
      makeAttempt(),
      { type: 'TIMEOUT' },
      NOW + 5_000,
    );

    expect(result).toMatchObject({
      attempt: {
        status: 'TIMED_OUT',
        failureReason: 'ACK_TIMEOUT',
      },
      shouldApprove: false,
    });
  });

  it.each([
    ['another Control', { targetControlSessionId: 'control-other' }],
    ['another transfer', { transferId: 'transfer-other' }],
    ['another key', { keyId: 'session-key-other' }],
  ])('ignores an ACK correlated to %s', (_label, ackOverrides) => {
    const attempt = makeAttempt();
    const result = advanceControlAuthorizationAttempt(
      attempt,
      { type: 'ACK_RECEIVED', ack: makeAck(ackOverrides) },
      NOW,
    );

    expect(result).toEqual({
      attempt,
      shouldApprove: false,
    });
  });

  it('rejects a correct but late ACK as timed out', () => {
    const result = advanceControlAuthorizationAttempt(
      makeAttempt(),
      { type: 'ACK_RECEIVED', ack: makeAck() },
      NOW + 5_000,
    );

    expect(result).toMatchObject({
      attempt: { status: 'TIMED_OUT' },
      shouldApprove: false,
    });
  });

  it('does not approve twice when the correlated ACK is duplicated', () => {
    const first = advanceControlAuthorizationAttempt(
      makeAttempt(),
      { type: 'ACK_RECEIVED', ack: makeAck() },
      NOW,
    );
    const duplicate = advanceControlAuthorizationAttempt(
      first.attempt,
      { type: 'ACK_RECEIVED', ack: makeAck() },
      NOW + 1,
    );

    expect(first.shouldApprove).toBe(true);
    expect(duplicate).toEqual({
      attempt: first.attempt,
      shouldApprove: false,
    });
  });
});
