export const DEFAULT_PRIVACY_POLICY_PATH = '/legal/privacy.md';
export const DEFAULT_PRIVACY_SUMMARY_PATH = '/legal/privacy-summary.md';

export const normalizeLegalMarkdownPath = (
  configuredPath: string | undefined,
  fallbackPath: string = DEFAULT_PRIVACY_POLICY_PATH,
): string => {
  const candidate = configuredPath?.trim() || fallbackPath;
  try {
    const decoded = decodeURIComponent(candidate);
    if (!decoded.startsWith('/legal/')) return fallbackPath;
    if (decoded.includes('..') || decoded.includes('\\')) return fallbackPath;
    if (!/\.md$/i.test(decoded)) return fallbackPath;
    return decoded;
  } catch {
    return fallbackPath;
  }
};

export const normalizePrivacyPolicyPath = (configuredPath: string | undefined): string =>
  normalizeLegalMarkdownPath(configuredPath, DEFAULT_PRIVACY_POLICY_PATH);

export const configuredPrivacyPolicyPath = normalizePrivacyPolicyPath(
  import.meta.env.VITE_PRIVACY_POLICY_PATH,
);

export const configuredPrivacySummaryPath = normalizeLegalMarkdownPath(
  import.meta.env.VITE_PRIVACY_SUMMARY_PATH,
  DEFAULT_PRIVACY_SUMMARY_PATH,
);

export const extractLegalDocumentTitle = (text: string): string => {
  const match = text.match(/^#\s+(.+?)\s*$/m);
  return match?.[1]?.trim() || 'Información de privacidad';
};

export const prepareLegalMarkdownForDisplay = (text: string): string => text
  .replace(/^#\s+.+?\s*\r?\n+/, '')
  .replace(/^Versi[oó]n:\s*.+?\s*\r?\n+/im, '')
  .trim();

export const extractLegalDocumentVersion = (text: string): string => {
  const match = text.match(/^Versi[oó]n:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() || 'sin versión declarada';
};

export const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};
