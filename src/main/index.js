/**
 * index.js — Electron main process entry point.
 *
 * KuroChan launches as a desktop app AND, at the same time, a web companion
 * server so you can also reach the full app from a browser (phone / another PC)
 * on your LAN. It is a SINGLE instance: the desktop window and every connected
 * browser are views of the same backend (same services, config, and Copilot
 * conversation). Events are broadcast to all of them via app-core's composite
 * push target.
 *
 * This file wires the two transports to the shared core (app-core.js) and owns
 * the Electron-desktop-only concerns (window, native dialogs, global cursor /
 * hotkey) plus the web server's lifecycle (started/stopped/restarted from the
 * `server` section of the config).
 */
const { app, BrowserWindow, ipcMain, dialog, session, screen, net, protocol, globalShortcut } = require('electron');
const path = require('path');

// Force UTF-8 console output on Windows
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const k32   = koffi.load('kernel32.dll');
    k32.func('bool SetConsoleOutputCP(uint codepage)')(65001);
  } catch { /* non-fatal */ }
}

const appCore = require('./app-core.js');
const { startWebServer } = require('./web/server.js');

// ── Web companion server lifecycle ────────────────────────────────────────────
let _webServer = null;      // handle from startWebServer(), or null when stopped
let _webServerError = null; // last start error message, surfaced via server:info

/** Derive validated web-server options from the `server` config section. */
function serverOptsFromConfig(config) {
  const s = (config && config.server) || {};
  const enabled  = s.enabled !== false; // default: on
  const useHttps = s.https  !== false;  // default: HTTPS (needed for phone mic)
  let port = parseInt(s.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) port = useHttps ? 8443 : 8080;
  return { enabled, https: useHttps, port, host: '0.0.0.0' };
}

/** Start/stop/restart the web companion to match the current config. */
async function applyWebServer(config) {
  const opts = serverOptsFromConfig(config);
  if (_webServer) { try { await _webServer.close(); } catch { /* ignore */ } _webServer = null; }
  _webServerError = null;
  if (!opts.enabled) return;
  try {
    _webServer = await startWebServer(opts);
  } catch (err) {
    _webServerError = (err && err.message) ? err.message : String(err);
    console.error('[Web] Failed to start companion server:', _webServerError);
  }
}

// ── Window creation ───────────────────────────────────────────────────────────
let mainWindow;

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

  // Poll global cursor position so the Live2D model can track it. Sent only to
  // the desktop window — web clients synthesize their own cursor locally.
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

// The desktop window as an app-core push sink. Reads `mainWindow` live, so it
// keeps working across a renderer-crash recreate. Registered once.
const desktopSink = {
  isAlive: () => !!(mainWindow && !mainWindow.isDestroyed()),
  reload:  () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); },
  send:    (channel, data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); },
};

// ── Electron IPC transport (desktop renderer) ─────────────────────────────────
// Thin pass-throughs to app-core. Only the Electron-specific bits (native
// dialogs, window control, file:// model URLs) live here.
function registerElectronIpc() {
  ipcMain.on('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  ipcMain.handle('get-config', () => appCore.handleGetConfig());

  // Save persists + reconfigures in app-core, whose post-save hook restarts the
  // web server if needed and reloads ALL views (desktop window + web clients).
  ipcMain.handle('save-config', (_event, data) => appCore.handleSaveConfig(data));

  ipcMain.handle('server:info', () => appCore.handleServerInfo());

  ipcMain.handle('resolve-model-dir', (_event, modelDir) => {
    const r = appCore.findModel3(modelDir);
    return r ? 'file:///' + path.join(r.absDir, r.fileName).replace(/\\/g, '/') : null;
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

  ipcMain.handle('chat:builtin-send', (_event, arg) => appCore.handleChatSend(arg));

  ipcMain.handle('copilot:auth-status',   () => appCore.handleCopilotAuthStatus());
  ipcMain.handle('copilot:login',         () => appCore.handleCopilotLogin());
  ipcMain.handle('copilot:list-models',   () => appCore.handleCopilotListModels());
  ipcMain.handle('copilot:reset-session', () => appCore.handleCopilotResetSession());

  ipcMain.handle('tts:stop', () => appCore.handleTtsStop());
  ipcMain.on('tts:volume', (_event, vol) => appCore.handleTtsVolume(vol));

  ipcMain.handle('stt:start', (_event, arg) => appCore.handleSttStart(arg));
  ipcMain.handle('stt:stop', () => appCore.handleSttStop());
  ipcMain.on('stt:audio-chunk', (_event, buffer) => appCore.handleSttAudioChunk(buffer));
  ipcMain.handle('stt:ready', () => appCore.handleSttReady());
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Allow the renderer to fetch file:// URLs (for Live2D model assets).
  protocol.handle('file', (req) => net.fetch(req.url, { bypassCustomProtocolHandlers: true }));

  const config = appCore.readConfig();

  // Configure services first (creates service instances), then wire them to the
  // composite target and register the desktop window as a push sink.
  appCore.configureAllServices(config);
  appCore.initServices();
  appCore.registerSink(desktopSink);

  // After any save (from desktop OR a browser): restart the web server if its
  // settings changed, then reload every view.
  appCore.setAfterSaveHook(async ({ serverChanged }) => {
    if (serverChanged) await applyWebServer(appCore.readConfig());
    appCore.reloadAll();
  });

  // Let the Settings UI show the live server status / connect URLs.
  appCore.setServerInfoProvider(() => {
    if (_webServer) return { running: true, https: _webServer.https, port: _webServer.port, urls: _webServer.urls() };
    const opts = serverOptsFromConfig(appCore.readConfig());
    return { running: false, enabled: opts.enabled, https: opts.https, port: opts.port, error: _webServerError };
  });

  registerElectronIpc();
  createWindow();

  // Start the web companion server (unless disabled in config).
  await applyWebServer(config);

  // Global hotkey: Ctrl+M to toggle mic (desktop window only).
  globalShortcut.register('CommandOrControl+M', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotkey:toggle-mic');
  });

  // Grant microphone access.
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

// Graceful shutdown: close the web server, then stop the Copilot CLI and the
// Kokoro synthesis worker before exiting. The worker must be drained to idle —
// quitting mid-inference (an uninterruptible native call) crashes the runtime.
let _quitting = false;
app.on('before-quit', (event) => {
  if (_quitting) return;
  _quitting = true;
  event.preventDefault();
  (async () => {
    if (_webServer) { try { await _webServer.close(); } catch { /* ignore */ } _webServer = null; }
    try { await appCore.dispose(); } catch { /* ignore */ }
    app.exit(0);
  })();
});
