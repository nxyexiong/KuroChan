const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeWindow:      () => ipcRenderer.send('close-window'),
  getConfig:        () => ipcRenderer.invoke('get-config'),
  saveConfig:       (data) => ipcRenderer.invoke('save-config', data),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  openFileDialog:   (opts) => ipcRenderer.invoke('open-file-dialog', opts),
  getMemory:        () => ipcRenderer.invoke('get-memory'),
  saveMemory:       (entry) => ipcRenderer.invoke('save-memory', entry),
  sttCheck:         (payload) => ipcRenderer.invoke('stt-check', payload),
  sttTranscribe:    (payload) => ipcRenderer.invoke('stt-transcribe', payload),
});
