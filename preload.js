const { contextBridge, ipcRenderer } = require('electron');

// Since nodeIntegration is enabled, we don't need to expose as much through contextBridge
// But we'll keep this for future compatibility if needed
contextBridge.exposeInMainWorld('electronAPI', {
  getServerInfo: () => ipcRenderer.invoke('get-server-info')
});
