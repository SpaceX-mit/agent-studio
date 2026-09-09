const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  customFrame: process.argv.includes('--felix-soft-frame'),
  windowState: () => ipcRenderer.invoke('window:state'),
  resizeFrame: input => ipcRenderer.send('window:resize-frame', input),
  onWindowState: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  },
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  providerStatus: () => ipcRenderer.invoke('desktop:provider-status'),
  listModels: () => ipcRenderer.invoke('desktop:list-models'),
  getProjectRoot: () => ipcRenderer.invoke('desktop:project-root'),
  pickFiles: () => ipcRenderer.invoke('desktop:pick-files'),
  readExtensionFile: (path, kind) => ipcRenderer.invoke('desktop:extension-file', { path, kind }),
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  saveTask: input => ipcRenderer.invoke('tasks:save', input),
  setTaskStatus: (id, status) => ipcRenderer.invoke('tasks:status', { id, status }),
  runTask: id => ipcRenderer.invoke('tasks:run', { id }),
  cancelTask: id => ipcRenderer.invoke('tasks:cancel', { id }),
  deleteTask: id => ipcRenderer.invoke('tasks:delete', { id }),
  taskDetail: id => ipcRenderer.invoke('tasks:detail', { id }),
  onTasksChanged: listener => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('tasks:changed', handler);
    return () => ipcRenderer.removeListener('tasks:changed', handler);
  }
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
