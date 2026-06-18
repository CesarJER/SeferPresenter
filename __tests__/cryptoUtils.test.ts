import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decrypt,
  decryptWithNonceReplayProtection,
  deriveSharedKey,
  encrypt,
  exportPublicKey,
  generateEphemeralKeyPair,
  generateSessionKeyPair,
  importPublicKey,
  NonceReuseError,
} from '../src/utils/cryptoUtils';

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    vi.stubGlobal('crypto', webcrypto as unknown as Crypto);
  }

  if (typeof globalThis.btoa !== 'function') {
    vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'));
  }

  if (typeof globalThis.atob !== 'function') {
    vi.stubGlobal('atob', (value: string) => Buffer.from(value, 'base64').toString('binary'));
  }
});

const deriveControlAudienceKeys = async () => {
  const controlKeyPair = await generateSessionKeyPair();
  const audienceKeyPair = await generateEphemeralKeyPair();
  const controlPublicKey = await importPublicKey(await exportPublicKey(controlKeyPair));
  const audiencePublicKey = await importPublicKey(await exportPublicKey(audienceKeyPair));

  return {
    controlSharedKey: await deriveSharedKey(controlKeyPair.privateKey, audiencePublicKey),
    audienceSharedKey: await deriveSharedKey(audienceKeyPair.privateKey, controlPublicKey),
  };
};

describe('cryptoUtils', () => {
  it('lets Audience encrypt and Control decrypt with ECDH P-256 and AES-GCM', async () => {
    const { controlSharedKey, audienceSharedKey } = await deriveControlAudienceKeys();

    const encrypted = await encrypt(audienceSharedKey, 'hello');
    const decrypted = await decrypt(controlSharedKey, encrypted.ciphertext, encrypted.nonce);

    expect(decrypted).toBe('hello');
  });

  it('generates distinct 12-byte nonces for separate messages', async () => {
    const { audienceSharedKey } = await deriveControlAudienceKeys();

    const first = await encrypt(audienceSharedKey, 'first');
    const second = await encrypt(audienceSharedKey, 'second');

    expect(first.nonce).not.toBe(second.nonce);
    expect(base64ToBytes(first.nonce)).toHaveLength(12);
    expect(base64ToBytes(second.nonce)).toHaveLength(12);
  });

  it('rejects nonce replay before returning plaintext', async () => {
    const { controlSharedKey, audienceSharedKey } = await deriveControlAudienceKeys();
    const seenNonces = new Set<string>();
    const encrypted = await encrypt(audienceSharedKey, 'single-use');

    await expect(
      decryptWithNonceReplayProtection(controlSharedKey, encrypted.ciphertext, encrypted.nonce, seenNonces),
    ).resolves.toBe('single-use');

    await expect(
      decryptWithNonceReplayProtection(controlSharedKey, encrypted.ciphertext, encrypted.nonce, seenNonces),
    ).rejects.toBeInstanceOf(NonceReuseError);
  });

  it('throws when decrypting with the wrong shared key', async () => {
    const { audienceSharedKey } = await deriveControlAudienceKeys();
    const { controlSharedKey: wrongControlSharedKey } = await deriveControlAudienceKeys();
    const encrypted = await encrypt(audienceSharedKey, 'private');

    await expect(decrypt(wrongControlSharedKey, encrypted.ciphertext, encrypted.nonce)).rejects.toThrow();
  });

  it('throws when AES-GCM ciphertext authenticity is altered', async () => {
    const { controlSharedKey, audienceSharedKey } = await deriveControlAudienceKeys();
    const encrypted = await encrypt(audienceSharedKey, 'authentic');
    const alteredCiphertext = base64ToBytes(encrypted.ciphertext);
    alteredCiphertext[0] ^= 1;

    await expect(
      decrypt(controlSharedKey, bytesToBase64(alteredCiphertext), encrypted.nonce),
    ).rejects.toThrow();
  });
});
