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
 */
(function () {
  'use strict';

  var WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

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
  function rawSend(text) {
    if (connected) { try { ws.send(text); } catch (e) { outbox.push(text); } }
    else outbox.push(text);
  }

  function invoke(channel, arg) {
    var id = ++seq;
    var frame = JSON.stringify({ t: 'invoke', id: id, channel: channel, arg: arg });
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      rawSend(frame);
    });
  }

  function sendMsg(channel, arg) {
    rawSend(JSON.stringify({ t: 'send', channel: channel, arg: arg }));
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

  function connect() {
    ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      connected = true;
      var q = outbox; outbox = [];
      for (var i = 0; i < q.length; i++) { try { ws.send(q[i]); } catch (e) { /* ignore */ } }
    };

    ws.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === 'res') {
        var p = pending.get(msg.id); if (!p) return; pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error || 'Request failed'));
      } else if (msg.t === 'event') {
        dispatch(msg.channel, msg.data);
      }
    };

    ws.onclose = function () {
      connected = false;
      // Fail any in-flight requests; the renderer re-issues on the next action
      // (and reconnects below). Reads at startup normally complete on first open.
      pending.forEach(function (p) { try { p.reject(new Error('Backend disconnected')); } catch (e) {} });
      pending.clear();
      setTimeout(connect, 1000);
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
  window.kuroBackend = {
    // Host capabilities — the web host has no movable/closable app window.
    capabilities: { windowControls: false },

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

    // Hotkeys (synthesized locally)
    onToggleMic: function (fn) { on('hotkey:toggle-mic', fn); },

    // Model push events (cursor synthesized locally)
    onModelSetParam:  function (fn) { on('model:set-parameter', fn); },
    onModelStatus:    function (fn) { on('model:status', fn); },
    onModelCursorPos: function (fn) { on('model:cursor-pos', fn); },
  };
})();
