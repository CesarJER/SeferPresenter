// Restrict the real backend to an ephemeral loopback listener and synthetic data.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RoomServiceClient } from 'livekit-server-sdk';

const data = path.resolve(process.env.SEFER_DATA_DIR || '');
const tempRoot = path.resolve(tmpdir());
if (!data.startsWith(tempRoot + path.sep) || !path.basename(data).startsWith('sefer-astra-')) {
  throw new Error('A synthetic temporary SEFER_DATA_DIR is mandatory');
}
process.loadEnvFile = () => { throw new Error('Environment-file loading forbidden in audit child'); };
// This child never needs an outgoing socket. Incoming HTTP/WS traffic is real.
net.Socket.prototype.connect = function () { throw new Error('Outbound sockets forbidden in audit child'); };
for (const method of ['updateParticipant', 'removeParticipant']) {
  RoomServiceClient.prototype[method] = async function (...args) {
    process.send?.({ kind: 'sdk', method, args });
    return {};
  };
}
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  const callback = args.findLast(value => typeof value === 'function');
  return originalListen.call(this, { port: 0, host: '127.0.0.1' }, () => {
    callback?.();
    process.send?.({ kind: 'ready', port: this.address().port });
  });
};
