const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createRemote } = require('../src/main/remote/remote.js');
const { encodeBinary, decodeBinary, KIND } = require('../src/main/remote/remote-codec.js');

let root, modelDir, wss, port;
let serverSocket = null;
let received = [];
let authHeaders = [];

async function waitFor(pred, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting for condition');
}

function jsonFrames() { return received.filter((m) => !m.binary).map((m) => m.msg); }
function binaryFrames() { return received.filter((m) => m.binary).map((m) => m.frame); }

function fakeAppCore() {
  let cfg = { model: { modelDir } };
  const sinks = new Set();
  const calls = [];
  return {
    calls,
    readConfig: () => JSON.parse(JSON.stringify(cfg)),
    writeConfig: (c) => { cfg = JSON.parse(JSON.stringify(c)); },
    findModel3: (dir) => (dir ? { absDir: dir, fileName: 'Haru.model3.json' } : null),
    registerSink: (s) => { sinks.add(s); return () => sinks.delete(s); },
    pushEvent: (ch, data, opts) => { for (const s of sinks) if (s.isAlive()) s.send(ch, data, opts); },
    handleChatSend: (a) => { calls.push(['chat', a]); },
    handleTtsStop: () => { calls.push(['tts:stop']); },
    handleSttReady: () => ({ available: true }),
    handleSttStart: (a, session) => { calls.push(['stt:start', a, session]); return true; },
    handleSttStop: (session) => { calls.push(['stt:stop', session]); },
    handleSttAudioChunk: (buf, session) => { calls.push(['mic', buf.byteLength, session]); },
  };
}

function memoryTokens() {
  return { token: null, get() { return this.token; }, set(t) { this.token = t; }, clear() { this.token = null; } };
}

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuro-remote-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html><head></head><body></body></html>');
  fs.writeFileSync(path.join(root, 'web-api.js'), 'bridge');
  modelDir = path.join(root, 'model');
  fs.mkdirSync(modelDir);
  fs.writeFileSync(path.join(modelDir, 'Haru.model3.json'), '{"Version":3}');

  wss = new WebSocketServer({ port: 0 });
  port = wss.address().port;
  wss.on('connection', (ws, req) => {
    serverSocket = ws;
    authHeaders.push(req.headers.authorization);
    ws.on('message', (data, isBinary) => {
      if (isBinary) { received.push({ binary: true, frame: decodeBinary(data) }); return; }
      const msg = JSON.parse(data.toString());
      received.push({ binary: false, msg });
      if (msg.t === 'hello') ws.send(JSON.stringify({ t: 'welcome', deviceId: 'd1', username: 'henry', clients: ['c1'] }));
    });
  });
});

after(() => {
  wss.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('bind → link → relay (allowlist, sink routing, mic, tunnel) → revoked by server', async () => {
  const appCore = fakeAppCore();
  const tokens = memoryTokens();
  let polls = 0;
  const fetchImpl = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (url.endsWith('/api/pair/start')) {
      assert.equal(body.deviceName, 'Test PC');
      return jsonResponse(200, { pairingId: 'p1', pollSecret: 's1', userCode: 'KURO-AAAA-BBBB', verificationUri: 'https://kuro.example/bind', expiresIn: 600, interval: 1 });
    }
    if (url.endsWith('/api/pair/poll')) {
      polls++;
      return polls < 2
        ? jsonResponse(200, { status: 'pending' })
        : jsonResponse(200, { status: 'complete', deviceId: 'd1', deviceToken: 'kdt_secret', username: 'henry' });
    }
    throw new Error(`unexpected ${url}`);
  };

  const remote = createRemote({
    appCore, tokenStore: tokens, appVersion: '9.9.9',
    webRoot: root, webApiPath: path.join(root, 'web-api.js'),
    serverUrl: 'https://kuro.example', wsUrl: `ws://127.0.0.1:${port}`, fetchImpl,
  });

  assert.equal(remote.getStatus().state, 'unbound');
  const started = await remote.bind({ deviceName: 'Test PC' });
  assert.equal(started.ok, true);
  assert.equal(remote.getStatus().state, 'pairing');
  assert.equal(remote.getStatus().pairing.userCode, 'KURO-AAAA-BBBB');

  await waitFor(() => remote.getStatus().state === 'online');
  assert.equal(tokens.get(), 'kdt_secret');
  assert.equal(authHeaders.at(-1), 'Bearer kdt_secret');
  assert.deepEqual(jsonFrames()[0], { t: 'hello', protocol: 1, appVersion: '9.9.9', deviceName: 'Test PC' });
  assert.equal(remote.getStatus().username, 'henry');
  assert.equal(remote.getStatus().clients, 1);

  const send = (obj) => serverSocket.send(JSON.stringify(obj));
  const resultFor = (id) => waitFor(() => jsonFrames().find((m) => m.t === 'result' && m.id === id));

  // Allowed invoke
  send({ t: 'invoke', id: 1, ch: 'chat:builtin-send', args: { text: 'hi' }, from: 'c1' });
  assert.deepEqual(await resultFor(1), { t: 'result', id: 1, to: 'c1', ok: true, value: null });
  assert.deepEqual(appCore.calls.find((c) => c[0] === 'chat'), ['chat', { text: 'hi' }]);

  // Settings / secrets are never reachable remotely
  for (const [id, ch] of [[2, 'get-config'], [3, 'save-config'], [4, 'copilot:login'], [5, 'remote:unbind'], [6, 'tts:volume']]) {
    send({ t: 'invoke', id, ch, args: {}, from: 'c1' });
    const r = await resultFor(id);
    assert.equal(r.ok, false, ch);
    assert.equal(r.error, 'not_allowed', ch);
  }

  send({ t: 'invoke', id: 7, ch: 'app:bootstrap', from: 'c1' });
  assert.deepEqual((await resultFor(7)).value, { modelUrl: 'model/Haru.model3.json', sttAvailable: true, appVersion: '9.9.9' });

  send({ t: 'invoke', id: 8, ch: 'stt:start', args: { sampleRate: 48000 }, from: 'c1' });
  await resultFor(8);
  assert.deepEqual(appCore.calls.find((c) => c[0] === 'stt:start'), ['stt:start', { sampleRate: 16000, format: 's16' }, 'remote:c1']);

  // Mic audio (binary kind 2) goes to the client's own STT session
  serverSocket.send(encodeBinary(KIND.MIC_AUDIO, 'c1', Buffer.alloc(6)));
  await waitFor(() => appCore.calls.find((c) => c[0] === 'mic'));
  assert.deepEqual(appCore.calls.find((c) => c[0] === 'mic'), ['mic', 6, 'remote:c1']);

  // Push events: allowlisted broadcast, binary TTS, targeted VAD; local-only stays local
  appCore.pushEvent('copilot:login-code', { userCode: 'X' });
  appCore.pushEvent('stt:vad-state', { state: 'speech' }, { to: 'local' });
  appCore.pushEvent('chat:stream:data', { chunk: 'yo' });
  appCore.pushEvent('stt:vad-state', { state: 'speech' }, { to: 'remote:c1' });
  appCore.pushEvent('tts:chunk', { data: new Uint8Array([1, 2, 3]) });
  await waitFor(() => binaryFrames().some((f) => f.kind === KIND.TTS_AUDIO));
  const events = jsonFrames().filter((m) => m.t === 'event');
  assert.deepEqual(events, [
    { t: 'event', ch: 'chat:stream:data', data: { chunk: 'yo' } },
    { t: 'event', ch: 'stt:vad-state', data: { state: 'speech' }, to: 'c1' },
  ]);
  const tts = binaryFrames().find((f) => f.kind === KIND.TTS_AUDIO);
  assert.equal(tts.id, '');
  assert.deepEqual([...tts.payload], [1, 2, 3]);

  // Tunnel request
  send({ t: 'http', reqId: 'r1', path: 'model/Haru.model3.json' });
  await waitFor(() => jsonFrames().find((m) => m.t === 'http-end' && m.reqId === 'r1'));
  const head = jsonFrames().find((m) => m.t === 'http-res' && m.reqId === 'r1');
  assert.equal(head.status, 200);
  const body = Buffer.concat(binaryFrames().filter((f) => f.kind === KIND.TUNNEL_BODY && f.id === 'r1').map((f) => f.payload));
  assert.equal(body.toString(), '{"Version":3}');
  send({ t: 'http', reqId: 'r2', path: '../index.html' });
  assert.equal((await waitFor(() => jsonFrames().find((m) => m.t === 'http-res' && m.reqId === 'r2'))).status, 404);

  // A leaving client's mic session is stopped
  send({ t: 'client-leave', clientId: 'c1' });
  await waitFor(() => appCore.calls.find((c) => c[0] === 'stt:stop'));
  assert.deepEqual(appCore.calls.find((c) => c[0] === 'stt:stop'), ['stt:stop', 'remote:c1']);

  // Server-side unbind → device clears its token
  serverSocket.close(4401, 'unbound');
  await waitFor(() => remote.getStatus().state === 'unbound');
  assert.equal(tokens.get(), null);
  assert.equal(remote.getStatus().username, null);
  assert.match(remote.getStatus().error, /unbound/i);

  remote.dispose();
});

test('unbind from the PC calls the server and clears the binding; network errors keep it', async () => {
  const appCore = fakeAppCore();
  const tokens = memoryTokens();
  tokens.set('kdt_existing');
  let fail = true;
  const fetchImpl = async (url, opts) => {
    assert.ok(url.endsWith('/api/device/self'));
    assert.equal(opts.method, 'DELETE');
    assert.equal(opts.headers.Authorization, 'Bearer kdt_existing');
    if (fail) throw new TypeError('fetch failed');
    return new Response(null, { status: 204 });
  };
  const remote = createRemote({
    appCore, tokenStore: tokens, appVersion: '1.0.0',
    webRoot: root, webApiPath: path.join(root, 'web-api.js'),
    serverUrl: 'https://kuro.example', wsUrl: `ws://127.0.0.1:${port}`, fetchImpl,
  });
  await waitFor(() => remote.getStatus().state === 'online');

  const failed = await remote.unbind();
  assert.equal(failed.ok, false);
  assert.equal(tokens.get(), 'kdt_existing');

  fail = false;
  assert.deepEqual(await remote.unbind(), { ok: true });
  assert.equal(tokens.get(), null);
  assert.equal(remote.getStatus().state, 'unbound');
  remote.dispose();
});
