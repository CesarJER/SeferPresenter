import type { BroadcastMessage, SyncProtocolMeta } from '../types/sync';
import { SYNC_PROTOCOL_VERSION } from '../types/sync';

export const withSyncMeta = <T extends object>(message: T): T & Required<SyncProtocolMeta> => ({
  ...message,
  protocolVersion: SYNC_PROTOCOL_VERSION,
  timestamp: typeof (message as { timestamp?: unknown }).timestamp === 'number'
    ? (message as { timestamp: number }).timestamp
    : Date.now(),
  messageId: typeof (message as { messageId?: unknown }).messageId === 'string'
    ? (message as { messageId: string }).messageId
    : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
});

export const makeSyncMessage = <T extends BroadcastMessage>(message: T): T & Required<SyncProtocolMeta> =>
  withSyncMeta(message) as T & Required<SyncProtocolMeta>;
