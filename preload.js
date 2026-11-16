const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openOverlay: (type) => ipcRenderer.send('open-overlay', type),
  keyhookToggle: (on) => ipcRenderer.invoke('keyhook-toggle', on),
  keyhookState: () => ipcRenderer.invoke('keyhook-state'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (patch) => ipcRenderer.invoke('update-config', patch),
  tunnelToggle: (on) => ipcRenderer.invoke('tunnel-toggle', on),
  tunnelState: () => ipcRenderer.invoke('tunnel-state'),
  onTunnelUrl: (cb) => ipcRenderer.on('tunnel-url', (e, url) => cb(url)),
  onTunnelState: (cb) => ipcRenderer.on('tunnel-state', (e, state) => cb(state)),
});
