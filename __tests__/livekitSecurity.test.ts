import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
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
      createRoomServiceClient: () => ({
        listRooms: vi.fn().mockResolvedValue([]),
      }),
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
    pathname: '/api/livekit/token' | '/api/livekit/refresh-token',
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

  it('reports runtime LiveKit reachability instead of configuration alone', async () => {
    const callStatus = async () => {
      let response: ApiResponse | null = null;
      await api.handle({
        req: { method: 'GET', headers: {} },
        res: {},
        url: new URL('/api/livekit/status', 'http://localhost'),
        readBody: async () => '',
        sendJson: (_res: unknown, status: number, value: Record<string, unknown>) => {
          response = { status, body: value };
        },
      });
      return response as ApiResponse | null;
    };

    expect(await callStatus()).toEqual({
      status: 200,
      body: { enabled: true, available: true },
    });

    api.close();
    api = createLiveKitApi({
      createRoomServiceClient: () => ({
        listRooms: vi.fn().mockRejectedValue(new Error('unreachable')),
      }),
    });
    expect(await callStatus()).toEqual({
      status: 503,
      body: { enabled: true, available: false, reason: 'livekit-unreachable' },
    });
  });

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

  it('binds Audience refresh and publish permission to the same admitted credential', async () => {
    api.close();
    const firstParticipantId = randomUUID();
    const secondParticipantId = randomUUID();
    const access = new Map([
      ['credential-first', { participantId: firstParticipantId }],
      ['credential-second', { participantId: secondParticipantId }],
    ]);
    api = createLiveKitApi({
      isLiveAudioControlAuthorized: () => false,
      authorizeAudienceCredential: (credential: string) => access.get(credential) ?? null,
      getLiveAudioParticipantState: (participantId: string) => participantId === firstParticipantId
        ? {
            speakerState: 'GRANTED',
            canPublishAudio: true,
            canSubscribe: true,
            isMuted: true,
          }
        : null,
      hasCurrentRecordingConfirmation: (participantId: string) => participantId === firstParticipantId,
    });

    const issued = await call('/api/livekit/token', {
      role: 'audience',
      audienceAccessCredential: 'credential-first',
    });
    expect(issued.status).toBe(200);
    expect(issued.body.participantId).toBe(firstParticipantId);
    expect(decodeJwtPayload(String(issued.body.token)).video).toMatchObject({ canPublish: true });

    const foreignRefresh = await call('/api/livekit/refresh-token', {
      participantId: firstParticipantId,
      refreshCredential: issued.body.refreshCredential,
      audienceAccessCredential: 'credential-second',
    });
    expect(foreignRefresh.status).toBe(403);
  });

  it('revokes connected Audience publishing through the LiveKit room service', async () => {
    api.close();
    const listParticipants = vi.fn().mockResolvedValue([{
      identity: 'audience-connected',
      tracks: [{ sid: 'microphone-track', source: 2, muted: false }],
    }]);
    const updateParticipant = vi.fn().mockResolvedValue({
      tracks: [{ sid: 'microphone-track', source: 2, muted: false }],
    });
    const mutePublishedTrack = vi.fn().mockResolvedValue({});
    api = createLiveKitApi({
      isLiveAudioControlAuthorized: () => false,
      getLiveAudioParticipantState: () => null,
      createRoomServiceClient: () => ({
        listParticipants,
        updateParticipant,
        mutePublishedTrack,
      }),
    });

    const issued = await issueAudience();
    listParticipants.mockResolvedValue([{
      identity: issued.participantIdentity,
      tracks: [{ sid: 'microphone-track', source: 2, muted: false }],
    }]);

    await api.revokeAudiencePublishingForRecording();

    expect(listParticipants).toHaveBeenCalledWith('sefer-live-audio');
    expect(updateParticipant).toHaveBeenCalledWith(
      'sefer-live-audio',
      issued.participantIdentity,
      {
        permission: {
          canSubscribe: true,
          canPublish: false,
          canPublishData: false,
          canPublishSources: [],
        },
      },
    );
    expect(mutePublishedTrack).toHaveBeenCalledWith(
      'sefer-live-audio',
      issued.participantIdentity,
      'microphone-track',
      true,
    );
    expect(api.getState().participants).toContainEqual(expect.objectContaining({
      participantId: issued.participantId,
      canPublish: false,
    }));
  });
});
