/**
 * web-api.js — browser-side implementation of the `window.kuroBackend` contract
 * over WebSocket. Served verbatim (NOT webpack-bundled) and loaded before the
 * renderer bundle, exactly where preload.js sits in desktop mode.
 *
 * It mirrors src/main/preload.js method-for-method so the renderer is identical
 * in both hosts. Host-specific concerns are hidden here:
 *   - model asset URLs  → resolveModelDir returns a same-origin https URL
 *   - global cursor      → synthesized from the browser's pointermove
 *   - mic hotkey         → synthesized from Ctrl/Cmd+M
 *   - save → reload      → server broadcasts app:reload → location.reload()
 *   - binary tts:chunk   → base64 on the wire, decoded back to a Uint8Array here
 *   - window controls    → capabilities.windowControls = false
 *
 * The object is created SYNCHRONOUSLY (with an outbound queue) so it exists the
 * moment the bundle runs, even before the socket has opened.
 *
 * Two hosts load this file:
 *   - LAN web companion (src/main/web/server.js): full app over `/ws`.
 *   - Remote access via kurochan-server (`<script data-mode="remote">`, injected
 *     by src/main/remote/remote-tunnel.js): relay protocol over `/ws/client`.
 *     Remote browsers can chat / talk but not change settings (binding only):
 *       - mic audio is resampled here to 16 kHz Int16 (binary kind 2)
 *       - TTS audio arrives as binary kind 1
 *       - lip sync is driven locally from this browser's own playback volume
 *       - presence / close codes drive offline, /bind and /login redirects
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var REMOTE = !!(script && script.getAttribute('data-mode') === 'remote');

  var WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (REMOTE ? '/ws/client' : '/ws');

  // ── Web-host presentation (web only; runs before the shared renderer bundle) ──
  // Mark the document as web-hosted (`.web-host` CSS enlarges the UI for browsers
  // / phones), paint a dark backdrop immediately (the desktop app is transparent;
  // a browser would otherwise flash white), and LOCK page zoom so the fixed UI
  // (buttons, chat box) can't be pinch-zoomed and messed up on mobile. The Live2D
  // model stays zoomable/movable via its own canvas gestures (see model.js).
  try {
    var de = document.documentElement;
    de.classList.add('web-host');
    de.style.background = '#2b2b2b';
    if (document.body) document.body.style.background = '#2b2b2b';
    var vp = document.createElement('meta');
    vp.name = 'viewport';
    vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    document.head.appendChild(vp);
    // iOS Safari ignores user-scalable=no, so also veto its pinch gesture events.
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (g) {
      document.addEventListener(g, function (e) { e.preventDefault(); }, { passive: false });
    });
    // Kill the double-tap-to-zoom fallback without blocking taps/scroll.
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  } catch (e) { /* non-fatal */ }

  // ── Keep the phone screen awake (Screen Wake Lock API) ───────────────────────
  // So the mascot stays visible and TTS/voice keep working without the phone
  // dimming/locking. Supported on iOS Safari 16.4+ and Android Chrome; needs a
  // secure context (HTTPS — the server default). The lock auto-releases when the
  // tab is hidden, so we re-acquire on visibilitychange; some browsers only grant
  // it during a user gesture, so we also (re)try on the first tap/key. All
  // best-effort: any failure (older browser, low battery) is silently ignored.
  (function () {
    if (!('wakeLock' in navigator)) return;
    var sentinel = null;
    var requesting = false;
    function acquire() {
      if (requesting || sentinel || document.visibilityState !== 'visible') return;
      requesting = true;
      navigator.wakeLock.request('screen').then(function (s) {
        sentinel = s;
        requesting = false;
        s.addEventListener('release', function () { sentinel = null; });
      }).catch(function () { requesting = false; /* denied — ignore */ });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') acquire();
    });
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, acquire, { passive: true });
    });
    acquire(); // best-effort immediate attempt
  })();

  var ws = null;
  var connected = false;
  var outbox = [];          // frames queued until the socket opens
  var pending = new Map();  // invoke id -> { resolve, reject }
  var listeners = new Map();// channel -> [fn]
  var seq = 0;

  // ── transport ──────────────────────────────────────────────────────────────
  // LAN frames:    {t:'invoke', id, channel, arg} → {t:'res', id, ok, result|error}
  // Remote frames: {t:'invoke', id, ch, args}     → {t:'result', id, ok, value|error}
  function rawSend(text) {
    if (connected) { try { ws.send(text); } catch (e) { outbox.push(text); } }
    else outbox.push(text);
  }

  function invoke(channel, arg) {
    var id = ++seq;
    var frame = JSON.stringify(REMOTE
      ? { t: 'invoke', id: id, ch: channel, args: arg }
      : { t: 'invoke', id: id, channel: channel, arg: arg });
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      rawSend(frame);
    });
  }

  function sendMsg(channel, arg) {
    rawSend(JSON.stringify(REMOTE
      ? { t: 'send', ch: channel, args: arg }
      : { t: 'send', channel: channel, arg: arg }));
  }

  function sendBinary(arrayBuffer) {
    if (connected) { try { ws.send(arrayBuffer); } catch (e) { /* dropped audio frame — non-fatal */ } }
    // Dropped while disconnected: fine, audio is continuous and best-effort.
  }

  function on(channel, fn) {
    var arr = listeners.get(channel);
    if (!arr) { arr = []; listeners.set(channel, arr); }
    arr.push(fn);
  }

  function b64ToU8(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function dispatch(channel, data) {
    if (channel === 'app:reload') { location.reload(); return; }
    if (channel === 'tts:chunk' && data && data.b64) { data = { data: b64ToU8(data.b64) }; }
    var arr = listeners.get(channel);
    if (arr) for (var i = 0; i < arr.length; i++) {
      try { arr[i](data); } catch (e) { console.error('[kuroBackend] listener error:', e); }
    }
  }

  // ── remote: status overlay (offline PC / reconnecting) ───────────────────────
  var overlay = null;
  function showOverlay(text) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'remote-overlay';
      var st = overlay.style;
      st.position = 'fixed'; st.left = '0'; st.top = '0'; st.right = '0'; st.bottom = '0';
      st.display = 'flex'; st.alignItems = 'center'; st.justifyContent = 'center';
      st.background = 'rgba(20,20,20,0.82)'; st.color = '#eee'; st.zIndex = '10000';
      st.font = '16px system-ui, sans-serif'; st.textAlign = 'center'; st.padding = '24px';
      (document.body || document.documentElement).appendChild(overlay);
    }
    overlay.textContent = text;
    overlay.style.display = 'flex';
  }
  function hideOverlay() { if (overlay) overlay.style.display = 'none'; }

  // ── remote: mic resampler (Float32 @ device rate → Int16 @ 16 kHz) ───────────
  var MIC_KIND = 2, TTS_KIND = 1;
  var rs = { ratio: 1, pos: 0, prev: 0 };
  function resetResampler(srcRate) {
    rs.ratio = (srcRate > 0 ? srcRate : 48000) / 16000;
    rs.pos = 0;
    rs.prev = 0;
  }
  function resampleToS16(f32) {
    var n = f32.length;
    if (n === 0) return new Int16Array(0);
    var out = new Int16Array(Math.floor((n - rs.pos) / rs.ratio) + 2);
    var k = 0, p = rs.pos;
    while (p <= n - 1) {
      var v;
      if (p < 0) {
        v = rs.prev + (f32[0] - rs.prev) * (p + 1);
      } else {
        var i = Math.floor(p), t = p - i;
        var a = f32[i], b = (i + 1 < n) ? f32[i + 1] : a;
        v = a + (b - a) * t;
      }
      v = v < -1 ? -1 : (v > 1 ? 1 : v);
      out[k++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      p += rs.ratio;
    }
    rs.pos = p - n;
    rs.prev = f32[n - 1];
    return out.subarray(0, k);
  }
  function sendMicRemote(arrayBuffer) {
    var pcm = resampleToS16(new Float32Array(arrayBuffer));
    if (!pcm.length) return;
    var frame = new Uint8Array(2 + pcm.byteLength);
    frame[0] = MIC_KIND;
    frame[1] = 0; // the server fills in our clientId
    frame.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 2);
    sendBinary(frame.buffer);
  }

  function onBinaryRemote(buf) {
    var u8 = new Uint8Array(buf);
    if (u8.length < 2) return;
    var start = 2 + u8[1];
    if (u8[0] === TTS_KIND && u8.length >= start) dispatch('tts:chunk', { data: u8.slice(start) });
  }

  // ── remote: account helpers (kurochan-server JSON API, same origin) ──────────
  function api(method, path, csrf) {
    var headers = { Accept: 'application/json' };
    if (csrf) headers['X-CSRF-Token'] = csrf;
    return fetch(path, { method: method, headers: headers, credentials: 'same-origin' }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (body) {
        if (!res.ok) throw new Error((body && body.message) || ('Request failed (' + res.status + ')'));
        return body;
      });
    });
  }
  function accountInfo() {
    return api('GET', '/api/me').then(function (me) {
      return { username: me.user && me.user.username, device: me.device || null, csrfToken: me.csrfToken };
    });
  }

  var backoff = 1000;
  var wasOffline = false;

  function connect() {
    ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      connected = true;
      backoff = 1000;
      if (REMOTE && !wasOffline) hideOverlay();
      var q = outbox; outbox = [];
      for (var i = 0; i < q.length; i++) { try { ws.send(q[i]); } catch (e) { /* ignore */ } }
    };

    ws.onmessage = function (ev) {
      if (typeof ev.data !== 'string') { if (REMOTE) onBinaryRemote(ev.data); return; }
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      var p;
      if (!REMOTE && msg.t === 'res') {
        p = pending.get(msg.id); if (!p) return; pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'Request failed'));
      } else if (REMOTE && msg.t === 'result') {
        p = pending.get(msg.id); if (!p) return; pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value); else p.reject(new Error(msg.error || 'Request failed'));
      } else if (msg.t === 'event') {
        dispatch(REMOTE ? msg.ch : msg.channel, msg.data);
      } else if (REMOTE && msg.t === 'presence') {
        if (msg.online) {
          // The PC came back: reload so the app (served by the PC) starts fresh.
          if (wasOffline) { location.reload(); return; }
          hideOverlay();
        } else {
          wasOffline = true;
          showOverlay('KuroChan is offline — waiting for your PC…');
        }
      }
    };

    ws.onclose = function (ev) {
      connected = false;
      // Fail any in-flight requests; the renderer re-issues on the next action
      // (and reconnects below). Reads at startup normally complete on first open.
      pending.forEach(function (p) { try { p.reject(new Error('Backend disconnected')); } catch (e) {} });
      pending.clear();
      if (!REMOTE) { setTimeout(connect, 1000); return; }
      if (ev.code === 4401 || ev.code === 4403) { location.href = '/login'; return; }
      if (ev.code === 4404) { location.href = '/bind'; return; }
      if (!wasOffline) showOverlay('Connection lost — reconnecting…');
      setTimeout(connect, backoff / 2 + Math.random() * backoff / 2);
      backoff = Math.min(30000, backoff * 2);
    };

    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  // ── synthesized inputs (hidden behind the same contract) ─────────────────────
  // Head/eye tracking: drive model:cursor-pos from the local pointer, normalized
  // to −1..1 around the viewport centre (matches the desktop global-cursor math).
  window.addEventListener('pointermove', function (e) {
    var w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;
    var x = Math.max(-1, Math.min(1, (e.clientX - w / 2) / (w / 2)));
    var y = Math.max(-1, Math.min(1, (e.clientY - h / 2) / (h / 2)));
    dispatch('model:cursor-pos', { x: x, y: y });
  });

  // Mic toggle hotkey: Ctrl/Cmd+M.
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      dispatch('hotkey:toggle-mic', undefined);
    }
  });

  connect();

  // ── the contract (mirrors preload.js) ────────────────────────────────────────
  var backend = {
    // Host capabilities — the web host has no movable/closable app window.
    capabilities: { windowControls: false, settings: 'full', binding: 'device' },

    // System / config
    closeWindow:      function () { try { window.close(); } catch (e) {} },
    getConfig:        function () { return invoke('get-config'); },
    saveConfig:       function (data) { return invoke('save-config', data); },
    resolveModelDir:  function (dir) { return invoke('resolve-model-dir', dir); },
    getServerInfo:    function () { return invoke('server:info'); },
    openFolderDialog: function () { return invoke('open-folder-dialog'); }, // → null (manual entry)
    openFileDialog:   function (opts) { return invoke('open-file-dialog', opts); }, // → null

    // Chat
    chatBuiltinSend: function (text) { return invoke('chat:builtin-send', { text: text }); },
    onChatStreamStart: function (fn) { on('chat:stream:start', fn); },
    onChatStreamData:  function (fn) { on('chat:stream:data', fn); },
    onChatStreamEnd:   function (fn) { on('chat:stream:end', fn); },
    onChatStreamError: function (fn) { on('chat:stream:error', fn); },

    // GitHub Copilot
    copilotAuthStatus:   function () { return invoke('copilot:auth-status'); },
    copilotLogin:        function () { return invoke('copilot:login'); },
    copilotListModels:   function () { return invoke('copilot:list-models'); },
    copilotResetSession: function () { return invoke('copilot:reset-session'); },
    onCopilotLoginCode:  function (fn) { on('copilot:login-code', fn); },

    // TTS
    ttsStop:   function () { return invoke('tts:stop'); },
    ttsVolume: function (vol) { sendMsg('tts:volume', vol); },
    onTTSStart: function (fn) { on('tts:start', fn); },
    onTTSChunk: function (fn) { on('tts:chunk', fn); },
    onTTSEnd:   function (fn) { on('tts:end', fn); },
    onTTSError: function (fn) { on('tts:error', fn); },
    onTTSStop:  function (fn) { on('tts:stop', fn); },

    // STT
    sttStart:      function (sampleRate) { return invoke('stt:start', { sampleRate: sampleRate }); },
    sttStop:       function () { return invoke('stt:stop'); },
    sttReady:      function () { return invoke('stt:ready'); },
    sttAudioChunk: function (buffer) { sendBinary(buffer); },
    onSTTVadState: function (fn) { on('stt:vad-state', fn); },
    onSTTError:    function (fn) { on('stt:error', fn); },

    // Remote access (binding this PC to kurochan-server)
    remoteStatus:     function () { return invoke('remote:status'); },
    remoteBind:       function (deviceName) { return invoke('remote:bind', { deviceName: deviceName }); },
    remoteCancelBind: function () { return invoke('remote:cancel-bind'); },
    remoteUnbind:     function () { return invoke('remote:unbind'); },
    onRemoteStatus:   function (fn) { on('remote:status-changed', fn); },

    // Hotkeys (synthesized locally)
    onToggleMic: function (fn) { on('hotkey:toggle-mic', fn); },

    // Model push events (cursor synthesized locally)
    onModelSetParam:  function (fn) { on('model:set-parameter', fn); },
    onModelStatus:    function (fn) { on('model:status', fn); },
    onModelCursorPos: function (fn) { on('model:cursor-pos', fn); },
  };

  if (REMOTE) {
    // Remote browsers: binding-only settings, no secrets, local lip sync, 16 kHz mic.
    var notAllowed = function () { return Promise.reject(new Error('Settings can only be changed on the PC.')); };
    var bootstrap = null;
    var getBootstrap = function () {
      if (!bootstrap) bootstrap = invoke('app:bootstrap').catch(function (e) { bootstrap = null; throw e; });
      return bootstrap;
    };
    var assign = {
      capabilities: { windowControls: false, settings: 'binding-only', binding: 'account' },
      getConfig:        function () { return Promise.resolve({}); },
      saveConfig:       notAllowed,
      resolveModelDir:  function () { return getBootstrap().then(function (b) { return b && b.modelUrl; }); },
      getServerInfo:    function () { return Promise.resolve({ running: false }); },
      openFolderDialog: function () { return Promise.resolve(null); },
      openFileDialog:   function () { return Promise.resolve(null); },
      copilotAuthStatus:   function () { return Promise.resolve({ loggedIn: false }); },
      copilotLogin:        notAllowed,
      copilotListModels:   notAllowed,
      copilotResetSession: notAllowed,
      ttsVolume: function (vol) {
        var v = Math.max(0, Math.min(1, Number(vol) || 0));
        dispatch('model:set-parameter', { id: 'ParamMouthOpenY', value: v, weight: 1.0 });
      },
      sttStart: function (sampleRate) {
        resetResampler(sampleRate);
        return invoke('stt:start', { sampleRate: 16000, format: 's16' });
      },
      sttAudioChunk: function (buffer) { sendMicRemote(buffer); },
      remoteStatus:     notAllowed,
      remoteBind:       notAllowed,
      remoteCancelBind: notAllowed,
      remoteUnbind:     notAllowed,
      onRemoteStatus:   function () {},
      // Account (kurochan-server) — the only "settings" a remote browser has.
      accountInfo: function () {
        return Promise.all([accountInfo(), getBootstrap().catch(function () { return null; })]).then(function (r) {
          return { username: r[0].username, device: r[0].device, appVersion: r[1] && r[1].appVersion };
        });
      },
      unbindDevice: function () {
        return accountInfo().then(function (me) { return api('DELETE', '/api/device', me.csrfToken); })
          .then(function () { location.href = '/bind'; });
      },
      logout: function () {
        return accountInfo().then(function (me) { return api('POST', '/api/auth/logout', me.csrfToken); })
          .then(function () { location.href = '/login'; });
      },
      accountUrl: '/account',
    };
    for (var k in assign) if (Object.prototype.hasOwnProperty.call(assign, k)) backend[k] = assign[k];
  }

  window.kuroBackend = backend;
})();
