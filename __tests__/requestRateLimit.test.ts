import { describe, expect, it } from 'vitest';
import { createFixedWindowRateLimiter } from '../server/request-rate-limit.mjs';

describe('fixed-window request limiter', () => {
  it('limits each client key and permits it again after the window', () => {
    let timestamp = 1_000;
    const check = createFixedWindowRateLimiter({
      limit: 2,
      windowMs: 1_000,
      now: () => timestamp,
    });

    expect(check('client-a').allowed).toBe(true);
    expect(check('client-a').allowed).toBe(true);
    expect(check('client-a')).toEqual({ allowed: false, retryAfterMs: 1_000 });
    expect(check('client-b').allowed).toBe(true);

    timestamp = 2_000;
    expect(check('client-a').allowed).toBe(true);
  });
});
