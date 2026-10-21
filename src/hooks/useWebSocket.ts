import { useCallback, useEffect, useRef, useState } from 'react';

export type WebSocketConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

export type WebSocketMessageHandler = (type: string, payload: Record<string, unknown>) => void;

export interface UseWebSocketOptions {
  enabled?: boolean;
  protocols?: string | string[];
  onMessage?: WebSocketMessageHandler;
  onStatusChange?: (status: WebSocketConnectionStatus) => void;
}

export interface UseWebSocketResult {
  status: WebSocketConnectionStatus;
  sendMessage: (type: string, payload?: unknown) => boolean;
}

export interface WebSocketAdapter {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  close: () => void;
  send: (data: string) => void;
}

export type WebSocketAdapterConstructor = new (
  url: string,
  protocols?: string | string[],
) => WebSocketAdapter;

export interface WebSocketControllerOptions {
  url: string;
  protocols?: string | string[];
  WebSocketCtor?: WebSocketAdapterConstructor;
  onMessage?: WebSocketMessageHandler;
  onStatusChange?: (status: WebSocketConnectionStatus) => void;
}

export interface WebSocketController {
  cleanup: () => void;
  getStatus: () => WebSocketConnectionStatus;
  sendMessage: (type: string, payload?: unknown) => boolean;
}

const OPEN_READY_STATE = 1;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

const getReconnectDelay = (attempt: number) =>
  RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const safeSerializeMessage = (type: string, payload: unknown): string | null => {
  try {
    return JSON.stringify(isPlainObject(payload) ? { type, ...payload } : { type });
  } catch {
    return null;
  }
};

const parseIncomingMessage = (
  data: unknown,
): { type: string; payload: Record<string, unknown> } | null => {
  if (typeof data !== 'string') return null;

  try {
    const parsed = JSON.parse(data) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null;

    const message = parsed as Record<string, unknown>;
    if (typeof message.type !== 'string') return null;

    return { type: message.type, payload: message };
  } catch {
    return null;
  }
};

export function createWebSocketController(options: WebSocketControllerOptions): WebSocketController {
  const WebSocketCtor =
    options.WebSocketCtor ?? (globalThis.WebSocket as unknown as WebSocketAdapterConstructor);

  let socket: WebSocketAdapter | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let status: WebSocketConnectionStatus = 'closed';

  const setStatus = (nextStatus: WebSocketConnectionStatus) => {
    status = nextStatus;
    options.onStatusChange?.(nextStatus);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const connect = () => {
    if (disposed) return;

    clearReconnectTimer();
    setStatus('connecting');

    try {
      socket =
        options.protocols === undefined
          ? new WebSocketCtor(options.url)
          : new WebSocketCtor(options.url, options.protocols);
    } catch {
      setStatus('error');
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      if (disposed) return;
      reconnectAttempt = 0;
      setStatus('open');
    };

    socket.onerror = () => {
      if (disposed) return;
      setStatus('error');
    };

    socket.onmessage = (event) => {
      if (disposed) return;
      const message = parseIncomingMessage(event.data);
      if (!message) return;
      options.onMessage?.(message.type, message.payload);
    };

    socket.onclose = () => {
      if (disposed) return;
      socket = null;
      setStatus('closed');
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== null) return;

    const delay = getReconnectDelay(reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  connect();

  return {
    cleanup: () => {
      disposed = true;
      clearReconnectTimer();

      if (socket !== null) {
        socket.close();
        socket = null;
      }
    },
    getStatus: () => status,
    sendMessage: (type: string, payload?: unknown) => {
      if (socket?.readyState !== OPEN_READY_STATE) return false;

      const serialized = safeSerializeMessage(type, payload);
      if (serialized === null) return false;

      try {
        socket.send(serialized);
        return true;
      } catch {
        setStatus('error');
        return false;
      }
    },
  };
}

export function useWebSocket(url: string | null, options: UseWebSocketOptions = {}): UseWebSocketResult {
  const { enabled = true, protocols, onMessage, onStatusChange } = options;
  const [status, setStatus] = useState<WebSocketConnectionStatus>(
    enabled && url ? 'connecting' : 'closed',
  );
  const controllerRef = useRef<WebSocketController | null>(null);
  const onMessageRef = useRef<WebSocketMessageHandler | undefined>(onMessage);
  const onStatusChangeRef = useRef(onStatusChange);

  onMessageRef.current = onMessage;
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    if (!enabled || !url) {
      setStatus('closed');
      return;
    }

    if (typeof globalThis.WebSocket === 'undefined') {
      setStatus('error');
      return;
    }

    const controller = createWebSocketController({
      url,
      protocols,
      onStatusChange: nextStatus => {
        onStatusChangeRef.current?.(nextStatus);
        setStatus(nextStatus);
      },
      onMessage: (type, payload) => onMessageRef.current?.(type, payload),
    });

    controllerRef.current = controller;

    return () => {
      onStatusChangeRef.current?.('closed');
      controller.cleanup();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [enabled, protocols, url]);

  const sendMessage = useCallback((type: string, payload?: unknown) => {
    return controllerRef.current?.sendMessage(type, payload) ?? false;
  }, []);

  return { status, sendMessage };
}
