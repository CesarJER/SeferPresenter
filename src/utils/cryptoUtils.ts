export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
}

export class NonceReuseError extends Error {
  constructor(nonce: string) {
    super(`AES-GCM nonce reuse rejected: ${nonce}`);
    this.name = 'NonceReuseError';
  }
}

const ECDH_ALGORITHM: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };
const AES_ALGORITHM: AesKeyGenParams = { name: 'AES-GCM', length: 256 };
const AES_GCM_NONCE_BYTES = 12;

const getCrypto = (): Crypto => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is not available.');
  }
  return globalThis.crypto;
};

const encodeUtf8 = (value: string): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(value);
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  bytes.set(encoded);
  return bytes;
};
const decodeUtf8 = (value: ArrayBuffer): string => new TextDecoder().decode(value);

export const bytesToBase64 = (bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < view.length; index += chunkSize) {
    const chunk = view.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

export const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

export const generateSessionKeyPair = async (): Promise<CryptoKeyPair> =>
  getCrypto().subtle.generateKey(ECDH_ALGORITHM, true, ['deriveKey']) as Promise<CryptoKeyPair>;

export const generateEphemeralKeyPair = generateSessionKeyPair;

export const exportPublicKey = async (keyPair: CryptoKeyPair): Promise<string> => {
  const rawKey = await getCrypto().subtle.exportKey('raw', keyPair.publicKey);
  return bytesToBase64(rawKey);
};

export const importPublicKey = async (base64: string): Promise<CryptoKey> =>
  getCrypto().subtle.importKey('raw', base64ToBytes(base64), ECDH_ALGORITHM, true, []);

export const exportPrivateKey = async (privateKey: CryptoKey): Promise<string> => {
  const pkcs8 = await getCrypto().subtle.exportKey('pkcs8', privateKey);
  return bytesToBase64(pkcs8);
};

export const importPrivateKey = async (base64: string): Promise<CryptoKey> =>
  getCrypto().subtle.importKey('pkcs8', base64ToBytes(base64), ECDH_ALGORITHM, true, ['deriveKey']);

export const deriveSharedKey = async (
  myPrivate: CryptoKey,
  theirPublic: CryptoKey,
): Promise<CryptoKey> =>
  getCrypto().subtle.deriveKey(
    { name: 'ECDH', public: theirPublic },
    myPrivate,
    AES_ALGORITHM,
    false,
    ['encrypt', 'decrypt'],
  );

export const encrypt = async (sharedKey: CryptoKey, plaintext: string): Promise<EncryptedPayload> => {
  const nonce = new Uint8Array(new ArrayBuffer(AES_GCM_NONCE_BYTES));
  getCrypto().getRandomValues(nonce);

  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    sharedKey,
    encodeUtf8(plaintext),
  );

  return {
    ciphertext: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
  };
};

export const decrypt = async (
  sharedKey: CryptoKey,
  ciphertext: string,
  nonce: string,
): Promise<string> => {
  const plaintext = await getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(nonce) },
    sharedKey,
    base64ToBytes(ciphertext),
  );

  return decodeUtf8(plaintext);
};

export const decryptWithNonceReplayProtection = async (
  sharedKey: CryptoKey,
  ciphertext: string,
  nonce: string,
  usedNonces: Set<string>,
): Promise<string> => {
  if (usedNonces.has(nonce)) {
    throw new NonceReuseError(nonce);
  }

  const plaintext = await decrypt(sharedKey, ciphertext, nonce);
  usedNonces.add(nonce);
  return plaintext;
};
