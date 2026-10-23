import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inferOperationalRole,
  inferMicrophoneTrackState,
  makeOperationalParticipantSnapshot,
  makeReducedParticipantStatus,
} from '../server/ws-participant-snapshots.mjs';

const operationalFields = ['participantId', 'role', 'operationalRole', 'microphonePermissionState', 'microphoneTrackState', 'liveAudioConnectionState', 'speakerState', 'canSubscribe', 'canPublishAudio', 'isMuted', 'isActiveAudience', 'isMicrophoneActive', 'isKicked', 'isAliasVisibleToActiveParticipants', 'canViewActiveParticipants', 'isAliasHiddenByControl', 'activeListPublicKey', 'connected', 'connectedAt', 'disconnectedAt', 'updatedAt'];
const reducedFields = ['type', 'participantId', 'role', 'speakerState', 'canSubscribe', 'canPublishAudio', 'isMuted', 'isActiveAudience', 'isMicrophoneActive', 'isKicked', 'isAliasVisibleToActiveParticipants', 'canViewActiveParticipants', 'isAliasHiddenByControl', 'activeListPublicKey', 'microphonePermissionState', 'microphoneTrackState', 'liveAudioConnectionState', 'updatedAt'];
const participant = () => ({
  participantId: '12345678-1234-4234-8234-123456789abc', role: 'audience',
  speakerState: 'REQUESTED', canSubscribe: true, canPublishAudio: false,
  isMuted: true, isActiveAudience: true, isMicrophoneActive: false, isKicked: false,
  isAliasVisibleToActiveParticipants: true, canViewActiveParticipants: false, isAliasHiddenByControl: true,
  activeListPublicKey: 'synthetic-public-key', microphonePermissionState: 'denied',
  microphoneTrackState: 'mutedByUser', liveAudioConnectionState: 'reconnecting',
  ws: { readyState: WebSocket.OPEN }, connectedAt: 100, disconnectedAt: 200, updatedAt: 300,
});

afterEach(() => vi.restoreAllMocks());

describe('operational role precedence', () => {
  it.each([
    [{}, 'activo'], [{ role: 'unexpected' }, 'activo'], [{ role: null }, 'activo'],
    [{ role: 'control', isKicked: true, isActiveAudience: false, speakerState: 'REVOKED' }, 'control'],
    [{ role: 'presenter', isKicked: true, speakerState: 'REQUESTED' }, 'presenter'],
    [{ role: 'Control' }, 'activo'], [{ isKicked: true, speakerState: 'GRANTED' }, 'pasivo'],
    [{ isKicked: 'legacy' }, 'pasivo'], [{ speakerState: 'REVOKED', isMicrophoneActive: true }, 'pasivo'],
    [{ isActiveAudience: false, speakerState: 'REQUESTED' }, 'pasivo'],
    [{ isActiveAudience: 0 }, 'activo'], [{ isActiveAudience: null }, 'activo'],
    [{ speakerState: 'REQUESTED', isMicrophoneActive: true }, 'cola'],
    [{ speakerState: 'GRANTED', isMuted: true }, 'orador'], [{ isMicrophoneActive: true }, 'orador'],
    [{ isMicrophoneActive: 'legacy' }, 'orador'], [{ speakerState: 'MUTED' }, 'activo'],
    [{ speakerState: 'unexpected', canPublishAudio: true }, 'activo'],
  ])('maps %j to %s', (input, expected) => expect(inferOperationalRole(input)).toBe(expected));
});

describe('microphone track precedence', () => {
  it.each([
    [{}, 'notRequested'], [{ microphonePermissionState: 'granted' }, 'notRequested'],
    [{ microphonePermissionState: 'denied', isMicrophoneActive: true }, 'published'],
    [{ microphoneTrackState: 'mutedByUser', isKicked: true }, 'mutedByUser'],
    [{ microphoneTrackState: 'published', speakerState: 'REVOKED' }, 'published'],
    [{ microphoneTrackState: 'unexpected', isMicrophoneActive: true }, 'unexpected'],
    [{ microphoneTrackState: true }, true], [{ microphoneTrackState: '', canPublishAudio: true }, 'off'],
    [{ microphoneTrackState: null }, 'notRequested'], [{ microphoneTrackState: false }, 'notRequested'],
    [{ isKicked: true, isMicrophoneActive: true }, 'off'], [{ speakerState: 'REVOKED', canPublishAudio: true }, 'off'],
    [{ isMicrophoneActive: true, speakerState: 'GRANTED', isMuted: true }, 'published'],
    [{ speakerState: 'GRANTED', isMuted: true, canPublishAudio: false }, 'mutedByControl'],
    [{ speakerState: 'GRANTED', isMuted: false }, 'notRequested'],
    [{ speakerState: 'MUTED', canPublishAudio: true }, 'off'], [{ canPublishAudio: 'legacy' }, 'off'],
  ])('maps %j to %s', (input, expected) => expect(inferMicrophoneTrackState(input)).toBe(expected));
  it.each(['notRequested', 'off', 'publishing', 'published', 'mutedByUser', 'mutedByControl', 'error'])('preserves explicit %s', microphoneTrackState => {
    expect(inferMicrophoneTrackState({ microphoneTrackState, isKicked: true })).toBe(microphoneTrackState);
  });
});

describe('participant projections', () => {
  it('selects the exact operational view without generating a timestamp', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(999);
    expect(makeOperationalParticipantSnapshot(participant())).toStrictEqual({
      participantId: '12345678-1234-4234-8234-123456789abc', role: 'audience', operationalRole: 'cola',
      microphonePermissionState: 'denied', microphoneTrackState: 'mutedByUser', liveAudioConnectionState: 'reconnecting',
      speakerState: 'REQUESTED', canSubscribe: true, canPublishAudio: false, isMuted: true,
      isActiveAudience: true, isMicrophoneActive: false, isKicked: false,
      isAliasVisibleToActiveParticipants: true, canViewActiveParticipants: false, isAliasHiddenByControl: true,
      activeListPublicKey: 'synthetic-public-key', connected: true, connectedAt: 100, disconnectedAt: 200, updatedAt: 300,
    });
    expect(now).not.toHaveBeenCalled();
  });
  it('selects the exact reduced view, overriding an input type without deriving connection or role', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(999);
    expect(makeReducedParticipantStatus({ ...participant(), type: 'OTHER' })).toStrictEqual({
      type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: '12345678-1234-4234-8234-123456789abc', role: 'audience',
      speakerState: 'REQUESTED', canSubscribe: true, canPublishAudio: false, isMuted: true,
      isActiveAudience: true, isMicrophoneActive: false, isKicked: false,
      isAliasVisibleToActiveParticipants: true, canViewActiveParticipants: false, isAliasHiddenByControl: true,
      activeListPublicKey: 'synthetic-public-key', microphonePermissionState: 'denied', microphoneTrackState: 'mutedByUser',
      liveAudioConnectionState: 'reconnecting', updatedAt: 300,
    });
    expect(now).not.toHaveBeenCalled();
  });
  it('preserves missing properties in memory and their omission in JSON for both distinct views', () => {
    vi.spyOn(Date, 'now').mockReturnValue(999);
    const operational = makeOperationalParticipantSnapshot({});
    const reduced = makeReducedParticipantStatus({});
    expect(Object.keys(operational).sort()).toEqual([...operationalFields].sort());
    expect(Object.keys(reduced).sort()).toEqual([...reducedFields].sort());
    expect(operational).toHaveProperty('updatedAt', undefined);
    expect(reduced).toHaveProperty('microphoneTrackState', undefined);
    expect(JSON.parse(JSON.stringify(operational))).toStrictEqual({ operationalRole: 'activo', microphonePermissionState: 'unknown', microphoneTrackState: 'notRequested', isAliasVisibleToActiveParticipants: false, canViewActiveParticipants: false, isAliasHiddenByControl: false, connected: false });
    expect(JSON.parse(JSON.stringify(reduced))).toStrictEqual({ type: 'LIVE_AUDIO_PARTICIPANT_STATUS', isAliasVisibleToActiveParticipants: false, canViewActiveParticipants: false, isAliasHiddenByControl: false, updatedAt: 999 });
  });
  it.each([undefined, null, false, 0, '', 'legacy'])('keeps nullish defaults distinct from coercion for %j', value => {
    const input = { isAliasVisibleToActiveParticipants: value, canViewActiveParticipants: value, isAliasHiddenByControl: value, microphonePermissionState: value };
    for (const serialize of [makeOperationalParticipantSnapshot, makeReducedParticipantStatus]) {
      const result = serialize(input);
      expect(result.isAliasVisibleToActiveParticipants).toBe(value ?? false);
      expect(result.canViewActiveParticipants).toBe(value ?? false);
      expect(result.isAliasHiddenByControl).toBe(value ?? false);
    }
    expect(makeOperationalParticipantSnapshot(input).microphonePermissionState).toBe(value || 'unknown');
    expect(makeReducedParticipantStatus(input).microphonePermissionState).toBe(value);
  });
  it.each([undefined, null, 0, false, '', NaN])('generates reduced updatedAt exactly once for falsy %j', updatedAt => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(999);
    expect(makeReducedParticipantStatus({ updatedAt }).updatedAt).toBe(999);
    expect(now).toHaveBeenCalledTimes(1);
    expect(makeOperationalParticipantSnapshot({ updatedAt }).updatedAt).toBe(updatedAt);
    expect(now).toHaveBeenCalledTimes(1);
  });
  it.each([1, -1, 0.5, Infinity, 'legacy'])('preserves truthy reduced updatedAt %j without consulting the clock', updatedAt => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(999);
    expect(makeReducedParticipantStatus({ updatedAt }).updatedAt).toBe(updatedAt);
    expect(now).not.toHaveBeenCalled();
  });
  it('evaluates the current clock independently on successive reduced serializations', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(101);
    expect(makeReducedParticipantStatus({}).updatedAt).toBe(100);
    expect(makeReducedParticipantStatus({}).updatedAt).toBe(101);
    expect(now).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, null, {}, { readyState: WebSocket.CONNECTING }, { readyState: WebSocket.CLOSING }, { readyState: WebSocket.CLOSED }, { readyState: String(WebSocket.OPEN) }])('is disconnected for socket %j', ws => {
    expect(makeOperationalParticipantSnapshot({ ws }).connected).toBe(false);
  });
  it('requires strict WebSocket.OPEN independently of reported connection and disconnect time', () => {
    expect(makeOperationalParticipantSnapshot({ ws: { readyState: WebSocket.OPEN }, liveAudioConnectionState: 'disconnected', disconnectedAt: 123 }).connected).toBe(true);
    expect(makeOperationalParticipantSnapshot({ ws: { readyState: WebSocket.CLOSED }, liveAudioConnectionState: 'connected' }).connected).toBe(false);
  });
  it('preserves null technical values and timestamps rather than silently normalizing them', () => {
    const input = Object.fromEntries([...operationalFields, ...reducedFields].map(field => [field, null]));
    vi.spyOn(Date, 'now').mockReturnValue(999);
    const operational = makeOperationalParticipantSnapshot(input);
    const reduced = makeReducedParticipantStatus(input);
    for (const field of ['participantId', 'role', 'speakerState', 'canSubscribe', 'canPublishAudio', 'isMuted', 'isActiveAudience', 'isMicrophoneActive', 'isKicked', 'activeListPublicKey', 'liveAudioConnectionState']) {
      expect(operational[field]).toBeNull();
      expect(reduced[field]).toBeNull();
    }
    expect(operational.connectedAt).toBeNull();
    expect(operational.disconnectedAt).toBeNull();
    expect(operational.updatedAt).toBeNull();
    expect(reduced.updatedAt).toBe(999);
    expect(operational.microphoneTrackState).toBe('notRequested');
    expect(reduced.microphoneTrackState).toBeNull();
  });
  it.each([null, undefined])('retains the existing missing-record error for %s', value => {
    for (const serialize of [inferOperationalRole, inferMicrophoneTrackState, makeOperationalParticipantSnapshot, makeReducedParticipantStatus]) expect(() => serialize(value)).toThrow(TypeError);
  });
});

describe('privacy allowlists and absence of mutation', () => {
  it.each([
    ['operational', makeOperationalParticipantSnapshot, operationalFields],
    ['reduced', makeReducedParticipantStatus, reducedFields],
  ] as const)('projects only the %s allowlist and leaves the record and nested internals intact', (_name, serialize, fields) => {
    const input = {
      ...participant(), operatorCredential: 'private-operator', credentialHash: 'private-hash',
      cleanupTimer: { internalHandle: 42 }, privateSignalTimestamps: [10, 20],
      controlState: 'PRINCIPAL', authorization: { secret: 'internal-auth' },
      controlSessionId: 'private-control-session', presentationSessionId: 'private-session',
      audienceAccessId: 'private-access', alias: 'private-alias', ciphertext: 'private-ciphertext',
      privateKey: 'private-key', extra: { nested: ['unexpected'] },
    };
    const before = structuredClone(input);
    const result = serialize(input);
    expect(Object.keys(result).sort()).toEqual([...fields].sort());
    expect(Object.keys(JSON.parse(JSON.stringify(result))).sort()).toEqual([...fields].sort());
    for (const field of ['ws', 'operatorCredential', 'credentialHash', 'cleanupTimer', 'privateSignalTimestamps', 'controlState', 'authorization', 'controlSessionId', 'presentationSessionId', 'audienceAccessId', 'alias', 'ciphertext', 'privateKey', 'extra']) expect(result).not.toHaveProperty(field);
    expect(input).toStrictEqual(before);
    expect(serialize(input)).not.toBe(result);
    inferOperationalRole(input); inferMicrophoneTrackState(input);
    expect(input).toStrictEqual(before);
    expect(input.privateSignalTimestamps).toEqual([10, 20]);
    expect(input.ws.readyState).toBe(WebSocket.OPEN);
  });
});
