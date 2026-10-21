// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  createWebSocketController,
  useWebSocket,
  type WebSocketAdapter,
} from '../../src/hooks/useWebSocket';

class MockWebSocket implements WebSocketAdapter {
  static instances: MockWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closeCalls = 0;
  sentMessages: string[] = [];

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = 3;
    this.onclose?.();
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  triggerMessage(data: unknown) {
    this.onmessage?.({ data });
  }
}

it('notifies binding invalidation synchronously on close and cleanup without opening a second socket', () => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  let bound = false;
  const changed = vi.fn(() => { bound = false; });
  const hook = renderHook(() => useWebSocket('ws://localhost/synthetic', { onStatusChange: changed }));
  try {
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => MockWebSocket.instances[0].triggerOpen());
    bound = true;
    act(() => {
      MockWebSocket.instances[0].triggerClose();
      expect(bound).toBe(false);
    });
    hook.unmount();
    expect(changed).toHaveBeenLastCalledWith('closed');
    expect(MockWebSocket.instances).toHaveLength(1);
  } finally {
    hook.unmount();
    vi.unstubAllGlobals();
  }
});

describe('createWebSocketController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects with exponential backoff capped at 30 seconds', () => {
    const statuses: string[] = [];
    const controller = createWebSocketController({
      url: 'ws://localhost:8787',
      WebSocketCtor: MockWebSocket,
      onStatusChange: (status) => statuses.push(status),
    });

    expect(MockWebSocket.instances).toHaveLength(1);

    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    expectedDelays.forEach((delay, index) => {
      MockWebSocket.instances[index].triggerClose();

      vi.advanceTimersByTime(delay - 1);
      expect(MockWebSocket.instances).toHaveLength(index + 1);

      vi.advanceTimersByTime(1);
      expect(MockWebSocket.instances).toHaveLength(index + 2);
    });

    expect(statuses).toContain('connecting');
    expect(statuses).toContain('closed');

    controller.cleanup();
  });

  it('clears reconnect timers and closes the active socket during cleanup', () => {
    const scheduledController = createWebSocketController({
      url: 'ws://localhost:8787',
      WebSocketCtor: MockWebSocket,
    });

    MockWebSocket.instances[0].triggerClose();
    scheduledController.cleanup();

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(1);

    const activeController = createWebSocketController({
      url: 'ws://localhost:8787',
      WebSocketCtor: MockWebSocket,
    });
    const activeSocket = MockWebSocket.instances[1];

    activeController.cleanup();

    expect(activeSocket.closeCalls).toBe(1);
  });

  it('serializes plain object payload fields at the message root', () => {
    const controller = createWebSocketController({
      url: 'ws://localhost:8787',
      WebSocketCtor: MockWebSocket,
    });
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    expect(controller.sendMessage('PING', { ms: 1 })).toBe(true);
    expect(socket.sentMessages[0]).toBe('{"type":"PING","ms":1}');

    controller.cleanup();
  });

  it('passes the full flat server message as the parsed payload', () => {
    const received: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const controller = createWebSocketController({
      url: 'ws://localhost:8787',
      WebSocketCtor: MockWebSocket,
      onMessage: (type, payload) => received.push({ type, payload }),
    });

    MockWebSocket.instances[0].triggerMessage(
      JSON.stringify({ type: 'WELCOME', clientId: 'abc', serverTimeMs: 123 }),
    );

    expect(received).toEqual([
      {
        type: 'WELCOME',
        payload: { type: 'WELCOME', clientId: 'abc', serverTimeMs: 123 },
      },
    ]);

    controller.cleanup();
  });
});
