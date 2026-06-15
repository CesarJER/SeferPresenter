import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerClockController } from '../../src/hooks/useServerClock';

describe('createServerClockController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates offsetMs from SERVER_TIME_PONG', () => {
    const updates: Array<{ offsetMs: number; rttMs: number; isSynced: boolean }> = [];
    const controller = createServerClockController({
      sendMessage: vi.fn(),
      onUpdate: (state) => updates.push(state),
    });

    vi.setSystemTime(1_100);
    controller.handleMessage('SERVER_TIME_PONG', {
      clientSentAtMs: 1_000,
      serverTimeMs: 1_600,
    });

    expect(controller.getState()).toEqual({
      offsetMs: 550,
      rttMs: 100,
      isSynced: true,
    });
    expect(updates).toEqual([
      {
        offsetMs: 550,
        rttMs: 100,
        isSynced: true,
      },
    ]);

    vi.setSystemTime(1_200);
    expect(controller.serverNow()).toBe(1_750);
  });

  it('does not send pings when wsStatus is not open', () => {
    const sendMessage = vi.fn(() => true);
    const controller = createServerClockController({ sendMessage });

    controller.setStatus('connecting');
    vi.advanceTimersByTime(10_000);
    controller.setStatus('closed');
    vi.advanceTimersByTime(10_000);
    controller.setStatus('error');
    vi.advanceTimersByTime(10_000);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('cleans up the ping interval on cleanup', () => {
    const sendMessage = vi.fn(() => true);
    const controller = createServerClockController({ sendMessage });

    controller.setStatus('open');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenLastCalledWith('SERVER_TIME_PING', {
      clientSentAtMs: 1_000,
    });

    controller.cleanup();
    vi.advanceTimersByTime(10_000);

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
