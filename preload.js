const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  closeWindow:      () => ipcRenderer.send('close-window'),
  getConfig:        () => ipcRenderer.invoke('get-config'),
  saveConfig:       (data) => ipcRenderer.invoke('save-config', data),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
});
