import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseServerClockResult {
  offsetMs: number;
  rttMs: number;
  isSynced: boolean;
  serverNow: () => number;
}

type WebSocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export type ServerClockMessageHandler = (
  type: string,
  payload: Record<string, unknown>,
) => void;

export interface ServerClockControllerOptions {
  sendMessage: (type: string, payload?: Record<string, unknown>) => boolean;
  onUpdate?: (state: Omit<UseServerClockResult, 'serverNow'>) => void;
}

export interface ServerClockController {
  cleanup: () => void;
  handleMessage: ServerClockMessageHandler;
  setStatus: (status: WebSocketStatus) => void;
  getState: () => Omit<UseServerClockResult, 'serverNow'>;
  serverNow: () => number;
}

const SERVER_TIME_PING_INTERVAL_MS = 10_000;

const initialClockState = (): Omit<UseServerClockResult, 'serverNow'> => ({
  offsetMs: 0,
  rttMs: 0,
  isSynced: false,
});

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function createServerClockController({
  sendMessage,
  onUpdate,
}: ServerClockControllerOptions): ServerClockController {
  let state = initialClockState();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let status: WebSocketStatus = 'closed';

  const emitUpdate = () => {
    onUpdate?.(state);
  };

  const clearPingInterval = () => {
    if (intervalId === null) return;
    clearInterval(intervalId);
    intervalId = null;
  };

  const sendPing = () => {
    sendMessage('SERVER_TIME_PING', { clientSentAtMs: Date.now() });
  };

  const startPings = () => {
    clearPingInterval();
    sendPing();
    intervalId = setInterval(sendPing, SERVER_TIME_PING_INTERVAL_MS);
  };

  return {
    cleanup: clearPingInterval,
    handleMessage: (type, payload) => {
      if (type !== 'SERVER_TIME_PONG') return;

      const clientSentAtMs = readNumber(payload.clientSentAtMs);
      const serverTimeMs = readNumber(payload.serverTimeMs);
      if (clientSentAtMs === null || serverTimeMs === null) return;

      const rttMs = Date.now() - clientSentAtMs;
      const offsetMs = serverTimeMs - (clientSentAtMs + rttMs / 2);
      state = { offsetMs, rttMs, isSynced: true };
      emitUpdate();
    },
    setStatus: (nextStatus) => {
      if (status === nextStatus) return;
      status = nextStatus;

      if (nextStatus === 'open') {
        startPings();
        return;
      }

      clearPingInterval();
    },
    getState: () => state,
    serverNow: () => Date.now() + state.offsetMs,
  };
}

export function useServerClock(
  sendMessage: (type: string, payload?: Record<string, unknown>) => boolean,
  wsStatus: WebSocketStatus,
  onMessage: (handler: ServerClockMessageHandler) => () => void,
): UseServerClockResult {
  const [clockState, setClockState] =
    useState<Omit<UseServerClockResult, 'serverNow'>>(initialClockState);
  const controllerRef = useRef<ServerClockController | null>(null);

  useEffect(() => {
    const controller = createServerClockController({
      sendMessage,
      onUpdate: setClockState,
    });
    controllerRef.current = controller;
    controller.setStatus(wsStatus);

    const unsubscribe = onMessage(controller.handleMessage);

    return () => {
      unsubscribe();
      controller.cleanup();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [onMessage, sendMessage, wsStatus]);

  const serverNow = useCallback(() => {
    return Date.now() + clockState.offsetMs;
  }, [clockState.offsetMs]);

  return {
    ...clockState,
    serverNow,
  };
}
