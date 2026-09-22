import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveKitApi } from '../server/livekit-server.mjs';

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
    authorizedControls.clear();
    authorizedControls.add('authorized-control');
    process.env.SEFER_LIVE_AUDIO_ENABLED = 'true';
    process.env.LIVEKIT_URL = 'wss://livekit.example.test';
    process.env.LIVEKIT_API_KEY = 'test-api-key';
    process.env.LIVEKIT_API_SECRET = 'test-api-secret-with-enough-entropy';
    process.env.SEFER_CONTROL_PASSWORD = 'test-password';
    process.env.SEFER_LIVE_AUDIO_TOKEN_TTL_MINUTES = '1';
    api = createLiveKitApi({
      isLiveAudioControlAuthorized: (controlSessionId: string) => authorizedControls.has(controlSessionId),
      getLiveAudioParticipantState: () => null,
    });
  });

  afterEach(() => {
    api.close();
    vi.useRealTimers();
    delete process.env.SEFER_LIVE_AUDIO_ENABLED;
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.SEFER_CONTROL_PASSWORD;
    delete process.env.SEFER_LIVE_AUDIO_TOKEN_TTL_MINUTES;
  });

  const call = async (
    pathname: '/api/livekit/token' | '/api/livekit/refresh-token' | '/api/livekit/grant-speak' | '/api/livekit/revoke-speak',
    body: Record<string, unknown>,
    authorization?: string,
  ): Promise<ApiResponse> => {
    let response: ApiResponse | null = null;
    const handled = await api.handle({
      req: { method: 'POST', headers: authorization ? { authorization } : {} },
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
    api = createLiveKitApi({
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
    api = createLiveKitApi({
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
    api = createLiveKitApi({
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
});
