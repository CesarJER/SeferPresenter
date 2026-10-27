import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveKitApi, resetLiveKitStateForTests } from '../server/livekit-server.mjs';
import { isProtectedRequestPath } from '../server/authUtils.mjs';

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

const basicAuth = (password = 'test-password') =>
  `Basic ${Buffer.from(`control:${password}`).toString('base64')}`;

const decodeJwtPayload = (token: string) => {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
};

describe('LiveKit token endpoint security', () => {
  let api: ReturnType<typeof createLiveKitApi>;
  const authorizedControls = new Set(['authorized-control']);

  beforeEach(() => {
    resetLiveKitStateForTests();
    authorizedControls.clear();
    authorizedControls.add('authorized-control');
    process.env.SEFER_LIVE_AUDIO_ENABLED = 'true';
    process.env.LIVEKIT_URL = 'wss://livekit.example.test';
    process.env.LIVEKIT_API_KEY = 'test-api-key';
    process.env.LIVEKIT_API_SECRET = 'test-api-secret-with-enough-entropy';
    process.env.SEFER_CONTROL_PASSWORD = 'test-password';
    process.env.SEFER_LIVE_AUDIO_TOKEN_TTL_MINUTES = '1';
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }),
      isLiveAudioControlAuthorized: (controlSessionId: string) => authorizedControls.has(controlSessionId),
      getLiveAudioParticipantState: () => null,
    });
  });

  afterEach(() => {
    api.close();
    resetLiveKitStateForTests();
    vi.useRealTimers();
    delete process.env.SEFER_LIVE_AUDIO_ENABLED;
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.SEFER_CONTROL_PASSWORD;
    delete process.env.SEFER_LIVE_AUDIO_TOKEN_TTL_MINUTES;
  });

  const call = async (
    pathname: string,
    body: Record<string, unknown>,
    authorization = pathname.endsWith('/token') || pathname.endsWith('/refresh-token') || pathname.endsWith('/status') ? '' : basicAuth(),
  ): Promise<ApiResponse> => {
    let response: ApiResponse | null = null;
    const handled = await api.handle({
      req: { method: pathname.endsWith('/status') ? 'GET' : 'POST', headers: authorization ? { authorization } : {} },
      res: {},
      url: new URL(pathname, 'http://localhost'),
      readBody: async () => JSON.stringify(body),
      sendJson: (_res: unknown, status: number, value: Record<string, unknown>) => {
        response = { status, body: value };
      },
    });
    expect(handled).toBe(true);
    if (!response) throw new Error('LiveKit API did not return a response');
    return response;
  };

  const issueAudience = async () => {
    const response = await call('/api/livekit/token', { role: 'audience' });
    expect(response.status).toBe(200);
    return response.body as unknown as {
      token: string;
      participantId: string;
      participantIdentity: string;
      refreshCredential: string;
      expiresAt: number;
    };
  };

  it('keeps the public endpoint audience-only and does not trust unknown or privileged roles', async () => {
    const unknown = await call('/api/livekit/token', { role: 'host' });
    expect(unknown.status).toBe(200);
    const unknownPayload = decodeJwtPayload(String(unknown.body.token));
    expect(String(unknownPayload.sub)).toMatch(/^audience-/);
    expect(unknownPayload.video).toMatchObject({ canPublish: false, canPublishData: false });

    const control = await call('/api/livekit/token', { role: 'control', controlSessionId: 'authorized-control' });
    const presenter = await call('/api/livekit/token', { role: 'presenter' });
    expect(control.status).toBe(403);
    expect(presenter.status).toBe(403);
  });

  it('requires both Basic authentication and an authorized Control session for Control grants', async () => {
    const pending = await call(
      '/api/livekit/token',
      { role: 'control', controlSessionId: 'pending-control' },
      basicAuth(),
    );
    expect(pending.status).toBe(403);

    const authorized = await call(
      '/api/livekit/token',
      { role: 'control', controlSessionId: 'authorized-control' },
      basicAuth(),
    );
    expect(authorized.status).toBe(200);
    const payload = decodeJwtPayload(String(authorized.body.token));
    expect(String(payload.sub)).toMatch(/^control-/);
    expect(payload.video).toMatchObject({ canPublish: true, canSubscribe: true });

    const participantId = String(authorized.body.participantId);
    const refreshCredential = String(authorized.body.refreshCredential);
    authorizedControls.delete('authorized-control');
    const revokedRefresh = await call(
      '/api/livekit/refresh-token',
      { participantId, refreshCredential },
      basicAuth(),
    );
    expect(revokedRefresh.status).toBe(403);
    authorizedControls.add('authorized-control');
  });

  it('rejects copied Control IDs without a matching private connection credential before issuing tokens or moderating', async () => {
    for (const operator of [null, { controlSessionId: 'other-control' }]) {
      api.close();
      const updateParticipant = vi.fn().mockResolvedValue({});
      api = createLiveKitApi({ authorizeOperatorCredential: () => operator, isLiveAudioControlAuthorized: () => true }, { roomServiceClient: { updateParticipant } });
      expect((await call('/api/livekit/token', { role: 'control', controlSessionId: 'authorized-control' }, basicAuth())).status).toBe(403);
      const audience = await issueAudience();
      expect((await call('/api/livekit/grant-speak', { role: 'control', controlSessionId: 'authorized-control', participantId: audience.participantId })).status).toBe(403);
      expect(updateParticipant).not.toHaveBeenCalled();
    }
  });

  it('binds refresh to the original participant and rotates the credential', async () => {
    const first = await issueAudience();
    const second = await issueAudience();

    const foreignUuid = await call('/api/livekit/refresh-token', {
      participantId: second.participantId,
      refreshCredential: first.refreshCredential,
    });
    expect(foreignUuid.status).toBe(403);

    const tampered = await call('/api/livekit/refresh-token', {
      participantId: first.participantId,
      refreshCredential: `${first.refreshCredential.slice(0, -1)}x`,
    });
    expect(tampered.status).toBe(403);

    const refreshed = await call('/api/livekit/refresh-token', {
      participantId: first.participantId,
      refreshCredential: first.refreshCredential,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.participantId).toBe(first.participantId);
    expect(refreshed.body.refreshCredential).not.toBe(first.refreshCredential);

    const replay = await call('/api/livekit/refresh-token', {
      participantId: first.participantId,
      refreshCredential: first.refreshCredential,
    });
    expect(replay.status).toBe(403);
  });

  it('reuses the admitted Audience identity for a fresh listener session and ignores a supplied UUID', async () => {
    api.close();
    const participantId = '00000000-0000-4000-8000-000000000001';
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }),
      getSessionAccessMode: () => 'CONTROLLED',
      authorizeAudienceCredential: (credential: string) => credential === 'admitted-access' ? { participantId, accessState: 'ADMITTED' } : null,
    });
    const first = await call('/api/livekit/token', { role: 'audience', audienceAccessCredential: 'admitted-access' });
    expect(first.status).toBe(200);
    expect(first.body.participantId).toBe(participantId);
    const second = await call('/api/livekit/token', {
      role: 'audience', audienceAccessCredential: 'admitted-access', participantId: '00000000-0000-4000-8000-000000000099',
    });
    expect(second.body.participantId).toBe(participantId);
    expect(second.body.participantIdentity).toBe(first.body.participantIdentity);
    expect(decodeJwtPayload(String(second.body.token)).video).toMatchObject({ canPublish: false });
    expect((await call('/api/livekit/token', { role: 'audience', audienceAccessCredential: 'invalid' })).status).toBe(403);
  });

  it('rejects an otherwise valid refresh credential after session expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = await issueAudience();
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));

    const expired = await call('/api/livekit/refresh-token', {
      participantId: token.participantId,
      refreshCredential: token.refreshCredential,
    });
    expect(expired.status).toBe(401);
  });

  it('updates LiveKit before committing a speak grant', async () => {
    api.close();
    const updateParticipant = vi.fn(async () => {
      const current = api.getState().participants.at(-1);
      expect(current).toMatchObject({ speakerState: 'LISTENER', canPublish: false });
      return {};
    });
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }),
      isLiveAudioControlAuthorized: (controlSessionId: string) => authorizedControls.has(controlSessionId),
      getLiveAudioParticipantState: () => null,
    }, { roomServiceClient: { updateParticipant } });
    const audience = await issueAudience();

    const granted = await call('/api/livekit/grant-speak', {
      role: 'control',
      controlSessionId: 'authorized-control',
      participantId: audience.participantId,
    });

    expect(granted.status).toBe(200);
    expect(updateParticipant).toHaveBeenCalledWith(
      'sefer-live-audio',
      audience.participantIdentity,
      expect.objectContaining({ permission: expect.objectContaining({ canPublish: true }) }),
    );
    expect(api.getState().participants.find((participant) => participant.participantId === audience.participantId))
      .toMatchObject({ speakerState: 'GRANTED', canPublish: true });
  });

  it('does not commit a grant when LiveKit rejects the permission update', async () => {
    api.close();
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }),
      isLiveAudioControlAuthorized: (controlSessionId: string) => authorizedControls.has(controlSessionId),
      getLiveAudioParticipantState: () => null,
    }, { roomServiceClient: { updateParticipant: vi.fn().mockRejectedValue(new Error('unavailable')) } });
    const audience = await issueAudience();

    const rejected = await call('/api/livekit/grant-speak', {
      role: 'control',
      controlSessionId: 'authorized-control',
      participantId: audience.participantId,
    });

    expect(rejected).toMatchObject({
      status: 502,
      body: { error: 'LiveKit rejected the participant permission update' },
    });
    expect(api.getState().participants.find((participant) => participant.participantId === audience.participantId))
      .toMatchObject({ speakerState: 'LISTENER', canPublish: false });
  });

  it('disables LiveKit publishing before committing a revocation', async () => {
    api.close();
    const updateParticipant = vi.fn().mockResolvedValue({});
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }),
      isLiveAudioControlAuthorized: (controlSessionId: string) => authorizedControls.has(controlSessionId),
      getLiveAudioParticipantState: () => null,
    }, { roomServiceClient: { updateParticipant } });
    const audience = await issueAudience();
    const moderationBody = {
      role: 'control',
      controlSessionId: 'authorized-control',
      participantId: audience.participantId,
    };
    await call('/api/livekit/grant-speak', moderationBody);

    const revoked = await call('/api/livekit/revoke-speak', moderationBody);

    expect(revoked.status).toBe(200);
    expect(updateParticipant).toHaveBeenLastCalledWith(
      'sefer-live-audio',
      audience.participantIdentity,
      expect.objectContaining({ permission: expect.objectContaining({ canPublish: false }) }),
    );
    expect(api.getState().participants.find((participant) => participant.participantId === audience.participantId))
      .toMatchObject({ speakerState: 'LISTENER', canPublish: false });
  });

  it('requires authentication for moderation even with a public authorized Control id', async () => {
    const audience = await issueAudience();
    const rejected = await call('/api/livekit/grant-speak', {
      role: 'control', controlSessionId: 'authorized-control', participantId: audience.participantId,
    }, '');
    expect(rejected).toMatchObject({ status: 403, body: { code: 'privileged_auth_required' } });
    expect(isProtectedRequestPath('/api/livekit/grant-speak', 'POST')).toBe(true);
    expect(api.getState().participants.find((p) => p.participantId === audience.participantId)?.canPublish).toBe(false);
  });

  it('does not turn Audience telemetry into a publishing JWT on refresh', async () => {
    api.close();
    const updateParticipant = vi.fn();
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }),
      isLiveAudioControlAuthorized: () => true,
      getLiveAudioParticipantState: () => ({ speakerState: 'GRANTED', canPublishAudio: true, canSubscribe: true }),
    }, { roomServiceClient: { updateParticipant } });
    const audience = await issueAudience();
    const refreshed = await call('/api/livekit/refresh-token', {
      participantId: audience.participantId, refreshCredential: audience.refreshCredential,
    });
    expect(refreshed.status).toBe(200);
    expect(decodeJwtPayload(String(refreshed.body.token)).video).toMatchObject({ canPublish: false });
    expect(updateParticipant).not.toHaveBeenCalled();
  });

  it('classifies an absent SFU participant and logs only allowlisted error fields', async () => {
    api.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }), isLiveAudioControlAuthorized: () => true }, {
      roomServiceClient: { updateParticipant: vi.fn().mockRejectedValue(Object.assign(new Error('203.0.113.8 secret-room'), {
        name: 'secret-name', code: 'not_found', status: 404,
      })) },
    });
    const audience = await issueAudience();
    const rejected = await call('/api/livekit/grant-speak', {
      role: 'control', controlSessionId: 'authorized-control', participantId: audience.participantId,
    });
    expect(rejected).toMatchObject({ status: 409, body: { code: 'participant_not_ready' } });
    expect(api.getState().participants.find((p) => p.participantId === audience.participantId))
      .toMatchObject({ canPublish: false, livekitConnected: false });
    expect(String(warn.mock.calls)).toContain('status=404 code=not_found');
    expect(String(warn.mock.calls)).not.toMatch(/203\.0\.113|secret-room|secret-name/);
    warn.mockRestore();
  });

  it('distinguishes an inactive record and an expired session from invalid credentials', async () => {
    const audience = await issueAudience();
    const inactive = await call('/api/livekit/refresh-token', {
      participantId: '00000000-0000-4000-8000-000000000000', refreshCredential: audience.refreshCredential,
    });
    expect(inactive).toMatchObject({ status: 403, body: { code: 'participant_inactive' } });
    const invalid = await call('/api/livekit/refresh-token', {
      participantId: audience.participantId, refreshCredential: 'invalid-credential-with-enough-length',
    });
    expect(invalid).toMatchObject({ status: 403, body: { code: 'refresh_credential_invalid' } });
    vi.useFakeTimers();
    vi.setSystemTime(audience.expiresAt + 1);
    const expired = await call('/api/livekit/refresh-token', {
      participantId: audience.participantId, refreshCredential: audience.refreshCredential,
    });
    expect(expired).toMatchObject({ status: 401, body: { code: 'session_expired' } });
  });

  it('checks the actual LiveKit API and briefly caches readiness', async () => {
    api.close();
    vi.useFakeTimers();
    const listRooms = vi.fn().mockResolvedValue([]);
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }),}, { roomServiceClient: { listRooms } });
    expect(await call('/api/livekit/status', {})).toMatchObject({ status: 200, body: { enabled: true, available: true } });
    await call('/api/livekit/status', {});
    expect(listRooms).toHaveBeenCalledTimes(1);
    listRooms.mockRejectedValue(Object.assign(new Error('synthetic down'), { code: 'unavailable', status: 503 }));
    await vi.advanceTimersByTimeAsync(5001);
    expect(await call('/api/livekit/status', {})).toMatchObject({ status: 200, body: { enabled: true, available: false, reason: 'livekit-unreachable' } });
    expect(listRooms).toHaveBeenCalledTimes(2);
  });

  it('bounds an unresponsive LiveKit readiness request', async () => {
    api.close();
    vi.useFakeTimers();
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }),}, { roomServiceClient: { listRooms: () => new Promise(() => {}) }, statusTimeoutMs: 25 });
    const response = call('/api/livekit/status', {});
    await vi.advanceTimersByTimeAsync(25);
    expect(await response).toMatchObject({ body: { available: false, reason: 'livekit-unreachable' } });
  });

  it('cancels the readiness deadline and settles the request on API close', async () => {
    api.close();
    vi.useFakeTimers();
    api = createLiveKitApi({}, { roomServiceClient: { listRooms: () => new Promise(() => {}) } });
    const response = call('/api/livekit/status', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(2);
    try {
      api.close();
      api.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await vi.advanceTimersByTimeAsync(2000);
      expect(await response).toMatchObject({ body: { available: false } });
    }
  });

  it('mutes microphone tracks in LiveKit while retaining the grant for explicit user reopening', async () => {
    api.close();
    const mutePublishedTrack = vi.fn().mockResolvedValue({});
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }), isLiveAudioControlAuthorized: () => true }, { roomServiceClient: {
      updateParticipant: vi.fn().mockResolvedValue({}),
      getParticipant: vi.fn().mockResolvedValue({ tracks: [{ sid: 'microphone-track', source: 2 }, { sid: 'camera-track', source: 1 }] }),
      mutePublishedTrack,
    } });
    const audience = await issueAudience();
    const body = { role: 'control', controlSessionId: 'authorized-control', participantId: audience.participantId };
    await call('/api/livekit/grant-speak', body);
    expect((await call('/api/livekit/mute-participant', body)).status).toBe(200);
    expect(mutePublishedTrack).toHaveBeenCalledExactlyOnceWith('sefer-live-audio', audience.participantIdentity, 'microphone-track', true);
    expect(api.getState().participants.find((p) => p.participantId === audience.participantId)?.canPublish).toBe(true);
  });

  it('revokes publication in LiveKit before confirming a broadcast transition', async () => {
    api.close();
    const updateParticipant = vi.fn().mockResolvedValue({});
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }), isLiveAudioControlAuthorized: () => true }, { roomServiceClient: { updateParticipant } });
    const audience = await issueAudience();
    await call('/api/livekit/grant-speak', { role: 'control', controlSessionId: 'authorized-control', participantId: audience.participantId });
    expect(await api.revokeAllSpeakers()).toBe(true);
    expect(updateParticipant).toHaveBeenLastCalledWith('sefer-live-audio', audience.participantIdentity,
      expect.objectContaining({ permission: expect.objectContaining({ canPublish: false }) }));
    expect(api.getState().participants.find((p) => p.participantId === audience.participantId)?.canPublish).toBe(false);
  });

  it('does not confirm global revocation when LiveKit cannot revoke an existing speaker', async () => {
    api.close();
    const updateParticipant = vi.fn().mockResolvedValue({});
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }), isLiveAudioControlAuthorized: () => true }, { roomServiceClient: { updateParticipant } });
    const audience = await issueAudience();
    await call('/api/livekit/grant-speak', { role: 'control', controlSessionId: 'authorized-control', participantId: audience.participantId });
    updateParticipant.mockRejectedValue(Object.assign(new Error('synthetic unavailable'), { code: 'unavailable', status: 503 }));
    expect(await api.revokeAllSpeakers()).toBe(false);
    expect(api.getState().participants.find((p) => p.participantId === audience.participantId)?.canPublish).toBe(true);
  });

  it('waits for an outstanding grant before revocation and rejects new grants during the transition', async () => {
    api.close();
    let finishGrant!: () => void;
    const updateParticipant = vi.fn().mockImplementation((_room, _identity, options) => options.permission.canPublish
      ? new Promise<void>((resolve) => { finishGrant = resolve; })
      : Promise.resolve({}));
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }), isLiveAudioControlAuthorized: () => true }, { roomServiceClient: { updateParticipant } });
    const audience = await issueAudience();
    const body = { role: 'control', controlSessionId: 'authorized-control', participantId: audience.participantId };
    const grant = call('/api/livekit/grant-speak', body);
    await vi.waitFor(() => expect(updateParticipant).toHaveBeenCalledTimes(1));
    const revoke = api.revokeAllSpeakers();
    const lateGrant = await call('/api/livekit/grant-speak', body);
    expect(lateGrant).toMatchObject({ status: 409, body: { code: 'publication_transition_pending' } });
    expect(updateParticipant).toHaveBeenCalledTimes(1);
    finishGrant();
    expect((await grant).status).toBe(200);
    expect(await revoke).toBe(true);
    expect(updateParticipant).toHaveBeenLastCalledWith('sefer-live-audio', audience.participantIdentity,
      expect.objectContaining({ permission: expect.objectContaining({ canPublish: false }) }));
    expect(api.getState().participants.find((p) => p.participantId === audience.participantId)?.canPublish).toBe(false);
  });

  it('honors exclusions while muting all microphone tracks in LiveKit', async () => {
    api.close();
    const mutePublishedTrack = vi.fn().mockResolvedValue({});
    api = createLiveKitApi({ authorizeOperatorCredential: () => ({ controlSessionId: 'authorized-control' }), isLiveAudioControlAuthorized: () => true }, { roomServiceClient: {
      updateParticipant: vi.fn().mockResolvedValue({}),
      getParticipant: vi.fn().mockResolvedValue({ tracks: [{ sid: 'microphone-track', source: 2 }] }),
      mutePublishedTrack,
    } });
    const first = await issueAudience();
    const second = await issueAudience();
    for (const audience of [first, second]) {
      await call('/api/livekit/grant-speak', { role: 'control', controlSessionId: 'authorized-control', participantId: audience.participantId });
    }
    const muted = await call('/api/livekit/mute-all', {
      role: 'control', controlSessionId: 'authorized-control', excludeParticipantIds: [first.participantId],
    });
    expect(muted.status).toBe(200);
    expect(mutePublishedTrack).toHaveBeenCalledExactlyOnceWith('sefer-live-audio', second.participantIdentity, 'microphone-track', true);
  });
});
