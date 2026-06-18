/**
 * index.js — Electron main process entry point.
 *
 * Registers all IPC handlers, initialises services, creates the window.
 * All business logic lives in the service modules; this file wires them together.
 */
const { app, BrowserWindow, ipcMain, dialog, session, screen, net, protocol, globalShortcut } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Force UTF-8 console output on Windows
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const k32   = koffi.load('kernel32.dll');
    k32.func('bool SetConsoleOutputCP(uint codepage)')(65001);
  } catch { /* non-fatal */ }
}

// ── Service modules ───────────────────────────────────────────────────────────
const { configureLLM, setOutputStream, input: llmInput, abort: abortLLM, resetCopilotSession, disposeLLM } = require('./llm/llm.js');
const { loginWithDeviceFlow, listCopilotModels } = require('./llm/copilot-auth.js');
const { configureTTS, speak, beginSpeak, pushSpeak, endSpeak, stopTTS, setTTSWindow, handleVolume, disposeTTS } = require('./tts/tts.js');
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

function resolveModelPath(modelPath) {
  if (path.isAbsolute(modelPath)) return modelPath;
  const rootDir = app.isPackaged
    ? path.dirname(process.resourcesPath)
    : path.join(__dirname, '..', '..');
  return path.join(rootDir, modelPath);
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

/**
 * Transcribe audio with whisper DLL.
 * Injected into STT module via configureSTT deps.
 */
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
// Injected into the LLM service via configureLLM deps.
function persistCopilotSessionId(sessionId) {
  const cfg = readConfig();
  cfg.llm = cfg.llm || {};
  cfg.llm.copilot = cfg.llm.copilot || {};
  if (sessionId) cfg.llm.copilot.sessionId = sessionId;
  else delete cfg.llm.copilot.sessionId;
  writeConfig(cfg);
}

// ── App root directory (for resolving relative model paths) ───────────────────
function getAppRoot() {
  if (app.isPackaged) return path.dirname(process.resourcesPath);
  return path.join(__dirname, '..', '..');
}

// ── Window creation ───────────────────────────────────────────────────────────
let mainWindow;

function initServices(win) {
  setTTSWindow(win);
  setSTTWindow(win);
  setBuiltinModelWindow(win);

  // Wire the single LLM output stream → renderer chat display + TTS.
  // TTS streams incrementally: begin on first token, push each delta, end when
  // the turn is complete — so speech starts while the LLM is still generating
  // (and continues across multi-part tool turns) instead of waiting for the end.
  setOutputStream({
    onStart: () => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:stream:start', {});
      beginSpeak();
    },
    onData: (chunk) => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:stream:data', { chunk });
      pushSpeak(chunk);
    },
    onEnd: () => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:stream:end', {});
      endSpeak();
    },
    onError: (err) => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:stream:error', { message: err.message });
      stopTTS();
    },
  });
}

function configureAllServices(config) {
  // LLM — inject Copilot session-id persistence. On-demand: this only stores
  // config and never spawns the Copilot CLI (that happens lazily on first use).
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
  if (process.argv.includes('--devtools')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Electron] Renderer process gone:', details.reason, details.exitCode);
    createWindow();
  });

  // Configure services first (creates service instances), then wire windows
  const config = readConfig();
  configureAllServices(config);
  initServices(mainWindow);

  // Poll global cursor position so the Live2D model can track it
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const cx = bounds.x + bounds.width  / 2;
    const cy = bounds.y + bounds.height / 2;
    const x = Math.max(-1, Math.min(1, (cursor.x - cx) / (bounds.width  / 2)));
    const y = Math.max(-1, Math.min(1, (cursor.y - cy) / (bounds.height / 2)));
    mainWindow.webContents.send('model:cursor-pos', { x, y });
  }, 50);
}

app.whenReady().then(() => {
  // Allow the renderer to fetch file:// URLs (for Live2D model assets).
  protocol.handle('file', (req) => net.fetch(req.url, { bypassCustomProtocolHandlers: true }));

  createWindow();

  // Global hotkey: Ctrl+M to toggle mic
  globalShortcut.register('CommandOrControl+M', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send('hotkey:toggle-mic');
  });

  // Grant microphone access
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'media') return true;
    return false;
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Graceful shutdown: stop the Copilot CLI and the Kokoro synthesis worker before
// exiting. The worker must be drained to idle and terminated cleanly — quitting
// while it is mid-inference (an uninterruptible native call) crashes the runtime.
let _quitting = false;
app.on('before-quit', (event) => {
  if (_quitting) return;
  _quitting = true;
  event.preventDefault();
  (async () => {
    try { disposeLLM(); } catch { /* ignore */ }
    try { await disposeTTS(); } catch { /* ignore */ }
    app.exit(0);
  })();
});

// ── IPC: System / config ──────────────────────────────────────────────────────

ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.handle('get-config', () => {
  return readConfig();
});

ipcMain.handle('save-config', (event, data) => {
  // The Copilot session id and token are owned by the LLM service and the login
  // flow — not the Settings form. Preserve them from the existing config so that
  // saving Settings never drops the ongoing conversation, regardless of what the
  // renderer submits or whether the user clicks Save.
  const prev = readConfig();
  const prevCopilot = (prev.llm && prev.llm.copilot) ? prev.llm.copilot : {};
  if (prevCopilot.token || prevCopilot.sessionId) {
    data.llm = data.llm || {};
    data.llm.copilot = data.llm.copilot || {};
    if (prevCopilot.token)     data.llm.copilot.token = prevCopilot.token;
    if (prevCopilot.sessionId) data.llm.copilot.sessionId = prevCopilot.sessionId;
  }
  writeConfig(data);
  // Re-configure services with new config, then re-wire windows
  const config = readConfig();
  configureAllServices(config);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) initServices(win);
  win?.reload();
});

ipcMain.handle('resolve-model-dir', (_event, modelDir) => {
  if (!modelDir) return null;
  try {
    const appRoot = getAppRoot();
    const dir = path.isAbsolute(modelDir) ? modelDir : path.join(appRoot, modelDir);
    const f = fs.readdirSync(dir).find(n => n.endsWith('.model3.json'));
    if (f) {
      const abs = path.join(dir, f);
      return 'file:///' + abs.replace(/\\/g, '/');
    }
  } catch { /* dir unreadable */ }
  return null;
});

ipcMain.handle('open-folder-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Select model folder',
    properties: ['openDirectory'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('open-file-dialog', async (event, { title, filters } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title:      title  || 'Select file',
    filters:    filters || [],
    properties: ['openFile'],
  });
  return canceled ? null : filePaths[0];
});

// ── IPC: Chat ─────────────────────────────────────────────────────────────────

ipcMain.handle('chat:builtin-send', (_event, { text }) => {
  handleBuiltinChatMessage(text);
});

// ── IPC: GitHub Copilot ───────────────────────────────────────────────────────

let _copilotLoginInFlight = false;

ipcMain.handle('copilot:auth-status', () => {
  const cfg = readConfig();
  return { loggedIn: !!(cfg.llm && cfg.llm.copilot && cfg.llm.copilot.token) };
});

ipcMain.handle('copilot:login', async (event) => {
  if (_copilotLoginInFlight) return { ok: false, error: 'A login is already in progress.' };
  _copilotLoginInFlight = true;
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    const token = await loginWithDeviceFlow((code) => {
      if (win && !win.isDestroyed()) win.webContents.send('copilot:login-code', code);
    });
    const cfg = readConfig();
    cfg.llm = cfg.llm || {};
    cfg.llm.copilot = cfg.llm.copilot || {};
    cfg.llm.copilot.token = token;
    writeConfig(cfg);
    // Apply the new token to services (on-demand — does not spawn the CLI).
    configureAllServices(readConfig());
    if (win) initServices(win);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    _copilotLoginInFlight = false;
  }
});

ipcMain.handle('copilot:list-models', async () => {
  const cfg = readConfig();
  const token = cfg.llm && cfg.llm.copilot && cfg.llm.copilot.token;
  if (!token) return { ok: false, error: 'Not logged in.' };
  try {
    const models = await listCopilotModels(token);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('copilot:reset-session', async () => {
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
});

// ── IPC: TTS ──────────────────────────────────────────────────────────────────

ipcMain.handle('tts:stop', () => {
  stopTTS();
});

ipcMain.on('tts:volume', (_event, vol) => {
  handleVolume(vol);
});

// ── IPC: STT ──────────────────────────────────────────────────────────────────

ipcMain.handle('stt:start', (_event, { sampleRate }) => {
  return startListening(sampleRate);
});

ipcMain.handle('stt:stop', () => {
  stopListening();
});

ipcMain.on('stt:audio-chunk', (_event, buffer) => {
  handleAudioChunk(buffer);
});

ipcMain.handle('stt:ready', () => {
  return { available: sttAvailable() };
});
