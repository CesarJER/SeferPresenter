// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIENCE_PRIVACY_STORAGE_TTL_MS,
  readExpiringStorage,
  writeExpiringStorage,
} from '../../src/utils/privacyStorage';

describe('expiring privacy storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips data only before the configured expiry', () => {
    writeExpiringStorage(localStorage, 'privacy-test', { value: 1 }, 1_000);
    expect(readExpiringStorage(localStorage, 'privacy-test', 1_001)).toEqual({ value: 1 });
    expect(readExpiringStorage(
      localStorage,
      'privacy-test',
      1_000 + AUDIENCE_PRIVACY_STORAGE_TTL_MS,
    )).toBeNull();
    expect(localStorage.getItem('privacy-test')).toBeNull();
  });

  it('purges legacy, malformed and expired values idempotently', () => {
    localStorage.setItem('legacy', JSON.stringify({ personal: 'old' }));
    expect(readExpiringStorage(localStorage, 'legacy')).toBeNull();
    expect(readExpiringStorage(localStorage, 'legacy')).toBeNull();

    localStorage.setItem('malformed', '{');
    expect(readExpiringStorage(localStorage, 'malformed')).toBeNull();
    expect(localStorage.getItem('malformed')).toBeNull();
  });

  it('uses a bounded default TTL no longer than seven days', () => {
    expect(AUDIENCE_PRIVACY_STORAGE_TTL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(AUDIENCE_PRIVACY_STORAGE_TTL_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
});
