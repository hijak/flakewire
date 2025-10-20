const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openExternalPlayer: (url) => ipcRenderer.invoke('open-external-player', url)
});
