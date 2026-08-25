import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIVACY_POLICY_PATH,
  DEFAULT_PRIVACY_SUMMARY_PATH,
  extractLegalDocumentVersion,
  normalizePrivacyPolicyPath,
  normalizeLegalMarkdownPath,
  extractLegalDocumentTitle,
  prepareLegalMarkdownForDisplay,
  sha256Hex,
} from '../src/utils/legalDocument';
import { getStaticCacheHeaders } from '../server/static-cache-policy.mjs';

describe('legal document configuration', () => {
  it('allows only Markdown documents contained under /legal/', () => {
    expect(normalizePrivacyPolicyPath('/legal/operator.local/privacy-policy.local.md'))
      .toBe('/legal/operator.local/privacy-policy.local.md');
    expect(normalizePrivacyPolicyPath('/api/state')).toBe(DEFAULT_PRIVACY_POLICY_PATH);
    expect(normalizePrivacyPolicyPath('/legal/../private.md')).toBe(DEFAULT_PRIVACY_POLICY_PATH);
    expect(normalizePrivacyPolicyPath('/legal/policy.html')).toBe(DEFAULT_PRIVACY_POLICY_PATH);
    expect(normalizeLegalMarkdownPath('/api/state', DEFAULT_PRIVACY_SUMMARY_PATH)).toBe(DEFAULT_PRIVACY_SUMMARY_PATH);
  });

  it('extracts the declared version and computes a stable SHA-256', async () => {
    const text = '# Política\n\nVersión: 2026-07-31\n';
    expect(extractLegalDocumentVersion(text)).toBe('2026-07-31');
    expect(await sha256Hex(text)).toMatch(/^[a-f0-9]{64}$/);
    expect(await sha256Hex(text)).toBe(await sha256Hex(text));
  });

  it('extracts display metadata without repeating the internal Markdown header', () => {
    const text = '# Política legible\n\nVersión: visual-2\n\nEstado: borrador\n\n## Responsable';
    expect(extractLegalDocumentTitle(text)).toBe('Política legible');
    expect(prepareLegalMarkdownForDisplay(text)).toBe('Estado: borrador\n\n## Responsable');
  });

  it('forces legal routes and documents to bypass HTTP caches', () => {
    for (const pathname of ['/proteccion-datos', '/legal/privacy.md', '/legal/operator.local/privacy-policy.local.md']) {
      expect(getStaticCacheHeaders(pathname)).toMatchObject({
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      });
    }
    expect(getStaticCacheHeaders('/assets/logo-abc123.svg')).toEqual({
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    expect(getStaticCacheHeaders('/audio/sounds/Pregunta.mp3')).toEqual({
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000',
    });
    expect(getStaticCacheHeaders('/audience')).toEqual({});
  });
});
