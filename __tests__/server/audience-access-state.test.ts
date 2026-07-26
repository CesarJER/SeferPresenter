import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authorizeAudienceCredential,
  bootstrapAudienceAccess,
  logoutAudienceCredential,
  resetWsServerStateForTests,
} from '../../server/ws-server.mjs';

describe('Audience resume credential lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    delete process.env.SEFER_AUDIENCE_RESUME_TTL_HOURS;
    delete process.env.SEFER_AUDIENCE_ACCESS_CAPACITY;
    resetWsServerStateForTests();
  });

  afterEach(() => {
    delete process.env.SEFER_AUDIENCE_RESUME_TTL_HOURS;
    delete process.env.SEFER_AUDIENCE_ACCESS_CAPACITY;
    resetWsServerStateForTests();
    vi.useRealTimers();
  });

  it('uses an absolute 24-hour TTL by default', () => {
    const access = bootstrapAudienceAccess() as {
      credential: string;
      expiresAt: number;
    };
    expect(access.expiresAt).toBe(Date.now() + 24 * 60 * 60 * 1000);
    expect(authorizeAudienceCredential(access.credential, { requireAdmitted: false })).not.toBeNull();

    vi.setSystemTime(new Date('2026-01-02T00:00:00.001Z'));
    expect(authorizeAudienceCredential(access.credential, { requireAdmitted: false })).toBeNull();
  });

  it('caps configured recovery at 168 hours', () => {
    process.env.SEFER_AUDIENCE_RESUME_TTL_HOURS = '500';
    resetWsServerStateForTests();
    const access = bootstrapAudienceAccess() as { expiresAt: number };
    expect(access.expiresAt).toBe(Date.now() + 168 * 60 * 60 * 1000);
  });

  it('invalidates the server-side digest on logout', () => {
    const access = bootstrapAudienceAccess() as { credential: string };
    expect(logoutAudienceCredential(access.credential)).toBe(true);
    expect(authorizeAudienceCredential(access.credential, { requireAdmitted: false })).toBeNull();
  });

  it('caps outstanding resume credentials without advancing hidden state', () => {
    process.env.SEFER_AUDIENCE_ACCESS_CAPACITY = '2';
    const first = bootstrapAudienceAccess() as { stateRevision: number };
    const second = bootstrapAudienceAccess() as { stateRevision: number };

    expect(first.stateRevision).toBe(0);
    expect(second.stateRevision).toBe(0);
    expect(() => bootstrapAudienceAccess()).toThrow(/capacity reached/i);
  });
});
