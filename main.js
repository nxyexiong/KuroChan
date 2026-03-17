const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { modelDir: '' }; }
}

function writeConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
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

  // Uncomment to open DevTools for debugging:
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  createWindow();
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

// Return config + resolved model file path
ipcMain.handle('get-config', () => {
  const config = readConfig();
  config.modelPath = null;
  const modelDir = config.modelDir || DEFAULT_MODEL_DIR;
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
        config.modelPath = rel.startsWith('..')
          ? 'file:///' + abs.replace(/\\/g, '/')
          : rel.replace(/\\/g, '/');
      }
    } catch { /* dir unreadable — modelPath stays null */ }
  }
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
