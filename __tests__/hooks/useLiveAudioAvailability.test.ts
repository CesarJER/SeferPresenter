// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLiveAudioAvailability, resetLiveAudioAvailabilityCacheForTests } from '../../src/features/liveAudio/hooks/useLiveAudioAvailability';

describe('Live Audio API availability', () => {
  beforeEach(() => {
    resetLiveAudioAvailabilityCacheForTests();
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { mediaDevices: {} });
    vi.stubGlobal('RTCPeerConnection', class {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetLiveAudioAvailabilityCacheForTests();
  });

  it('expires a temporary API failure so a recovered server can become available', async () => {
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, available: false, reason: 'livekit-unreachable' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ enabled: true, available: true }) });
    vi.stubGlobal('fetch', fetchStatus);
    expect(await getLiveAudioAvailability()).toBe('misconfigured');
    expect(await getLiveAudioAvailability()).toBe('misconfigured');
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await getLiveAudioAvailability()).toBe('enabled');
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps a disabled optional feature cached without repeatedly probing the server', async () => {
    const fetchStatus = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) });
    vi.stubGlobal('fetch', fetchStatus);
    expect(await getLiveAudioAvailability()).toBe('disabled');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await getLiveAudioAvailability()).toBe('disabled');
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
