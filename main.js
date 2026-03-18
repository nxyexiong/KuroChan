const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Force UTF-8 console output on Windows so non-ASCII transcripts display correctly
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const k32   = koffi.load('kernel32.dll');
    k32.func('bool SetConsoleOutputCP(uint codepage)')(65001);
  } catch { /* non-fatal — terminal may still show garbled non-ASCII */ }
}

// ── Whisper / koffi state ─────────────────────────────────────────────────────
let _whisperTranscribeFn = null; // koffi function handle, loaded lazily

function loadWhisperDLL() {
  if (_whisperTranscribeFn) return true;

  const dllPath = path.join(__dirname, 'resources', 'whisper', 'whisper_kuro.dll');
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
    // koffi .async() appends a Node-style callback, making the call appear to
    // have 7 arguments. Use util.promisify so the call stays at 6 arguments.
    const { promisify } = require('util');
    _whisperTranscribeFn = promisify(fn.async.bind(fn));
    return true;
  } catch (err) {
    console.error('[Whisper] Failed to load whisper_kuro.dll:', err.message);
    return false;
  }
}

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

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
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

  // Recreate window on renderer crash instead of silently disappearing
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Electron] Renderer process gone:', details.reason, details.exitCode);
    createWindow();
  });
}

app.whenReady().then(() => {
  createWindow();

  // Grant microphone access so getUserMedia doesn't hang indefinitely
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') return true;
    return false;
  });

  // Rewrite the Origin header for WebSocket upgrade requests to the OpenClaw
  // gateway so the gateway's origin-allowlist check passes. The renderer runs
  // from file:// which the gateway rejects; we spoof the origin to match the
  // gateway host (the only host that is always allowed without extra config).
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      if (headers['Origin'] === 'file://') {
        try {
          const u = new URL(details.url);
          headers['Origin'] = `${u.protocol === 'wss:' ? 'https' : 'http'}://${u.host}`;
        } catch { /* leave as-is if URL is unparseable */ }
      }
      callback({ requestHeaders: headers });
    },
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Close window from renderer
ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

const DEFAULT_MODEL_DIR = 'assets/models/Haru';

// Return config + resolved model file path injected into general section
ipcMain.handle('get-config', () => {
  const config = readConfig();
  const model = config.model ?? {};
  const modelDir = model.modelDir || DEFAULT_MODEL_DIR;
  model.modelPath = null;
  if (modelDir) {
    try {
      const dir = path.isAbsolute(modelDir)
        ? modelDir
        : path.join(__dirname, modelDir);
      const f = fs.readdirSync(dir).find(n => n.endsWith('.model3.json'));
      if (f) {
        const abs = path.join(dir, f);
        const rel = path.relative(__dirname, abs);
        // Use relative path when inside app dir, else file:// URL
        model.modelPath = rel.startsWith('..')
          ? 'file:///' + abs.replace(/\\/g, '/')
          : rel.replace(/\\/g, '/');
      }
    } catch { /* dir unreadable — modelPath stays null */ }
  }
  config.model = model;
  return config;
});

// Persist config then reload the renderer
ipcMain.handle('save-config', (event, data) => {
  writeConfig(data);
  BrowserWindow.fromWebContents(event.sender)?.reload();
});

// Native folder picker
ipcMain.handle('open-folder-dialog', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Select model folder',
    properties: ['openDirectory'],
  });
  return canceled ? null : filePaths[0];
});

// Read all memory entries
ipcMain.handle('get-memory', () => readMemory());

// Append a new memory entry
ipcMain.handle('save-memory', (event, entry) => {
  const entries = readMemory();
  entries.push(entry);
  writeMemory(entries);
});

// Native file picker (used for whisper model selection)
ipcMain.handle('open-file-dialog', async (event, { title, filters } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title:      title  || 'Select file',
    filters:    filters || [],
    properties: ['openFile'],
  });
  return canceled ? null : filePaths[0];
});

// Validate that the DLL and model file are present before the user tries to record
ipcMain.handle('stt-check', (_event, { modelPath }) => {
  const dllPath = path.join(__dirname, 'resources', 'whisper', 'whisper_kuro.dll');
  if (!fs.existsSync(dllPath)) {
    return { ok: false, error: 'whisper_kuro.dll not found. Run: npm run build:whisper' };
  }
  const absModelPath = path.isAbsolute(modelPath)
    ? modelPath
    : path.join(__dirname, modelPath);
  if (!fs.existsSync(absModelPath)) {
    return { ok: false, error: `Whisper model not found: ${absModelPath}\nDownload a .bin model and set its path in Settings -> STT.` };
  }
  return { ok: true };
});

// Transcribe audio with local whisper DLL (runs in koffi background thread)
ipcMain.handle('stt-transcribe', async (event, { samplesBuffer, modelPath, nThreads = 4, language = 'en' }) => {
  if (!loadWhisperDLL()) {
    throw new Error(
      'whisper_kuro.dll not found.\n' +
      'Run: npm run build:whisper\n' +
      'Then download a GGML model to resources/whisper/'
    );
  }

  const absModelPath = path.isAbsolute(modelPath)
    ? modelPath
    : path.join(__dirname, modelPath);

  if (!fs.existsSync(absModelPath)) {
    throw new Error(`Whisper model not found: ${absModelPath}`);
  }

  const samples = new Float32Array(samplesBuffer);
  const outBuf  = Buffer.alloc(32768); // 32 KB — enough for any transcript

  const n = await _whisperTranscribeFn(
    absModelPath,
    samples,
    samples.length,
    nThreads,
    language,
    outBuf,
    outBuf.length
  );

  if (n <= 1) return ''; // 0 = error, 1 = empty (no speech detected)

  const transcript = outBuf.slice(0, n - 1).toString('utf8');
  console.log(`[Whisper] language="${language}"  transcript: ${transcript}`);
  return transcript;
});

// ── Ed25519 device identity (OpenClaw gateway auth) ───────────────────────────
// Web Crypto in the Electron renderer doesn't support Ed25519 (Chrome 120 /
// Electron 28). Offload to the main process where Node's crypto works.
ipcMain.handle('device-identity-generate', () => {
  const nodeCrypto = require('crypto');
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  // Extract raw 32-byte public key (SPKI DER: 12-byte header + 32 bytes).
  const pubRaw  = publicKey.slice(12);
  // Extract 32-byte seed from PKCS#8 DER (16-byte header + 32 bytes).
  const privSeed = privateKey.slice(16, 48);
  const hashBuf  = nodeCrypto.createHash('sha256').update(pubRaw).digest();
  const deviceId = hashBuf.toString('hex');
  const b64u = (buf) => buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return { deviceId, publicKey: b64u(pubRaw), privateKey: b64u(privSeed) };
});

ipcMain.handle('device-identity-sign', (_event, { privateKeyB64u, payload }) => {
  const nodeCrypto = require('crypto');
  // Decode base64url seed and wrap back into PKCS#8 DER for Node's createPrivateKey.
  const PKCS8_PREFIX = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const norm   = privateKeyB64u.replaceAll('-', '+').replaceAll('_', '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const seed   = Buffer.from(padded, 'base64');
  const pkcs8  = Buffer.concat([PKCS8_PREFIX, seed]);
  const privKey = nodeCrypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const sig = nodeCrypto.sign(null, Buffer.from(payload, 'utf8'), privKey);
  return sig.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
});
