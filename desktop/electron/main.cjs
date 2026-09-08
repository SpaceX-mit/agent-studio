const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const { CodexServer } = require('./codex-server.cjs');
const { listMiniMaxModels } = require('./minimax-models.cjs');
const { readExtensionFile } = require('./extension-files.cjs');

const projectRoot = path.resolve(__dirname, '../..');
// Keep the replica's Electron profile inside the project. This is deliberately
// separate from the installed Codex Desktop profile and never touches it.
app.setPath('userData', path.join(projectRoot, '.project-cache', 'electron-user-data'));
const codex = new CodexServer(projectRoot);
let mainWindow;
let quitting = false;

function sendToWindow(channel, payload) {
  if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
  const contents = mainWindow.webContents;
  if (!contents.isDestroyed()) contents.send(channel, payload);
}

function wireRpc(rpc) {
  rpc.on('notification', message => sendToWindow('codex:notification', message));
  rpc.on('request', message => sendToWindow('codex:server-request', message));
  rpc.on('stderr', text => sendToWindow('codex:stderr', text));
  rpc.on('parse-error', info => sendToWindow('codex:error', info));
  rpc.on('closed', error => sendToWindow('codex:closed', { message: error?.message || String(error) }));
}

function getRpc() {
  if (quitting) throw new Error('Desktop is shutting down');
  const rpc = codex.start();
  if (!rpc.__wired) { rpc.__wired = true; wireRpc(rpc); }
  return rpc;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  const devUrl = process.env.VITE_DEV_SERVER_URL || (process.argv.includes('--dev') ? `http://127.0.0.1:${process.env.VITE_PORT || 5317}` : '');
  const productionFile = path.join(__dirname, '../dist/index.html');
  if (devUrl) {
    win.webContents.on('did-fail-load', () => {
      // Keep the desktop window usable if the dev server is not ready yet.
      win.loadFile(productionFile);
    });
    win.loadURL(devUrl).catch(() => win.loadFile(productionFile));
  } else {
    win.loadFile(productionFile);
  }
}

ipcMain.handle('window:toggle-maximize', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.handle('window:minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle('window:close', event => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.handle('desktop:provider-status', () => ({ provider: 'minimax', endpoint: 'https://api.minimaxi.com/v1', keyConfigured: Boolean(process.env.MINIMAX_API_KEY) }));
ipcMain.handle('desktop:list-models', () => listMiniMaxModels({ apiKey: process.env.MINIMAX_API_KEY }));
ipcMain.handle('desktop:project-root', () => projectRoot);
ipcMain.handle('desktop:extension-file', async (_event, { path: filename, kind }) => {
  try { return { ok: true, result: await readExtensionFile(projectRoot, filename, kind) }; }
  catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('codex:connect', () => {
  try { return { ok: true, command: getRpc().command, projectRoot }; }
  catch (error) { return { ok: false, error: error?.message || String(error), projectRoot }; }
});

ipcMain.handle('codex:request', async (_event, { method, params }) => {
  if (method === 'turn/start' && !process.env.MINIMAX_API_KEY?.trim()) {
    return { ok: false, error: { message: 'Missing environment variable: MINIMAX_API_KEY', code: 'missing_api_key' } };
  }
  try { return { ok: true, result: await getRpc().request(method, params || {}) }; }
  catch (error) { return { ok: false, error: { message: error?.message || String(error), code: error?.code, data: error?.data } }; }
});

ipcMain.handle('codex:notify', (_event, { method, params }) => {
  try { getRpc().notify(method, params || {}); return { ok: true }; }
  catch (error) { return { ok: false, error: error?.message || String(error) }; }
});

ipcMain.handle('codex:respond', (_event, { id, result, error }) => {
  try { getRpc().respond(id, result, error); return { ok: true }; }
  catch (err) { return { ok: false, error: err?.message || String(err) }; }
});

ipcMain.handle('codex:stop', () => { codex.stop(); return { ok: true }; });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { quitting = true; codex.stop(); });
