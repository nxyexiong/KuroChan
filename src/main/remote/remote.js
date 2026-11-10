/**
 * remote.js — remote access facade (main process).
 *
 * Binds this PC to an account on kurochan-server (device-code pairing started
 * here), keeps the outbound device link alive, and acts as one more app-core
 * push sink so remote browsers stay in sync with the desktop window.
 *
 * Remote clients are restricted by remote-policy.js; the web app itself is
 * served to them through the tunnel (remote-tunnel.js).
 *
 * Status `state`: unbound | pairing | connecting | online | offline | error
 */
const os = require('os');

const { REMOTE_SERVER, REMOTE_WS_DEVICE, REMOTE_PROTOCOL } = require('./remote-config.js');
const { RemoteApiError, startPairing, pollPairing, unbindSelf, createTokenStore } = require('./remote-auth.js');
const { RemoteLink } = require('./remote-link.js');
const { createTunnel, CHUNK_SIZE } = require('./remote-tunnel.js');
const { KIND } = require('./remote-codec.js');
const { REMOTE_EVENTS, remoteSession, createRemoteInvokeHandlers } = require('./remote-policy.js');

const FATAL_MESSAGES = {
  disabled:         'Your account is disabled.',
  replaced:         'This device connected from another KuroChan instance.',
  upgrade_required: 'The server requires a newer version of KuroChan.',
};

const MAX_DEVICE_NAME = 64;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function describeError(err) {
  if (err instanceof RemoteApiError) return err.message;
  return (err && err.message) ? `Could not reach the server (${err.message})` : 'Could not reach the server';
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * @param {{
 *   appCore: object,
 *   safeStorage?: import('electron').SafeStorage,
 *   tokenStore?: { get():string|null, set(t:string):void, clear():void },
 *   tokenPath?: string,
 *   appVersion: string,
 *   webRoot: string,
 *   webApiPath: string,
 *   serverUrl?: string,
 *   wsUrl?: string,
 *   fetchImpl?: typeof fetch,
 *   wsOptions?: object,
 * }} deps
 */
function createRemote(deps) {
  const {
    appCore, appVersion, webRoot, webApiPath,
    serverUrl = REMOTE_SERVER, wsUrl = REMOTE_WS_DEVICE,
    fetchImpl = (...a) => fetch(...a), wsOptions = {},
  } = deps;
  const tokens = deps.tokenStore || createTokenStore({ safeStorage: deps.safeStorage, filePath: deps.tokenPath });
  const apiOpts = { fetchImpl };

  let state = 'unbound';
  let lastError = null;
  let pairing = null;          // { userCode, verificationUri, expiresAt, cancelled }
  let link = null;
  const clients = new Set();

  // ── config helpers ──────────────────────────────────────────────────────
  function remoteConfig() { return appCore.readConfig().remote || {}; }

  function updateRemoteConfig(patch) {
    const cfg = appCore.readConfig();
    const next = { ...(cfg.remote || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null) delete next[k];
    cfg.remote = next;
    appCore.writeConfig(cfg);
  }

  function currentDeviceName() {
    const n = (remoteConfig().deviceName || '').trim();
    return (n || os.hostname() || 'KuroChan PC').slice(0, MAX_DEVICE_NAME);
  }

  function hello() {
    return { protocol: REMOTE_PROTOCOL, appVersion, deviceName: currentDeviceName() };
  }

  // ── status ──────────────────────────────────────────────────────────────
  function getStatus() {
    const rc = remoteConfig();
    return {
      state,
      server: new URL(serverUrl).host,
      deviceName: currentDeviceName(),
      username: rc.username || null,
      pairing: pairing ? { userCode: pairing.userCode, verificationUri: pairing.verificationUri, expiresAt: pairing.expiresAt } : null,
      clients: clients.size,
      error: lastError,
    };
  }

  function emitStatus() {
    appCore.pushEvent('remote:status-changed', getStatus(), { to: 'local' });
  }

  function setState(next) {
    state = next;
    emitStatus();
  }

  // ── remote STT sessions ─────────────────────────────────────────────────
  function stopClientSession(clientId) {
    try { appCore.handleSttStop(remoteSession(clientId)); } catch { /* ignore */ }
  }

  function dropAllClients() {
    for (const id of clients) stopClientSession(id);
    clients.clear();
  }

  // ── web app bootstrap + tunnel ──────────────────────────────────────────
  function currentModel() {
    const cfg = appCore.readConfig();
    return appCore.findModel3(cfg.model && cfg.model.modelDir);
  }

  function getBootstrap() {
    const model = currentModel();
    return {
      modelUrl: model ? `model/${encodeURIComponent(model.fileName)}` : null,
      sttAvailable: !!(appCore.handleSttReady() || {}).available,
      appVersion,
    };
  }

  const tunnel = createTunnel({
    webRoot,
    webApiPath,
    getModelDir: () => { const m = currentModel(); return m ? m.absDir : null; },
  });
  const invokeHandlers = createRemoteInvokeHandlers({ appCore, getBootstrap });

  async function onHttp(msg) {
    const l = link;
    if (!l || !msg || typeof msg.reqId !== 'string') return;
    const { reqId } = msg;
    let res;
    try { res = await tunnel.open(msg.path, msg.ifNoneMatch); } catch { res = { status: 500 }; }
    if (!l.sendJSON({ t: 'http-res', reqId, status: res.status, etag: res.etag, size: res.size })) {
      if (res.stream) res.stream.destroy();
      return;
    }
    try {
      if (res.body) {
        for (let off = 0; off < res.body.length; off += CHUNK_SIZE) {
          await l.sendBinaryAsync(KIND.TUNNEL_BODY, reqId, res.body.subarray(off, off + CHUNK_SIZE));
        }
      } else if (res.stream) {
        for await (const chunk of res.stream) await l.sendBinaryAsync(KIND.TUNNEL_BODY, reqId, chunk);
      }
      l.sendJSON({ t: 'http-end', reqId });
    } catch {
      if (res.stream) res.stream.destroy();
      l.sendJSON({ t: 'http-end', reqId, error: 'read_failed' });
    }
  }

  function onInvoke(msg) {
    const l = link;
    if (!l || !msg) return;
    const { id, ch, args, from } = msg;
    const reply = (ok, payload) => l.sendJSON(ok
      ? { t: 'result', id, to: from, ok: true, value: payload === undefined ? null : payload }
      : { t: 'result', id, to: from, ok: false, error: payload });
    const fn = Object.prototype.hasOwnProperty.call(invokeHandlers, ch) ? invokeHandlers[ch] : null;
    if (!fn || typeof from !== 'string' || !from) { reply(false, 'not_allowed'); return; }
    Promise.resolve()
      .then(() => fn(args, { clientId: from }))
      .then((value) => reply(true, value), (err) => reply(false, (err && err.message) || String(err)));
  }

  function onBinary(frame) {
    if (frame.kind !== KIND.MIC_AUDIO || !frame.id) return;
    const payload = frame.payload.length % 2 ? frame.payload.subarray(0, frame.payload.length - 1) : frame.payload;
    appCore.handleSttAudioChunk(toArrayBuffer(payload), remoteSession(frame.id));
  }

  // ── link lifecycle ──────────────────────────────────────────────────────
  function stopLink() {
    if (link) { link.removeAllListeners(); link.stop(); link = null; }
    dropAllClients();
  }

  function startLink() {
    stopLink();
    const token = tokens.get();
    if (!token) { setState('unbound'); return; }
    const l = new RemoteLink({ url: wsUrl, token, hello: hello(), wsOptions });
    link = l;
    l.on('state', (s) => {
      if (s !== 'online') dropAllClients();
      if (s === 'online') lastError = null;
      setState(s);
    });
    l.on('welcome', (msg) => {
      dropAllClients();
      for (const id of (msg.clients || [])) clients.add(id);
      if (msg.username || msg.deviceId) updateRemoteConfig({ username: msg.username, deviceId: msg.deviceId });
      emitStatus();
    });
    l.on('client-join', (id) => { if (id) { clients.add(id); emitStatus(); } });
    l.on('client-leave', (id) => { clients.delete(id); stopClientSession(id); emitStatus(); });
    l.on('invoke', onInvoke);
    l.on('http', (msg) => { onHttp(msg).catch(() => {}); });
    l.on('binary', onBinary);
    l.on('fatal', (reason) => {
      if (link !== l) return;
      if (reason === 'unbound') { clearBinding('This device was unbound on the server.'); return; }
      stopLink();
      lastError = FATAL_MESSAGES[reason] || 'Disconnected by the server.';
      setState('error');
    });
    l.start();
  }

  function clearBinding(error) {
    stopLink();
    tokens.clear();
    updateRemoteConfig({ deviceId: undefined, username: undefined });
    lastError = error;
    setState('unbound');
  }

  // ── pairing ─────────────────────────────────────────────────────────────
  function finishPairing(p, error) {
    if (pairing !== p) return;
    pairing = null;
    lastError = error;
    setState('unbound');
  }

  async function pollUntilDone(p, start) {
    const interval = Math.max(1, Number(start.interval) || 3) * 1000;
    while (!p.cancelled) {
      await sleep(interval);
      if (p.cancelled) return;
      if (Date.now() > p.expiresAt) { finishPairing(p, 'The binding code expired. Try again.'); return; }
      let r;
      try {
        r = await pollPairing(serverUrl, { pairingId: start.pairingId, pollSecret: start.pollSecret }, apiOpts);
      } catch (err) {
        if (p.cancelled) return;
        if (err instanceof RemoteApiError) {
          if (err.status === 410) { finishPairing(p, 'The binding code expired. Try again.'); return; }
          if (err.status === 409) { finishPairing(p, 'This account already has a device bound. Unbind it first.'); return; }
          if (err.status === 404) { finishPairing(p, 'Binding failed. Try again.'); return; }
        }
        continue; // transient (network / 5xx / rate limit): keep polling until expiry
      }
      if (p.cancelled) return;
      if (r && r.status === 'complete' && r.deviceToken) {
        try { tokens.set(r.deviceToken); } catch (err) { finishPairing(p, err.message); return; }
        updateRemoteConfig({ deviceId: r.deviceId, username: r.username });
        pairing = null;
        lastError = null;
        startLink();
        return;
      }
    }
  }

  async function bind({ deviceName } = {}) {
    if (tokens.get()) return { ok: false, error: 'Already bound. Unbind first.' };
    if (pairing) return { ok: false, error: 'Binding is already in progress.' };
    const name = String(deviceName || '').trim().slice(0, MAX_DEVICE_NAME);
    if (name) updateRemoteConfig({ deviceName: name });

    let start;
    try {
      start = await startPairing(serverUrl, { deviceName: currentDeviceName(), appVersion }, apiOpts);
    } catch (err) {
      lastError = describeError(err);
      emitStatus();
      return { ok: false, error: lastError };
    }
    const p = {
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresAt: Date.now() + (Number(start.expiresIn) || 600) * 1000,
      cancelled: false,
    };
    pairing = p;
    lastError = null;
    setState('pairing');
    pollUntilDone(p, start).catch(() => finishPairing(p, 'Binding failed. Try again.'));
    return { ok: true, userCode: p.userCode, verificationUri: p.verificationUri, expiresAt: p.expiresAt };
  }

  function cancelBind() {
    if (pairing) {
      pairing.cancelled = true;
      pairing = null;
      lastError = null;
      setState('unbound');
    }
    return { ok: true };
  }

  async function unbind() {
    cancelBind();
    const token = tokens.get();
    if (token) {
      try {
        await unbindSelf(serverUrl, token, apiOpts);
      } catch (err) {
        // 401: the server no longer knows this token — already unbound there.
        if (!(err instanceof RemoteApiError && err.status === 401)) {
          return { ok: false, error: describeError(err) };
        }
      }
    }
    clearBinding(null);
    return { ok: true };
  }

  /** Re-announce the device (new name) to the server. */
  function onDeviceNameChanged() {
    if (link) { link.setHello(hello()); link.reconnect(); }
    emitStatus();
  }

  // ── app-core sink: mirror allowlisted events to remote clients ─────────
  const unregisterSink = appCore.registerSink({
    isAlive: () => !!(link && link.isOpen()),
    reload: () => { if (link) link.sendJSON({ t: 'event', ch: 'app:reload', data: {} }); },
    send: (channel, data, opts) => {
      if (!link || !REMOTE_EVENTS.has(channel)) return;
      let to = '';
      if (opts && opts.to) {
        if (!String(opts.to).startsWith('remote:')) return;
        to = String(opts.to).slice('remote:'.length);
      }
      if (channel === 'tts:chunk') {
        if (data && data.data) link.sendBinary(KIND.TTS_AUDIO, to, data.data, { droppable: true });
        return;
      }
      link.sendJSON(to ? { t: 'event', ch: channel, data, to } : { t: 'event', ch: channel, data });
    },
  });

  function dispose() {
    cancelBind();
    stopLink();
    unregisterSink();
  }

  if (tokens.get()) startLink();

  return { getStatus, bind, cancelBind, unbind, onDeviceNameChanged, dispose };
}

module.exports = { createRemote };
