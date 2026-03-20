/**
 * preload.js — Context bridge between main and renderer.
 *
 * Exposes a clean API on window.electronAPI. The renderer never calls
 * ipcRenderer directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── System / config ─────────────────────────────────────────────────────
  closeWindow:      () => ipcRenderer.send('close-window'),
  getConfig:        () => ipcRenderer.invoke('get-config'),
  saveConfig:       (data) => ipcRenderer.invoke('save-config', data),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  openFileDialog:   (opts) => ipcRenderer.invoke('open-file-dialog', opts),
  getMemory:        () => ipcRenderer.invoke('get-memory'),
  saveMemory:       (entry) => ipcRenderer.invoke('save-memory', entry),

  // ── Chat ────────────────────────────────────────────────────────────────
  chatBuiltinSend: (text) => ipcRenderer.invoke('chat:builtin-send', { text }),

  // Chat push events (main → renderer)
  onChatStreamStart: (fn) => ipcRenderer.on('chat:stream:start', (_e, d) => fn(d)),
  onChatStreamData:  (fn) => ipcRenderer.on('chat:stream:data',  (_e, d) => fn(d)),
  onChatStreamEnd:   (fn) => ipcRenderer.on('chat:stream:end',   (_e, d) => fn(d)),
  onChatStreamError: (fn) => ipcRenderer.on('chat:stream:error', (_e, d) => fn(d)),

  // ── LLM ─────────────────────────────────────────────────────────────────
  llmSummarize: () => ipcRenderer.invoke('llm:summarize'),

  // ── TTS ─────────────────────────────────────────────────────────────────
  ttsStop:   () => ipcRenderer.invoke('tts:stop'),
  ttsVolume: (vol) => ipcRenderer.send('tts:volume', vol),

  // TTS push events (main → renderer): chunked AAC stream
  onTTSStart: (fn) => ipcRenderer.on('tts:start', (_e, d) => fn(d)),
  onTTSChunk: (fn) => ipcRenderer.on('tts:chunk', (_e, d) => fn(d)),
  onTTSEnd:   (fn) => ipcRenderer.on('tts:end',   (_e, d) => fn(d)),
  onTTSError: (fn) => ipcRenderer.on('tts:error', (_e, d) => fn(d)),
  onTTSStop:  (fn) => ipcRenderer.on('tts:stop',  (_e, d) => fn(d)),

  // ── STT ─────────────────────────────────────────────────────────────────
  sttStart:      (sampleRate) => ipcRenderer.invoke('stt:start', { sampleRate }),
  sttStop:       ()           => ipcRenderer.invoke('stt:stop'),
  sttReady:      ()           => ipcRenderer.invoke('stt:ready'),
  sttAudioChunk: (buffer)     => ipcRenderer.send('stt:audio-chunk', buffer),

  // STT push events (main → renderer)
  onSTTVadState: (fn) => ipcRenderer.on('stt:vad-state', (_e, d) => fn(d)),
  onSTTError:    (fn) => ipcRenderer.on('stt:error',     (_e, d) => fn(d)),

  // ── Model push events (main → renderer) ─────────────────────────────────
  onModelSetParam: (fn) => ipcRenderer.on('model:set-parameter', (_e, d) => fn(d)),
  onModelStatus:   (fn) => ipcRenderer.on('model:status',        (_e, d) => fn(d)),
});
