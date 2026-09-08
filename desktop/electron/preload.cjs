const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  providerStatus: () => ipcRenderer.invoke('desktop:provider-status'),
  listModels: () => ipcRenderer.invoke('desktop:list-models'),
  getProjectRoot: () => ipcRenderer.invoke('desktop:project-root'),
  readExtensionFile: (path, kind) => ipcRenderer.invoke('desktop:extension-file', { path, kind })
});

contextBridge.exposeInMainWorld('codex', {
  connect: () => ipcRenderer.invoke('codex:connect'),
  request: (method, params) => ipcRenderer.invoke('codex:request', { method, params }),
  notify: (method, params) => ipcRenderer.invoke('codex:notify', { method, params }),
  respond: (id, result, error) => ipcRenderer.invoke('codex:respond', { id, result, error }),
  stop: () => ipcRenderer.invoke('codex:stop'),
  onNotification: listener => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('codex:notification', handler);
    return () => ipcRenderer.removeListener('codex:notification', handler);
  },
  onServerRequest: listener => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('codex:server-request', handler);
    return () => ipcRenderer.removeListener('codex:server-request', handler);
  },
  onError: listener => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('codex:error', handler);
    return () => ipcRenderer.removeListener('codex:error', handler);
  },
  onStderr: listener => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('codex:stderr', handler);
    return () => ipcRenderer.removeListener('codex:stderr', handler);
  },
  onClosed: listener => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('codex:closed', handler);
    return () => ipcRenderer.removeListener('codex:closed', handler);
  }
});
