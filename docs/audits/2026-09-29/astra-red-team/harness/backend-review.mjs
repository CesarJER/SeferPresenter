import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { TokenVerifier } from 'livekit-server-sdk';
import { webcrypto } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const evidence = path.resolve(here, '../evidence');
const password = 'astra-synthetic-password';
const apiKey = 'astra-synthetic-key';
const apiSecret = 'astra-synthetic-signing-secret-not-production';
const basic = `Basic ${Buffer.from(`audit:${password}`).toString('base64')}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const verifier = new TokenVerifier(apiKey, apiSecret);
const command = payload => ({ type: 'REMOTE_COMMAND', clientId: 'astra-client', payload });
const presentation = (id, title = id) => ({
  id, title, mode: 'standard', background: '', tags: [],
  slides: [{ id: `${id}-0`, label: 'Zero', lines: ['Synthetic zero'] },
    { id: `${id}-1`, label: 'One', lines: ['Synthetic one'] }],
});

async function startBackend(access = 'PUBLIC') {
  const data = await mkdtemp(path.join(tmpdir(), 'sefer-astra-'));
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP', 'COMSPEC']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    SEFER_DATA_DIR: data, SEFER_PORT: '0', SEFER_REQUIRE_AUTH: 'true',
    SEFER_CONTROL_PASSWORD: password, SEFER_SESSION_ACCESS_DEFAULT: access,
    SEFER_LIVE_AUDIO_ENABLED: 'true', SEFER_VOICE_SCRIPTURE_ENABLED: 'false',
    LIVEKIT_URL: 'wss://astra.invalid', LIVEKIT_API_URL: 'https://astra.invalid',
    LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret,
    VITE_SEFER_PUBLICABLE_DEFAULT: 'off',
  });
  const child = fork(path.join(root, 'server/local-server.mjs'), [], {
    execArgv: ['--import', pathToFileURL(path.join(here, 'backend-preload.mjs')).href],
    cwd: data, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  const messages = [];
  child.on('message', value => messages.push(value));
  const exit = once(child, 'exit').then(([code, signal]) => ({ code, signal }));
  const sockets = [];
  const until = async predicate => {
    for (let i = 0; i < 300; i++) {
      const result = predicate();
      if (result) return result;
      if (child.exitCode !== null) throw new Error(`Backend exited: ${stderr}`);
      await pause(10);
    }
    throw new Error('Isolated backend observation timed out');
  };
  try {
    const ready = await until(() => messages.find(value => value.kind === 'ready'));
    const base = `http://127.0.0.1:${ready.port}`;
    const request = async (pathname, body, auth = true, extraHeaders = {}) => {
      const response = await fetch(base + pathname, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(auth ? { Authorization: basic } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(4000),
      });
      return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
    };
    const connect = async (role, auth = role !== 'audience') => {
      const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?role=${role}`, {
        headers: auth ? { Authorization: basic } : {},
      });
      sockets.push(socket);
      const inbox = [];
      socket.on('message', raw => inbox.push(JSON.parse(raw.toString())));
      await once(socket, 'open');
      const welcome = await until(() => inbox.find(value => value.type === 'WELCOME'));
      return { socket, inbox, welcome,
        send: value => socket.send(typeof value === 'string' ? value : JSON.stringify(value)),
        wait: (predicate, from = 0) => until(() => inbox.slice(from).find(predicate)),
      };
    };
    return { child, data, base, messages, sockets, exit, until, request, connect,
      logs: () => ({ stdout, stderr }),
      async close() {
        for (const socket of sockets) socket.terminate();
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
          await exit; clearTimeout(timer);
        }
        // Only the freshly created synthetic temp directory can be removed.
        if (!data.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(data).startsWith('sefer-astra-')) {
          throw new Error('Cleanup boundary violated');
        }
        await rm(data, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill('SIGKILL'); await exit;
    await rm(data, { recursive: true, force: true });
    throw error;
  }
}

async function runCase(name, test, access = 'PUBLIC') {
  const backend = await startBackend(access);
  let observations, error;
  try { observations = await test(backend); }
  catch (failure) { error = failure.stack || String(failure); }
  finally { await backend.close(); }
  const logs = backend.logs();
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, `${name}.json`), JSON.stringify({
    date: '29/09/2026 · 17:45', scenario: name,
    command: `node docs/audits/2026-09-29/astra-red-team/harness/backend-review.mjs ${name}`,
    preconditions: { access, realBackend: true, loopbackEphemeral: true, syntheticData: true,
      environmentFile: false, outgoingConnections: 'blocked', sdk: 'final administration methods mocked' },
    observation: observations, assertionExitCode: error ? 1 : 0,
    backendExit: { code: backend.child.exitCode, signal: backend.child.signalCode },
    ...logs, ...(error ? { error } : {}),
    interpretation: error ? 'Harness assertion failed; inspect before a verdict.' : 'Observations and counterchecks met; see finding verdict for scope.',
  }, null, 2));
  if (error) throw new Error(`${name}: ${error}`);
  console.log(`PASS ${name}: ${JSON.stringify(observations)}`);
}

const cases = {};
for (const [name, payload] of Object.entries({ null: 'null', boolean: 'true', number: '1',
  string: '"text"', array: '[]', object: '{}', invalid: '{oops', valid: '{"type":"SERVER_TIME_PING","clientSentAtMs":100}' })) {
  cases[`H01-${name}`] = async backend => {
    const listener = await backend.connect('audience');
    assert.equal((await backend.request('/api/livekit/status', undefined, false)).status, 200);
    listener.send(payload);
    if (name === 'null') {
      const died = await Promise.race([backend.exit, pause(4000).then(() => { throw new Error('Expected process termination did not occur'); })]);
      assert.equal(died.code, 1);
      assert.match(backend.logs().stderr, /Cannot read properties of null/);
      await assert.rejects(() => backend.request('/api/livekit/status', undefined, false));
      return { payload, exitCode: died.code, httpAfter: 'connection refused', laterValidMessage: 'process no longer exists' };
    }
    listener.send({ type: 'SERVER_TIME_PING', clientSentAtMs: 4242 });
    await listener.wait(value => value.type === 'SERVER_TIME_PONG' && value.clientSentAtMs === 4242);
    assert.equal((await backend.request('/api/livekit/status', undefined, false)).status, 200);
    return { payload, processAlive: true, validMessageAfter: 'PONG', httpAfter: 200 };
  };
}

cases.H02 = async backend => {
  const listener = await backend.connect('audience');
  const initial = await backend.request('/api/livekit/token', { role: 'audience' }, false);
  assert.equal(initial.status, 200);
  let credentials = initial.body;
  assert.equal((await verifier.verify(credentials.token)).video.canPublish, false);
  const bad = await backend.request('/api/livekit/refresh-token', {
    participantId: credentials.participantId, refreshCredential: 'x'.repeat(40),
  }, false);
  assert.equal(bad.status, 403);
  const states = [];
  for (const fields of [{ speakerState: 'LISTENER', canPublishAudio: false },
    { speakerState: 'LISTENER', canPublishAudio: true }, { speakerState: 'GRANTED', canPublishAudio: false }]) {
    const from = listener.inbox.length;
    listener.send({ type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: credentials.participantId,
      role: 'audience', canSubscribe: true, isMuted: false, isActiveAudience: true, ...fields });
    listener.send({ type: 'SERVER_TIME_PING', clientSentAtMs: 9090 + states.length });
    await listener.wait(value => value.type === 'SERVER_TIME_PONG', from);
    const refreshed = await backend.request('/api/livekit/refresh-token', {
      participantId: credentials.participantId, refreshCredential: credentials.refreshCredential,
    }, false);
    assert.equal(refreshed.status, 200);
    const verified = await verifier.verify(refreshed.body.token);
    const expected = fields.canPublishAudio || fields.speakerState === 'GRANTED';
    assert.equal(verified.video.canPublish, expected);
    states.push({ ...fields, signedCanPublish: verified.video.canPublish, signatureVerifiedBySdk: true });
    credentials = refreshed.body;
  }
  return { wrongRefresh: bad.status, independentFields: states, sfuAcceptance: 'not tested', physicalAudio: 'not tested' };
};

cases.H04 = async backend => {
  const principal = await backend.connect('control');
  const pending = await backend.connect('control');
  assert.equal(principal.welcome.controlState, 'PRINCIPAL');
  assert.equal(pending.welcome.controlState, 'PENDING');
  const payload = command({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: presentation('P'), slideIndex: 1 });
  pending.send(payload);
  await pending.wait(value => value.code === 'CONTROL_PENDING_FORBIDDEN');
  assert.equal((await backend.request('/api/state')).body.presentation, null);
  const noBasic = await backend.request('/api/command', payload, false);
  assert.equal(noBasic.status, 401);
  const wrongOrigin = await backend.request('/api/command', payload, true, { Origin: 'https://outside.invalid' });
  assert.equal(wrongOrigin.status, 403);
  const fallback = await backend.request('/api/command', payload);
  assert.equal(fallback.status, 200);
  assert.equal((await backend.request('/api/state')).body.slideIndex, 1);
  const writeState = await backend.request('/api/state', { clientId: 'pending-http', presentation: presentation('Q'), slideIndex: 0 });
  assert.equal(writeState.status, 200);
  assert.equal((await backend.request('/api/state')).body.presentation.id, 'Q');
  const display = await backend.request('/api/display-telemetry', { type: 'DISPLAY_TELEMETRY',
    clientId: 'pending-http', origin: 'control', backgroundLock: true,
    lockedBackgroundValue: '/synthetic.svg', userSelectedBackground: null });
  assert.equal(display.status, 200);
  assert.equal((await backend.request('/api/state')).body.backgroundLock, true);
  return { wsPending: 'rejected', anonymousHttp: noBasic.status, foreignOrigin: wrongOrigin.status,
    pendingHttpCommand: fallback.status, appliedSlide: 1, pendingHttpState: writeState.status,
    appliedPresentation: 'Q', pendingHttpDisplayTelemetry: display.status, backgroundLock: true };
};

cases.M03 = async backend => {
  const base = [presentation('A', 'A0'), presentation('B', 'B0')];
  assert.equal((await backend.request('/api/presentations', base)).status, 200);
  const first = await backend.request('/api/presentations');
  const second = await backend.request('/api/presentations');
  first.body[0].title = 'A1'; second.body[1].title = 'B1';
  const saveA = await backend.request('/api/presentations', first.body);
  const saveB = await backend.request('/api/presentations', second.body);
  assert.equal(saveA.status, 200); assert.equal(saveB.status, 200);
  const final = (await backend.request('/api/presentations')).body.map(value => value.title);
  const backup = JSON.parse(await readFile(path.join(backend.data, 'presentations.json.bak'), 'utf8')).map(value => value.title);
  assert.deepEqual(final, ['A0', 'B1']); assert.deepEqual(backup, ['A1', 'B0']);
  return { initial: ['A0', 'B0'], firstWrite: ['A1', 'B0'], secondWrite: ['A0', 'B1'],
    statusCodes: [saveA.status, saveB.status], final, backup, etag: first.headers.etag ?? null };
};

cases.H03 = async backend => {
  const principal = await backend.connect('control');
  const pending = await backend.connect('control');
  const audience = await backend.connect('audience');
  const key = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('spki', key.publicKey)).toString('base64');
  principal.send({ type: 'LIVE_AUDIO_CONTROL_PUBLIC_KEY', controlSessionId: principal.welcome.controlSessionId,
    keyId: 'astra-public-key', publicKey });
  const advertised = await audience.wait(value => value.type === 'LIVE_AUDIO_CONTROL_PUBLIC_KEY');
  assert.equal(advertised.controlSessionId, principal.welcome.controlSessionId);
  const token = await backend.request('/api/livekit/token', { role: 'audience' }, false);
  const pid = token.body.participantId;
  const moderate = (id, extraHeaders = {}, role = 'control') => backend.request('/api/livekit/grant-speak',
    { role, controlSessionId: id, participantId: pid }, false, extraHeaders);
  const outcomes = [];
  for (const [actor, id, expected] of [
    ['anonymous/no ID', undefined, 403], ['unknown ID', 'control-not-existing', 403],
    ['pending ID', pending.welcome.controlSessionId, 403], ['public authorized ID', advertised.controlSessionId, 200],
  ]) {
    const response = await moderate(id); assert.equal(response.status, expected);
    outcomes.push({ actor, status: response.status });
  }
  assert.equal((await moderate(advertised.controlSessionId, {}, 'audience')).status, 403);
  assert.equal((await moderate(advertised.controlSessionId, { Origin: backend.base })).status, 200);
  assert.equal((await moderate(advertised.controlSessionId, { Origin: 'https://outside.invalid' })).status, 403);
  const before = pending.inbox.length;
  principal.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION',
    targetControlSessionId: pending.welcome.controlSessionId, decision: 'APPROVE' });
  await pending.wait(value => value.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE' && value.controlState === 'AUTHORIZED', before);
  assert.equal((await moderate(pending.welcome.controlSessionId)).status, 200);
  pending.socket.close(); await once(pending.socket, 'close'); await pause(30);
  assert.equal((await moderate(pending.welcome.controlSessionId)).status, 403);
  const rejected = await backend.connect('control');
  principal.send({ type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION',
    targetControlSessionId: rejected.welcome.controlSessionId, decision: 'REJECT' });
  await once(rejected.socket, 'close');
  assert.equal((await moderate(rejected.welcome.controlSessionId)).status, 403);
  principal.send(command({ command: 'RESET_STATE', clearSession: true, hardRefresh: false }));
  await principal.wait(value => value.type === 'PRESENTATION_SESSION_ROTATED');
  assert.equal((await moderate(advertised.controlSessionId)).status, 403);
  const adminCalls = backend.messages.filter(value => value.kind === 'sdk');
  assert.equal(adminCalls.length, 3);
  return { outcomes, correctOrigin: 200, wrongOrigin: 403, literalAudienceRole: 403,
    approvedSecondary: 200, closedAuthorizedId: 403, rejectedId: 403, preRotationId: 403,
    sdkCalls: adminCalls.length, authenticationSentByCaller: false };
};

for (const hardRefresh of [false, true]) {
  cases[`M01-${hardRefresh ? 'hard' : 'soft'}`] = async backend => {
    const control = await backend.connect('control');
    const id = control.welcome.controlSessionId;
    const start = control.inbox.length;
    control.send(command({ command: 'RESET_STATE', clearSession: true, hardRefresh }));
    const rotation = await control.wait(value => value.type === 'PRESENTATION_SESSION_ROTATED', start);
    assert.equal(rotation.hardRefresh, hardRefresh);
    assert.equal(control.socket.readyState, WebSocket.OPEN);
    control.send(command({ command: 'TOGGLE_BG_LOCK', locked: true }));
    await control.wait(value => value.code === 'CONTROL_PENDING_FORBIDDEN', start);
    assert.equal(control.inbox.slice(start).filter(value => value.type === 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE').length, 0);
    control.socket.close(); await once(control.socket, 'close');
    const reentered = await backend.connect('control');
    assert.notEqual(reentered.welcome.controlSessionId, id);
    assert.equal(reentered.welcome.controlState, 'PRINCIPAL');
    reentered.send(command({ command: 'TOGGLE_BG_LOCK', locked: true }));
    reentered.send({ type: 'SERVER_TIME_PING', clientSentAtMs: 70 });
    await reentered.wait(value => value.type === 'SERVER_TIME_PONG');
    assert.equal((await backend.request('/api/state')).body.backgroundLock, true);
    return { hardRefresh, oldSocketRemainsOpen: true, oldAuthority: 'rejected', authorizationNotice: false,
      simulatedBrowserReentry: 'new principal accepted', clientReloadExecution: 'tested separately by code path' };
  };
}
cases['M01-http'] = async backend => {
  const control = await backend.connect('control');
  const before = (await backend.request('/api/audience/access/bootstrap', {}, false)).body.presentationSessionId;
  assert.equal((await backend.request('/api/command', command({ command: 'RESET_STATE', clearSession: true, hardRefresh: true }))).status, 200);
  const after = (await backend.request('/api/audience/access/bootstrap', {}, false)).body.presentationSessionId;
  assert.equal(after, before);
  control.send(command({ command: 'TOGGLE_BG_LOCK', locked: true }));
  control.send({ type: 'SERVER_TIME_PING', clientSentAtMs: 71 });
  await control.wait(value => value.type === 'SERVER_TIME_PONG');
  assert.equal((await backend.request('/api/state')).body.backgroundLock, true);
  return { httpReset: 200, sessionRotated: false, subsequentWsCommand: 'accepted' };
};

cases['H02-controlled'] = async backend => {
  const principal = await backend.connect('control');
  const listener = await backend.connect('audience');
  const access = (await backend.request('/api/audience/access/bootstrap', {}, false)).body;
  assert.equal((await backend.request('/api/livekit/token', { role: 'audience' }, false)).status, 403);
  listener.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
  await listener.wait(value => value.type === 'AUDIENCE_ACCESS_STATE');
  principal.send({ type: 'AUDIENCE_ACCESS_DECISION', participantId: access.participantId, decision: 'ADMIT' });
  await listener.wait(value => value.type === 'AUDIENCE_ACCESS_STATE' && value.accessState === 'ADMITTED');
  const issued = (await backend.request('/api/livekit/token', { role: 'audience', audienceAccessCredential: access.credential }, false)).body;
  assert.equal((await verifier.verify(issued.token)).video.canPublish, false);
  listener.send({ type: 'LIVE_AUDIO_PARTICIPANT_STATUS', participantId: issued.participantId,
    role: 'audience', speakerState: 'GRANTED', canPublishAudio: true, canSubscribe: true, isMuted: false });
  listener.send({ type: 'SERVER_TIME_PING', clientSentAtMs: 101 });
  await listener.wait(value => value.type === 'SERVER_TIME_PONG');
  const response = await backend.request('/api/livekit/refresh-token', {
    participantId: issued.participantId, refreshCredential: issued.refreshCredential,
    audienceAccessCredential: access.credential,
  }, false);
  assert.equal(response.status, 200);
  assert.equal((await verifier.verify(response.body.token)).video.canPublish, true);
  return { unadmittedToken: 403, admissionRequired: true, initialCanPublish: false,
    selfReportedGrantSigned: true, controlGrantedSpeech: false };
};

cases.M05 = async backend => {
  const maps = [{ id: 'map-a', name: 'old', audioSrc: '/audio/synthetic.mp3', presentationId: 'P',
    defaultSyncMode: 'bilateral', defaultVolume: 1, cues: [{ timeSec: 0, slideIndex: 0 }] }];
  assert.equal((await backend.request('/api/audio-sync', maps)).status, 200);
  const staleClient = (await backend.request('/api/audio-sync')).body;
  const streamAbort = new AbortController();
  const stream = await fetch(backend.base + '/api/state-events', { headers: { Authorization: basic }, signal: streamAbort.signal });
  const reader = stream.body.getReader();
  let data = '';
  const readLoop = (async () => { try { while (true) { const next = await reader.read(); if (next.done) break; data += new TextDecoder().decode(next.value); } } catch {} })();
  try {
    const edited = structuredClone(maps); edited[0].name = 'new'; edited[0].cues[0].slideIndex = 1;
    assert.equal((await backend.request('/api/audio-sync', edited)).status, 200);
    assert.equal((await backend.request('/api/audio-sync')).body[0].name, 'new');
    await backend.request('/api/command', command({ command: 'SELECT_PRESENTATION_AND_SLIDE', presentation: presentation('barrier'), slideIndex: 0 }));
    await backend.until(() => data.includes('barrier'));
    assert.equal(data.includes('AUDIO_SYNC_MAPS_UPDATE'), false);
    staleClient[0].name = 'name changed on stale client';
    assert.equal((await backend.request('/api/audio-sync', staleClient)).status, 200);
    const final = (await backend.request('/api/audio-sync')).body[0];
    assert.equal(final.cues[0].slideIndex, 0);
    return { getSeesNewMaps: true, sseBarrierObserved: true, mapUpdateEvent: false,
      staleSaveAccepted: true, overwrittenCue: final.cues[0].slideIndex };
  } finally { streamAbort.abort(); await readLoop; }
};

cases['omissions-access'] = async backend => {
  const control = await backend.connect('control');
  const listener = await backend.connect('audience');
  const access = (await backend.request('/api/audience/access/bootstrap', {}, false)).body;
  const bearer = { Authorization: `Bearer ${access.credential}` };
  assert.equal((await backend.request('/api/audience/state', undefined, false)).status, 401);
  assert.equal((await backend.request('/api/audience/sse-ticket', { purpose: 'STATE' }, false, bearer)).status, 401);
  listener.send({ type: 'AUDIENCE_ACCESS_BIND', credential: access.credential });
  await listener.wait(value => value.type === 'AUDIENCE_ACCESS_STATE');
  control.send({ type: 'AUDIENCE_ACCESS_DECISION', participantId: access.participantId, decision: 'ADMIT' });
  await listener.wait(value => value.type === 'AUDIENCE_ACCESS_STATE' && value.accessState === 'ADMITTED');
  assert.equal((await backend.request('/api/audience/state', undefined, false, bearer)).status, 200);
  const issue = async () => (await backend.request('/api/audience/sse-ticket', { purpose: 'STATE' }, false, bearer)).body.ticket;
  const openStream = async url => {
    const abort = new AbortController();
    try {
      const response = await fetch(backend.base + url, { signal: abort.signal });
      return response.status;
    } finally { abort.abort(); }
  };
  const ticket = await issue();
  assert.equal(await openStream(`/api/audience/events?ticket=${ticket}`), 200);
  assert.equal(await openStream(`/api/audience/events?ticket=${ticket}`), 401);
  const wrongPurpose = await issue();
  assert.equal(await openStream(`/api/quiz-events?ticket=${wrongPurpose}`), 401);
  const beforeBlock = await issue();
  control.send({ type: 'AUDIENCE_ACCESS_DECISION', participantId: access.participantId, decision: 'BLOCK' });
  await listener.wait(value => value.type === 'AUDIENCE_ACCESS_STATE' && value.accessState === 'BLOCKED');
  assert.equal(await openStream(`/api/audience/events?ticket=${beforeBlock}`), 401);
  assert.equal((await backend.request('/api/audience/state', undefined, false, bearer)).status, 401);
  return { anonymousSnapshot: 401, pendingTicket: 401, admittedSnapshot: 200,
    initialTicket: 200, reusedTicket: 401, wrongPurpose: 401, ticketAfterBlock: 401, blockedSnapshot: 401 };
};

const selected = process.argv.slice(2);
for (const name of selected.length ? selected : Object.keys(cases)) {
  assert.ok(cases[name], `Unknown scenario ${name}`);
  await runCase(name, cases[name], ['H02-controlled', 'omissions-access'].includes(name) ? 'CONTROLLED' : 'PUBLIC');
}
