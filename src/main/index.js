/**
 * index.js — Electron main process entry point.
 *
 * Registers all IPC handlers, initialises services, creates the window.
 * All business logic lives in the service modules; this file wires them together.
 */
const { app, BrowserWindow, ipcMain, dialog, session, screen, net, protocol } = require('electron');
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
const { configureLLM, setOutputStream, input: llmInput, setMemory, summarizeSession } = require('./llm/llm.js');
const { configureTTS, speak, stopTTS, setTTSWindow, handleVolume } = require('./tts/tts.js');
const { configureSTT, sttAvailable, startListening, stopListening, handleAudioChunk, setSTTWindow, setOnTranscript } = require('./stt/stt.js');
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

// ── Config / Memory persistence ───────────────────────────────────────────────
const CONFIG_DIR  = path.join(os.homedir(), '.kurochan');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const MEMORY_PATH = path.join(CONFIG_DIR, 'memory.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function writeConfig(data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function readMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8')); }
  catch { return []; }
}

function writeMemory(entries) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(entries, null, 2), 'utf8');
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

  // Wire the single LLM output stream → renderer chat display + TTS
  setOutputStream({
    onStart: () => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:stream:start', {});
    },
    onData: (chunk) => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:stream:data', { chunk });
    },
    onEnd: (fullReply) => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:stream:end', {});
      if (fullReply && fullReply.trim()) speak(fullReply.trim());
    },
    onError: (err) => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:stream:error', { message: err.message });
    },
  });
}

function configureAllServices(config) {
  // LLM
  configureLLM(config.llm ?? {});

  // Memory → LLM
  const memory = readMemory();
  setMemory(memory);

  // TTS
  configureTTS(config.tts ?? {});

  // STT (with whisper transcribe function injected)
  configureSTT(config.stt ?? {}, { transcribe: whisperTranscribe });

  // Route STT transcripts directly to LLM (not through chat)
  setOnTranscript((text) => {
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

// ── IPC: System / config ──────────────────────────────────────────────────────

ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.handle('get-config', () => {
  return readConfig();
});

ipcMain.handle('save-config', (event, data) => {
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

ipcMain.handle('get-memory', () => readMemory());

ipcMain.handle('save-memory', (_event, entry) => {
  const entries = readMemory();
  entries.push(entry);
  writeMemory(entries);
});

// ── IPC: Chat ─────────────────────────────────────────────────────────────────

ipcMain.handle('chat:builtin-send', (_event, { text }) => {
  handleBuiltinChatMessage(text);
});

// ── IPC: LLM ──────────────────────────────────────────────────────────────────

ipcMain.handle('llm:summarize', async () => {
  return summarizeSession();
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
