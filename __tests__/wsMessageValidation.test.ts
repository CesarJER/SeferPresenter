import { describe, expect, it } from 'vitest';
import {
  isValidParticipantId,
  isValidBase64,
  getBase64ByteLength,
  validatePrivateControlSignal,
  validateParticipantStatus,
  validateActiveParticipantProfile,
  validateModerationMessage,
} from '../server/ws-message-validation.mjs';

const id = '12345678-1234-4234-8234-123456789abc';
const otherId = '12345678-1234-4234-9234-123456789abc';
const base64 = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');
const privateSignal = () => ({ type: 'PRIVATE_CONTROL_SIGNAL', fromParticipantId: id, keyId: 'key', ephemeralPublicKey: base64(1), ciphertext: base64(1), nonce: base64(12) });
const status = () => ({ type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: id, role: 'audience', speakerState: 'LISTENER', canSubscribe: true, canPublishAudio: false });
const profile = () => ({ type: 'LIVE_AUDIO_ACTIVE_PARTICIPANT_PROFILE', participantId: id, activeListPublicKey: base64(1), isAliasVisibleToActiveParticipants: false });
const moderation = () => ({ type: 'LIVE_AUDIO_GRANT_SPEAK', participantId: id });
const nonRecords = [undefined, null, false, 1, 'message', []];

describe('participant identifiers and Base64', () => {
  it.each([id, id.toUpperCase(), otherId, id.replace('-8234-', '-a234-'), id.replace('-8234-', '-b234-')])('accepts UUID v4 %s', value => {
    expect(isValidParticipantId(value)).toBe(true);
  });
  it.each([undefined, null, 123, '', ` ${id}`, `${id} `, id.replace('-4234-', '-1234-'), id.replace('-8234-', '-7234-'), id.replace(/-/g, '')])('rejects invalid UUID %s', value => {
    expect(isValidParticipantId(value)).toBe(false);
  });
  it.each(['AQ==', 'AQE=', 'AQEB', '+/8=', 'AB=='])('accepts syntactic Base64 %s without demanding canonical encoding', value => {
    expect(isValidBase64(value)).toBe(true);
  });
  it.each([undefined, null, 1, '', 'A', 'AAA', '====', 'AQ===', 'AQ==\n', ' AQ==', '-_8='])('rejects malformed Base64 %s', value => {
    expect(isValidBase64(value)).toBe(false);
  });
  it.each([0, 1, 2, 3, 11, 12, 13, 4095, 4096, 4097])('counts %i decoded bytes', bytes => {
    expect(getBase64ByteLength(base64(bytes))).toBe(bytes);
  });
  it('keeps the byte-count helper separate from input validation', () => {
    expect(getBase64ByteLength('A')).toBe(0);
    expect(() => getBase64ByteLength(null)).toThrow();
  });
});

describe('private encrypted envelope format', () => {
  it('accepts Audience by default and leaves the envelope unchanged', () => {
    const message = Object.freeze({ ...privateSignal(), extra: 'allowed', createdAt: -0.5 });
    expect(validatePrivateControlSignal(message)).toBe(true);
    expect(validatePrivateControlSignal(message, undefined)).toBe(true);
  });
  it('accepts a Control session string, a participant target and an empty optional Control target', () => {
    expect(validatePrivateControlSignal({ ...privateSignal(), fromParticipantId: 'control-session', toParticipantId: otherId, toControlSessionId: '' }, 'control')).toBe(true);
  });
  it.each(['presenter', 'unknown', '', null])('does not authorize or reject the role parameter %s itself', role => {
    expect(validatePrivateControlSignal({ ...privateSignal(), toParticipantId: otherId }, role)).toBe(true);
    expect(validatePrivateControlSignal({ ...privateSignal(), fromParticipantId: 'control-session' }, role)).toBe(false);
  });
  it.each(nonRecords)('rejects non-record %s', value => expect(validatePrivateControlSignal(value)).toBe(false));
  it.each(['type', 'fromParticipantId', 'keyId', 'ephemeralPublicKey', 'ciphertext', 'nonce'])('rejects a missing %s', field => {
    const message: Record<string, unknown> = privateSignal();
    delete message[field];
    expect(validatePrivateControlSignal(message)).toBe(false);
  });
  it.each([
    { type: 'OTHER' }, { fromParticipantId: 'not-a-uuid' }, { fromParticipantId: 1 },
    { keyId: '' }, { keyId: '  ' }, { keyId: 1 }, { ephemeralPublicKey: '' },
    { ephemeralPublicKey: 'bad!' }, { ephemeralPublicKey: 1 }, { ciphertext: '' },
    { ciphertext: 'bad!' }, { ciphertext: 1 }, { nonce: 'bad!' }, { nonce: 1 },
    { toControlSessionId: null }, { toControlSessionId: 1 }, { toParticipantId: otherId },
    { toParticipantId: null }, { toParticipantId: 'invalid' }, { createdAt: null },
    { createdAt: '1' }, { createdAt: NaN }, { createdAt: Infinity },
  ])('rejects invalid Audience fields %j', patch => expect(validatePrivateControlSignal({ ...privateSignal(), ...patch })).toBe(false));
  it.each([4095, 4096, 4097])('enforces the ciphertext boundary at %i bytes for each sender', bytes => {
    for (const role of ['audience', 'control']) expect(validatePrivateControlSignal({ ...privateSignal(), ciphertext: base64(bytes) }, role)).toBe(bytes <= 4096);
  });
  it.each([11, 12, 13])('requires exactly 12 nonce bytes, given %i', bytes => {
    expect(validatePrivateControlSignal({ ...privateSignal(), nonce: base64(bytes) })).toBe(bytes === 12);
  });
  it.each([{ fromParticipantId: '' }, { fromParticipantId: ' ' }, { fromParticipantId: 1 }, { toParticipantId: '' }, { toParticipantId: 1 }, { toParticipantId: null }])('rejects malformed Control identity/target %j', patch => {
    expect(validatePrivateControlSignal({ ...privateSignal(), ...patch }, 'control')).toBe(false);
  });
});

describe('participant status format', () => {
  it('allows optional fields and unknown metadata without changing input', () => {
    expect(validateParticipantStatus(Object.freeze({ ...status(), isMuted: false, isActiveAudience: true, isMicrophoneActive: false, isKicked: false, updatedAt: -0.5, alias: undefined, extra: 'allowed' }), 'audience')).toBe(true);
  });
  it('compares expectedRole literally instead of validating the role vocabulary', () => {
    expect(validateParticipantStatus(status(), 'control')).toBe(false);
    expect(validateParticipantStatus(status())).toBe(false);
    expect(validateParticipantStatus({ ...status(), role: 'custom' }, 'custom')).toBe(true);
    expect(validateParticipantStatus({ ...status(), role: undefined })).toBe(true);
  });
  it.each(nonRecords)('rejects non-record %s', value => expect(validateParticipantStatus(value, 'audience')).toBe(false));
  it.each(['type', 'participantId', 'role', 'speakerState', 'canSubscribe', 'canPublishAudio'])('rejects a missing %s with the actual Audience caller', field => {
    const message: Record<string, unknown> = status();
    delete message[field];
    expect(validateParticipantStatus(message, 'audience')).toBe(false);
  });
  it.each([
    ['speakerState', ['LISTENER', 'REQUESTED', 'GRANTED', 'MUTED', 'REVOKED']],
    ['microphonePermissionState', ['unknown', 'prompt', 'denied', 'granted', 'unavailable']],
    ['microphoneTrackState', ['notRequested', 'off', 'publishing', 'published', 'mutedByUser', 'mutedByControl', 'error']],
    ['liveAudioConnectionState', ['connected', 'connecting', 'reconnecting', 'reconnected', 'reconnectFailed', 'disconnected', 'permissionDenied', 'unavailable']],
  ] as const)('accepts exactly the current %s vocabulary', (field, values) => {
    for (const value of values) expect(validateParticipantStatus({ ...status(), [field]: value }, 'audience')).toBe(true);
    for (const value of ['INVALID', '', null, 1, true]) expect(validateParticipantStatus({ ...status(), [field]: value }, 'audience')).toBe(false);
  });
  it.each(['canSubscribe', 'canPublishAudio', 'isMuted', 'isActiveAudience', 'isMicrophoneActive', 'isKicked'])('does not coerce the boolean %s', field => {
    for (const value of [false, true]) expect(validateParticipantStatus({ ...status(), [field]: value }, 'audience')).toBe(true);
    for (const value of [null, 0, 1, 'true']) expect(validateParticipantStatus({ ...status(), [field]: value }, 'audience')).toBe(false);
  });
  it.each([{ type: 'OTHER' }, { participantId: 'invalid' }, { alias: '' }, { alias: null }, { alias: 'plaintext' }, { updatedAt: null }, { updatedAt: '1' }, { updatedAt: NaN }, { updatedAt: Infinity }])('rejects status patch %j', patch => {
    expect(validateParticipantStatus({ ...status(), ...patch }, 'audience')).toBe(false);
  });
});

describe('active participant profile format', () => {
  it('allows both visibility choices, a syntactic short key and unknown metadata', () => {
    for (const visible of [true, false]) expect(validateActiveParticipantProfile(Object.freeze({ ...profile(), isAliasVisibleToActiveParticipants: visible, alias: undefined, createdAt: -0.5, extra: 'allowed' }))).toBe(true);
  });
  it.each(nonRecords)('rejects non-record %s', value => expect(validateActiveParticipantProfile(value)).toBe(false));
  it.each(['type', 'participantId', 'activeListPublicKey', 'isAliasVisibleToActiveParticipants'])('rejects a missing %s', field => {
    const message: Record<string, unknown> = profile();
    delete message[field];
    expect(validateActiveParticipantProfile(message)).toBe(false);
  });
  it.each([{ type: 'OTHER' }, { participantId: '' }, { participantId: 1 }, { activeListPublicKey: '' }, { activeListPublicKey: 'bad!' }, { activeListPublicKey: 1 }, { alias: '' }, { alias: null }, { alias: 'plaintext' }, { isAliasVisibleToActiveParticipants: 1 }, { isAliasVisibleToActiveParticipants: null }, { createdAt: '1' }, { createdAt: null }, { createdAt: NaN }, { createdAt: Infinity }])('rejects profile patch %j', patch => {
    expect(validateActiveParticipantProfile({ ...profile(), ...patch })).toBe(false);
  });
});

describe('moderation message format', () => {
  it.each(['LIVE_AUDIO_GRANT_SPEAK', 'LIVE_AUDIO_REVOKE_SPEAK', 'LIVE_AUDIO_MUTE_PARTICIPANT', 'LIVE_AUDIO_KICK_PARTICIPANT', 'LIVE_AUDIO_RESCUE_PARTICIPANT'])('requires a UUID target for %s', type => {
    expect(validateModerationMessage({ type, participantId: id })).toBe(true);
    expect(validateModerationMessage({ type })).toBe(false);
    expect(validateModerationMessage({ type, participantId: 'invalid' })).toBe(false);
    expect(validateModerationMessage({ type, participantId: id, excludeParticipantIds: [] })).toBe(false);
  });
  it('allows MUTE_ALL without a target, with any ignored target and with empty or valid exclusions', () => {
    for (const participantId of [undefined, null, 'invalid', 1]) expect(validateModerationMessage({ type: 'LIVE_AUDIO_MUTE_ALL', participantId })).toBe(true);
    for (const excludeParticipantIds of [[], [id, otherId, id]]) expect(validateModerationMessage({ type: 'LIVE_AUDIO_MUTE_ALL', excludeParticipantIds })).toBe(true);
  });
  it('preserves the current sparse exclusion-array behavior', () => {
    expect(validateModerationMessage({ type: 'LIVE_AUDIO_MUTE_ALL', excludeParticipantIds: new Array(1) })).toBe(true);
    expect(validateModerationMessage({ type: 'LIVE_AUDIO_MUTE_ALL', excludeParticipantIds: [null] })).toBe(false);
  });
  it('permits optional issuer and finite timestamp without treating them as authority', () => {
    expect(validateModerationMessage(Object.freeze({ ...moderation(), issuedByParticipantId: otherId, createdAt: -0.5, extra: 'allowed' }))).toBe(true);
  });
  it.each(nonRecords)('rejects non-record %s', value => expect(validateModerationMessage(value)).toBe(false));
  it.each([{ type: 'OTHER' }, { type: undefined }, { issuedByParticipantId: '' }, { issuedByParticipantId: null }, { issuedByParticipantId: 1 }, { createdAt: null }, { createdAt: '1' }, { createdAt: NaN }, { createdAt: Infinity }])('rejects moderation patch %j', patch => {
    expect(validateModerationMessage({ ...moderation(), ...patch })).toBe(false);
  });
  it.each([null, 'invalid', [null], ['invalid'], [1]])('rejects invalid MUTE_ALL exclusions %j', excludeParticipantIds => {
    expect(validateModerationMessage({ type: 'LIVE_AUDIO_MUTE_ALL', excludeParticipantIds })).toBe(false);
  });
});
