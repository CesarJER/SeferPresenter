import { describe, expect, it } from 'vitest';
import { analyseLogText, hasPotentialPrivacyLeak } from '../scripts/privacy-log-audit.mjs';

describe('privacy log audit', () => {
  it('reports only counts for IPs and sensitive payload shapes', () => {
    const counts = analyseLogText([
      'request from 203.0.113.8',
      'Authorization: Bearer secret-value',
      '{"alias":"visible"}',
    ].join('\n'));
    expect(counts).toMatchObject({ ipv4: 1, authorization: 1, sensitiveField: 1 });
    expect(hasPotentialPrivacyLeak(counts)).toBe(true);
  });

  it('accepts allowlisted operational events without values', () => {
    const counts = analyseLogText([
      '[LIVEKIT] livekit:token:issued role=audience',
      '[SERVER] Presentation session rotated',
    ].join('\n'));
    expect(hasPotentialPrivacyLeak(counts)).toBe(false);
  });
});
