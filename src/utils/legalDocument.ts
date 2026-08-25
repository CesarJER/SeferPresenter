export const DEFAULT_PRIVACY_POLICY_PATH = '/legal/privacy.md';
export const DEFAULT_PRIVACY_SUMMARY_PATH = '/legal/privacy-summary.md';

export const configuredPrivacyPolicyPath = DEFAULT_PRIVACY_POLICY_PATH;
export const configuredPrivacySummaryPath = DEFAULT_PRIVACY_SUMMARY_PATH;

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
