/**
 * app-core.js — transport-neutral application core (main process).
 *
 * This module owns everything that is IDENTICAL whether the renderer is reached
 * over Electron IPC or over the web WebSocket: config persistence, the Whisper
 * DLL binding, service configuration/wiring, and every message handler.
 *
 * The two transports are thin adapters over this core:
 *   - Electron: src/main/index.js         (ipcMain handlers → these functions)
 *   - Web:      src/main/web/server.js     (WS messages     → these functions)
 *
 * Services push events through a COMPOSITE "window-like" target
 * (`.webContents.send(channel, data)` + `.isDestroyed()`) that fans every event
 * out to all registered sinks — the desktop BrowserWindow AND the web-server
 * broadcaster — so one backend drives the local window and every connected
 * browser at once. The services are duck-typed on that interface and never know
 * which transports are attached.
 */
const { app } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Service modules ───────────────────────────────────────────────────────────
const { configureLLM, setOutputStream, input: llmInput, abort: abortLLM, resetCopilotSession, disposeLLM } = require('./llm/llm.js');
const { loginWithDeviceFlow, listCopilotModels } = require('./llm/copilot-auth.js');
const { configureTTS, beginSpeak, pushSpeak, endSpeak, stopTTS, setTTSWindow, handleVolume, disposeTTS } = require('./tts/tts.js');
const { configureSTT, sttAvailable, startListening, stopListening, handleAudioChunk, setSTTWindow, setOnTranscript, setOnSpeechStart } = require('./stt/stt.js');
const { handleBuiltinChatMessage } = require('./chat/chat.js');
const { setBuiltinModelWindow } = require('./model/model.js');

// ── Whisper / koffi state ─────────────────────────────────────────────────────
let _whisperTranscribeFn = null;

function getWhisperDLLPath() {
  const relative = path.join('resources', 'whisper', 'whisper_kuro.dll');
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', relative);
  }
  return path.join(__dirname, '..', '..', relative);
}

function getAppRoot() {
  if (app.isPackaged) return path.dirname(process.resourcesPath);
  return path.join(__dirname, '..', '..');
}

function resolveModelPath(modelPath) {
  if (path.isAbsolute(modelPath)) return modelPath;
  return path.join(getAppRoot(), modelPath);
}

function loadWhisperDLL() {
  if (_whisperTranscribeFn) return true;
  const dllPath = getWhisperDLLPath();
  if (!fs.existsSync(dllPath)) return false;
  try {
    const koffi = require('koffi');
    const lib   = koffi.load(dllPath);
    const fn = lib.func(
      'int kurochan_whisper_transcribe(' +
      '  const char* model_path,' +
      '  const float* samples,' +
      '  int n_samples,' +
      '  int n_threads,' +
      '  const char* language,' +
      '  char* out_buf,' +
      '  int buf_size' +
      ')'
    );
    const { promisify } = require('util');
    _whisperTranscribeFn = promisify(fn.async.bind(fn));
    return true;
  } catch (err) {
    console.error('[Whisper] Failed to load whisper_kuro.dll:', err.message);
    return false;
  }
}

/** Transcribe audio with the whisper DLL. Injected into the STT service. */
async function whisperTranscribe({ samplesBuffer, modelPath, nThreads = 4, language = 'en' }) {
  if (!loadWhisperDLL()) {
    throw new Error('whisper_kuro.dll not found. Run: npm run build:whisper');
  }
  const absModelPath = resolveModelPath(modelPath);
  if (!fs.existsSync(absModelPath)) {
    throw new Error(`Whisper model not found: ${absModelPath}`);
  }
  const samples = new Float32Array(samplesBuffer);
  const outBuf  = Buffer.alloc(32768);
  const n = await _whisperTranscribeFn(
    absModelPath, samples, samples.length, nThreads, language, outBuf, outBuf.length,
  );
  if (n <= 1) return '';
  const transcript = outBuf.slice(0, n - 1).toString('utf8');
  console.log(`[Whisper] language="${language}"  transcript: ${transcript}`);
  return transcript;
}

// ── Config persistence ────────────────────────────────────────────────────────
const CONFIG_DIR  = path.join(os.homedir(), '.kurochan');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function writeConfig(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Persist the Copilot session id so the same conversation resumes next launch.
function persistCopilotSessionId(sessionId) {
  const cfg = readConfig();
  cfg.llm = cfg.llm || {};
  cfg.llm.copilot = cfg.llm.copilot || {};
  if (sessionId) cfg.llm.copilot.sessionId = sessionId;
  else delete cfg.llm.copilot.sessionId;
  writeConfig(cfg);
}

/**
 * Locate the Cubism `.model3.json` inside a model folder (abs or app-relative).
 * Returned as { absDir, fileName } so each transport can format its own URL
 * (Electron `file://`, web `http(s)://…`). Renderer only ever sees the URL.
 */
function findModel3(modelDir) {
  if (!modelDir) return null;
  try {
    const dir = path.isAbsolute(modelDir) ? modelDir : path.join(getAppRoot(), modelDir);
    const f = fs.readdirSync(dir).find(n => n.endsWith('.model3.json'));
    if (f) return { absDir: dir, fileName: f };
  } catch { /* dir unreadable */ }
  return null;
}

// ── Service wiring: broadcast composite target ────────────────────────────────
// The services push events via a "window-like" object (`.webContents.send()` +
// `.isDestroyed()`). Instead of a single window, we give them a COMPOSITE target
// that fans every event out to all registered sinks — the desktop BrowserWindow
// and the web-server broadcaster — so one backend drives the local window and
// every connected browser at once.
//
// A sink is: { send(channel,data,opts), reload(), isAlive():boolean }.
//   - desktop sink (index.js): send → win.webContents.send; reload → win.reload()
//   - web sink   (web/server.js): send → WS broadcast; reload → app:reload event
//   - remote sink (remote/remote.js): send → kurochan-server relay (allowlisted)
// Each sink serializes as its transport needs (e.g. the web sink base64-encodes
// the binary tts:chunk); the composite just forwards the raw payload.
//
// `opts.to` targets one audience: 'local' = desktop window + LAN web clients,
// 'remote:<clientId>' = one remote browser. No `to` = everyone.
const _sinks = new Set();

/** Register a push sink. Returns an unregister function. */
function registerSink(sink) { _sinks.add(sink); return () => _sinks.delete(sink); }

/** The composite push target handed to every service. Always logically alive. */
const _target = {
  isDestroyed: () => false,
  webContents: {
    send: (channel, data, opts) => {
      for (const s of _sinks) {
        try { if (s.isAlive()) s.send(channel, data, opts); } catch { /* ignore one bad sink */ }
      }
    },
  },
};

/** Push an event to all sinks (desktop window + web clients + remote clients). */
function pushEvent(channel, data, opts) { _target.webContents.send(channel, data, opts); }

/** The composite push target (used by handlers that emit events, e.g. login). */
function getTarget() { return _target; }

/** Reload every connected view (desktop window reloads; web clients get app:reload). */
function reloadAll() {
  for (const s of _sinks) { try { s.reload(); } catch { /* ignore */ } }
}

/**
 * Wire the single LLM output stream → renderer chat display + TTS, and point the
 * TTS/STT/model services at the composite target. Idempotent; re-run after
 * (re)configuring, since configure creates fresh service instances.
 */
function initServices() {
  setTTSWindow(_target);
  setSTTWindow(_target);
  setBuiltinModelWindow(_target);

  // TTS streams incrementally: begin on first token, push each delta, end when
  // the turn completes — speech starts while the LLM is still generating.
  setOutputStream({
    onStart: () => { pushEvent('chat:stream:start', {}); beginSpeak(); },
    onData:  (chunk) => { pushEvent('chat:stream:data', { chunk }); pushSpeak(chunk); },
    onEnd:   () => { pushEvent('chat:stream:end', {}); endSpeak(); },
    onError: (err) => { pushEvent('chat:stream:error', { message: err.message }); stopTTS(); },
  });
}

function configureAllServices(config) {
  // LLM — inject Copilot session-id persistence. On-demand: only stores config,
  // never spawns the Copilot CLI (that happens lazily on first use).
  configureLLM(config.llm ?? {}, { onSessionId: persistCopilotSessionId });

  // TTS
  configureTTS(config.tts ?? {});

  // STT (with whisper transcribe function injected)
  configureSTT(config.stt ?? {}, { transcribe: whisperTranscribe });

  // Barge-in: the moment the user starts speaking, abort the in-flight LLM turn
  // and stop any TTS so KuroChan doesn't talk over them.
  setOnSpeechStart(() => {
    abortLLM();
    stopTTS();
  });

  // Route STT transcripts directly to LLM (not through chat). Abort any current
  // turn first so a new spoken message supersedes the previous one.
  setOnTranscript((text) => {
    abortLLM();
    stopTTS();
    llmInput(text);
  });
}

// ── Message handlers (transport-neutral) ──────────────────────────────────────
// Each accepts the same payload shape the preload/web bridge sends, so the
// Electron IPC layer and the web WS layer are thin pass-throughs.

let _copilotLoginInFlight = false;

// Post-save hook (set by index.js): restarts the web server if server settings
// changed, then reloads all views. Lets a save from ANY transport (desktop IPC
// or web WS) drive the same server-restart + reload behavior centrally.
let _afterSaveHook = null;
function setAfterSaveHook(fn) { _afterSaveHook = fn; }

// Server-info provider (set by index.js, which owns the web server lifecycle).
let _serverInfoProvider = () => ({ running: false });
function setServerInfoProvider(fn) { _serverInfoProvider = fn; }
function handleServerInfo() { return _serverInfoProvider(); }

// Remote-access controller (set by index.js; see remote/remote.js).
let _remote = null;
function setRemoteController(remote) { _remote = remote; }
function requireRemote() {
  if (!_remote) throw new Error('Remote access is not available.');
  return _remote;
}
function handleRemoteStatus()             { return requireRemote().getStatus(); }
function handleRemoteBind(arg)            { return requireRemote().bind(arg || {}); }
function handleRemoteCancelBind()         { return requireRemote().cancelBind(); }
function handleRemoteUnbind()             { return requireRemote().unbind(); }

function handleGetConfig() {
  return readConfig();
}

/**
 * Persist settings and re-apply them. The Copilot session id and token are owned
 * by the LLM service and the login flow — not the Settings form — so preserve
 * them from the existing config regardless of what the renderer submits.
 *
 * Detects whether the `server` section changed and fires the post-save hook
 * (server restart + reload of all views). Does not reload synchronously; the
 * hook handles transport-appropriate reload for desktop AND web at once.
 */
function handleSaveConfig(data) {
  const prev = readConfig();
  const prevCopilot = (prev.llm && prev.llm.copilot) ? prev.llm.copilot : {};
  if (prevCopilot.token || prevCopilot.sessionId) {
    data.llm = data.llm || {};
    data.llm.copilot = data.llm.copilot || {};
    if (prevCopilot.token)     data.llm.copilot.token = prevCopilot.token;
    if (prevCopilot.sessionId) data.llm.copilot.sessionId = prevCopilot.sessionId;
  }
  // The binding (deviceId / username) is owned by the remote module; only the
  // device name comes from the form.
  const prevRemote = prev.remote || {};
  const remote = { ...(data.remote || {}) };
  if (!remote.deviceName && prevRemote.deviceName) remote.deviceName = prevRemote.deviceName;
  if (prevRemote.deviceId) remote.deviceId = prevRemote.deviceId;
  if (prevRemote.username) remote.username = prevRemote.username;
  data.remote = remote;
  const remoteNameChanged = (prevRemote.deviceName || '') !== (remote.deviceName || '');
  const serverChanged = JSON.stringify(prev.server || {}) !== JSON.stringify(data.server || {});
  writeConfig(data);
  configureAllServices(readConfig());
  initServices();
  // Fire the hook AFTER the current call returns (e.g. so a web client's
  // save-config response flushes before the server may restart under it).
  if (_afterSaveHook) {
    setImmediate(() => { try { _afterSaveHook({ serverChanged, remoteNameChanged }); } catch { /* ignore */ } });
  }
  return { ok: true, serverChanged };
}

function handleChatSend({ text } = {}) {
  handleBuiltinChatMessage(text);
}

function handleCopilotAuthStatus() {
  const cfg = readConfig();
  return { loggedIn: !!(cfg.llm && cfg.llm.copilot && cfg.llm.copilot.token) };
}

/**
 * Run the GitHub device-flow login. The user code is broadcast to all views
 * (`copilot:login-code`) so it shows wherever the user clicked Log in.
 */
async function handleCopilotLogin() {
  if (_copilotLoginInFlight) return { ok: false, error: 'A login is already in progress.' };
  _copilotLoginInFlight = true;
  try {
    const token = await loginWithDeviceFlow((code) => {
      pushEvent('copilot:login-code', code);
    });
    const cfg = readConfig();
    cfg.llm = cfg.llm || {};
    cfg.llm.copilot = cfg.llm.copilot || {};
    cfg.llm.copilot.token = token;
    writeConfig(cfg);
    // Apply the new token to services (on-demand — does not spawn the CLI).
    configureAllServices(readConfig());
    initServices();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    _copilotLoginInFlight = false;
  }
}

async function handleCopilotListModels() {
  const cfg = readConfig();
  const token = cfg.llm && cfg.llm.copilot && cfg.llm.copilot.token;
  if (!token) return { ok: false, error: 'Not logged in.' };
  try {
    const models = await listCopilotModels(token);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function handleCopilotResetSession() {
  try {
    const newId = await resetCopilotSession();
    if (newId == null) {
      // Copilot isn't the active service — just clear the persisted id.
      const cfg = readConfig();
      if (cfg.llm && cfg.llm.copilot && cfg.llm.copilot.sessionId) {
        delete cfg.llm.copilot.sessionId;
        writeConfig(cfg);
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function handleTtsStop()            { stopTTS(); }
function handleTtsVolume(vol)       { handleVolume(vol); }
// `session` = 'local' for the desktop window / LAN web, 'remote:<clientId>' for remote browsers.
function handleSttStart({ sampleRate, format } = {}, session = 'local') {
  return startListening(sampleRate, session, format === 's16' ? 's16' : 'f32');
}
function handleSttStop(session = 'local')              { stopListening(session); }
function handleSttReady()                              { return { available: sttAvailable() }; }
function handleSttAudioChunk(buffer, session = 'local') { handleAudioChunk(buffer, session); }

/** Graceful shutdown — stop the Copilot CLI and drain the Kokoro worker. */
async function dispose() {
  try { disposeLLM(); } catch { /* ignore */ }
  try { await disposeTTS(); } catch { /* ignore */ }
}

module.exports = {
  // config / paths
  readConfig, writeConfig, persistCopilotSessionId,
  getAppRoot, resolveModelPath, findModel3,
  whisperTranscribe,
  // service lifecycle + broadcast target
  configureAllServices, initServices, getTarget, pushEvent,
  registerSink, reloadAll, dispose,
  setAfterSaveHook, setServerInfoProvider, setRemoteController,
  // handlers
  handleGetConfig, handleSaveConfig, handleChatSend, handleServerInfo,
  handleRemoteStatus, handleRemoteBind, handleRemoteCancelBind, handleRemoteUnbind,
  handleCopilotAuthStatus, handleCopilotLogin, handleCopilotListModels, handleCopilotResetSession,
  handleTtsStop, handleTtsVolume,
  handleSttStart, handleSttStop, handleSttReady, handleSttAudioChunk,
};
