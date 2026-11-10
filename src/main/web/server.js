/**
 * server.js — web companion server (main process).
 *
 * Runs ALONGSIDE the desktop window (not instead of it): the same backend serves
 * the renderer UI + Live2D assets over HTTP(S) and bridges browsers to the shared
 * application core (app-core.js) over WebSocket, mirroring the exact
 * `window.kuroBackend` contract that preload.js exposes to the desktop renderer.
 *
 * The server registers itself as a broadcast SINK with app-core, so every push
 * event (chat stream, TTS audio, lip-sync, VAD state, …) fans out to the desktop
 * window and every connected browser at once. Single instance: browsers are
 * remote views of this PC's one set of services/config/session.
 *
 * Lifecycle is owned by index.js (driven by config.server); startWebServer()
 * returns a handle with close() so the server can be restarted when settings
 * change. It does NOT configure services — that happens once, centrally.
 */
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { WebSocketServer } = require('ws');

const appCore = require('../app-core.js');
const { getCert, localIPv4s } = require('./self-signed.js');

// Web assets live at the app root (repo root in dev, inside app.asar when
// packaged). Resolve relative to THIS file so it works in both.
const WEB_ROOT    = path.resolve(__dirname, '..', '..', '..');
const INDEX_HTML  = path.join(WEB_ROOT, 'index.html');
const WEB_API_JS  = path.join(__dirname, 'web-api.js');
const MODEL_MOUNT = '/live2d-model/';

// The currently-served Live2D model directory (set by resolve-model-dir).
let _modelDir = null;

// ── Static file helpers ───────────────────────────────────────────────────────
const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json; charset=utf-8',
};
function mimeFor(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

/** Safely resolve `relPath` under `baseDir`, or null if it escapes the base. */
function safeJoin(baseDir, relPath) {
  const decoded = decodeURIComponent(relPath).replace(/\\/g, '/');
  const abs = path.normalize(path.join(baseDir, decoded));
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (abs !== baseDir && !abs.startsWith(baseWithSep)) return null; // traversal attempt
  return abs;
}

function sendFile(res, absPath) {
  fs.readFile(absPath, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mimeFor(absPath), 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

/** index.html with the web bridge injected before the renderer bundle. */
function serveIndex(res) {
  fs.readFile(INDEX_HTML, 'utf8', (err, html) => {
    if (err) { res.writeHead(500); res.end('index.html missing'); return; }
    const injected = html.replace(
      '<script src="third_party/live2d/live2dcubismcore.min.js"></script>',
      '<script src="/web-api.js"></script>\n  <script src="third_party/live2d/live2dcubismcore.min.js"></script>',
    );
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(injected);
  });
}

function handleRequest(req, res) {
  let pathname = '/';
  try { pathname = decodeURI(new URL(req.url, 'http://x').pathname); } catch { /* keep default */ }

  if (pathname === '/' || pathname === '/index.html') return serveIndex(res);
  if (pathname === '/web-api.js') return sendFile(res, WEB_API_JS);

  // Live2D model assets from the currently-configured model directory.
  if (pathname.startsWith(MODEL_MOUNT)) {
    if (!_modelDir) { res.writeHead(404); res.end('No model configured'); return; }
    const abs = safeJoin(_modelDir, pathname.slice(MODEL_MOUNT.length));
    if (!abs) { res.writeHead(403); res.end('Forbidden'); return; }
    return sendFile(res, abs);
  }

  // Bundled renderer + Live2D core (relative to the app root).
  if (pathname.startsWith('/dist/') || pathname.startsWith('/third_party/')) {
    const abs = safeJoin(WEB_ROOT, pathname.replace(/^\/+/, ''));
    if (!abs) { res.writeHead(403); res.end('Forbidden'); return; }
    return sendFile(res, abs);
  }

  res.writeHead(404);
  res.end('Not found');
}

// ── WebSocket bridge ──────────────────────────────────────────────────────────
const clients = new Set();

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) { try { ws.send(msg); } catch { /* ignore */ } }
  }
}

// The broadcast sink registered with app-core. Binary TTS chunks are
// base64-wrapped so the whole event stream stays uniform JSON.
const webSink = {
  isAlive: () => true, // server is up while this sink is registered
  reload: () => broadcast({ t: 'event', channel: 'app:reload', data: {} }),
  send: (channel, data, opts) => {
    if (opts && opts.to && opts.to !== 'local') return; // targeted at a remote client
    if (channel === 'tts:chunk' && data && data.data) {
      const u8 = data.data;
      const b64 = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
      broadcast({ t: 'event', channel, data: { b64 } });
    } else {
      broadcast({ t: 'event', channel, data });
    }
  },
};

/** Resolve a Live2D model dir to a same-origin URL and mount it for serving. */
function resolveModelDirWeb(modelDir, origin) {
  const r = appCore.findModel3(modelDir);
  if (!r) return null;
  _modelDir = r.absDir;
  return `${origin}${MODEL_MOUNT}${encodeURIComponent(r.fileName)}`;
}

// invoke-style handlers (return a value / Promise → sent back as the result)
const invokeHandlers = {
  'get-config':            ()         => appCore.handleGetConfig(),
  'save-config':           (arg)      => appCore.handleSaveConfig(arg), // hook reloads all views
  'server:info':           ()         => appCore.handleServerInfo(),
  'resolve-model-dir':     (arg, ctx) => resolveModelDirWeb(arg, ctx.origin),
  'open-folder-dialog':    ()         => null, // web: manual path entry
  'open-file-dialog':      ()         => null, // web: manual path entry
  'chat:builtin-send':     (arg)      => appCore.handleChatSend(arg),
  'copilot:auth-status':   ()         => appCore.handleCopilotAuthStatus(),
  'copilot:login':         ()         => appCore.handleCopilotLogin(),
  'copilot:list-models':   ()         => appCore.handleCopilotListModels(),
  'copilot:reset-session': ()         => appCore.handleCopilotResetSession(),
  'tts:stop':              ()         => appCore.handleTtsStop(),
  'stt:start':             (arg)      => appCore.handleSttStart(arg),
  'stt:stop':              ()         => appCore.handleSttStop(),
  'stt:ready':             ()         => appCore.handleSttReady(),
  'remote:status':         ()         => appCore.handleRemoteStatus(),
  'remote:bind':           (arg)      => appCore.handleRemoteBind(arg),
  'remote:cancel-bind':    ()         => appCore.handleRemoteCancelBind(),
  'remote:unbind':         ()         => appCore.handleRemoteUnbind(),
};

// send-style handlers (fire-and-forget)
const sendHandlers = {
  'tts:volume':      (arg) => appCore.handleTtsVolume(arg),
  'stt:audio-chunk': (arg) => appCore.handleSttAudioChunk(arg),
  'close-window':    ()    => { /* the browser closes itself */ },
};

function routeMessage(ws, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'invoke') {
    const fn = invokeHandlers[msg.channel];
    const reply = (ok, payload) => {
      const frame = ok ? { t: 'res', id: msg.id, ok: true, result: payload }
                       : { t: 'res', id: msg.id, ok: false, error: payload };
      if (ws.readyState === ws.OPEN) { try { ws.send(JSON.stringify(frame)); } catch { /* ignore */ } }
    };
    if (!fn) { reply(false, `Unknown channel: ${msg.channel}`); return; }
    Promise.resolve()
      .then(() => fn(msg.arg, { origin: ws._origin }))
      .then((result) => reply(true, result === undefined ? null : result))
      .catch((err) => reply(false, (err && err.message) || String(err)));
  } else if (msg.t === 'send') {
    const fn = sendHandlers[msg.channel];
    if (fn) { try { fn(msg.arg); } catch { /* ignore */ } }
  }
}

/** Node Buffer (binary WS frame) → tightly-sized ArrayBuffer for Float32 reinterpret. */
function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ── Public entry ──────────────────────────────────────────────────────────────
/**
 * Start the web companion server and register it as an app-core broadcast sink.
 * Services must already be configured/wired by the caller (index.js).
 * @param {{ https:boolean, port:number, host:string, certPath?:string, keyPath?:string }} opts
 * @returns {Promise<{ close():Promise<void>, port:number, https:boolean, urls():string[] }>}
 */
function startWebServer(opts) {
  const server = opts.https
    ? https.createServer(getCert({ certPath: opts.certPath, keyPath: opts.keyPath }), handleRequest)
    : http.createServer(handleRequest);

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const scheme = opts.https ? 'https' : 'http';
    ws._origin = `${scheme}://${req.headers.host || `localhost:${opts.port}`}`;
    ws.binaryType = 'nodebuffer';
    clients.add(ws);
    ws.on('message', (data, isBinary) => {
      if (isBinary) { appCore.handleSttAudioChunk(toArrayBuffer(data)); return; }
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      routeMessage(ws, msg);
    });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  const urls = () => {
    const scheme = opts.https ? 'https' : 'http';
    return [`${scheme}://localhost:${opts.port}`, ...localIPv4s().map((ip) => `${scheme}://${ip}:${opts.port}`)];
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', reject);
      const unregister = appCore.registerSink(webSink);
      printBanner(opts, urls());
      resolve({
        port: opts.port,
        https: opts.https,
        urls,
        close: () => new Promise((res) => {
          unregister();
          for (const ws of clients) { try { ws.close(); } catch { /* ignore */ } }
          clients.clear();
          wss.close(() => server.close(() => res()));
        }),
      });
    });
  });
}

function printBanner(opts, urls) {
  console.log('');
  console.log('  ┌─ KuroChan web companion ──────────────────────────');
  console.log(`  │  Open in a browser (${opts.https ? 'HTTPS' : 'HTTP'}):`);
  for (const u of urls) console.log(`  │    ${u}`);
  if (opts.https) {
    console.log('  │');
    console.log('  │  Self-signed cert: accept the browser warning once.');
    console.log('  │  (Required so phone microphone / voice input works.)');
  } else {
    console.log('  │');
    console.log('  │  HTTP: mic/voice works only on localhost. Use HTTPS for phones.');
  }
  console.log('  └────────────────────────────────────────────────────');
  console.log('');
}

module.exports = { startWebServer };
