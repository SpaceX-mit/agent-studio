const { app, BrowserWindow, ipcMain, Menu, Notification, dialog, screen } = require('electron');
const path = require('node:path');
const { CodexServer } = require('./codex-server.cjs');
const { listMiniMaxModels } = require('./minimax-models.cjs');
const { readExtensionFile } = require('./extension-files.cjs');
const { TaskScheduler } = require('./task-scheduler.cjs');
const { createTaskRunner } = require('./task-runner.cjs');
const { wireWindowFrame } = require('./window-frame.cjs');
const customFrame = process.platform === 'win32' && Number(require('node:os').release().split('.')[2]) < 22000;

const projectRoot = path.resolve(__dirname, '../..');
// Keep the replica's Electron profile inside the project. This is deliberately
// separate from the installed Codex Desktop profile and never touches it.
app.setPath('userData', path.join(projectRoot, '.project-cache', 'electron-user-data'));
// Acquire the project profile lock before loading or recovering persisted runs.
if (app.requestSingleInstanceLock()) startDesktop();
else app.quit();

function startDesktop() {
const codex = new CodexServer(projectRoot);
const scheduler = new TaskScheduler({
  directory: path.join(projectRoot, '.project-cache', 'scheduled-tasks'),
  runner: createTaskRunner(projectRoot),
});
let mainWindow;
let manualMaximized = false;
let restoreBounds;
let quitting = false;
let tasksStopped = false;
let stoppingTasks;
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed() || quitting) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
});
scheduler.on('changed', () => sendToWindow('tasks:changed', {}));
scheduler.on('failure', message => sendToWindow('tasks:changed', { error: message }));
scheduler.on('finished', task => {
  if (quitting || !task.notify || !Notification?.isSupported()) return;
  const run = task.runs[0];
  const body = run.status === 'completed' ? task.kind === 'reminder' ? task.prompt.slice(0, 240) : '任务已完成，可在已安排页面查看结果。' : run.error || '任务未完成，请查看运行记录。';
  try { new Notification({ title: task.name, body }).show(); } catch { /* Task results remain available when OS notifications are disabled. */ }
});

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
    title: 'Felix',
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    // Windows 10 cannot recolor DWM borders. Draw a soft client-side edge there.
    transparent: customFrame,
    thickFrame: !customFrame,
    hasShadow: !customFrame,
    accentColor: '#d9dcdf',
    backgroundColor: customFrame ? '#00000000' : '#f7f7f7',
    webPreferences: {
      additionalArguments: customFrame ? ['--felix-soft-frame'] : [],
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  });
  mainWindow = win;
  wireWindowFrame(win, ipcMain, customFrame);
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

ipcMain.handle('window:toggle-maximize', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { maximized: false };
  const shouldMaximize = !manualMaximized && !(win.isMaximized() || win.isFullScreen());
  if (shouldMaximize) {
    restoreBounds = win.getBounds();
    const display = screen.getDisplayMatching(restoreBounds);
    win.setBounds(display.workArea, false);
    manualMaximized = true;
  } else {
    if (restoreBounds) win.setBounds(restoreBounds, false);
    manualMaximized = false;
  }
  win.__manualMaximized = manualMaximized;
  if (!win.webContents.isDestroyed()) win.webContents.send('window:state', { maximized: manualMaximized });
  // Windows may apply maximize/unmaximize asynchronously, especially after
  // moving the frameless window between monitors. Let DWM settle first.
  await new Promise(resolve => setTimeout(resolve, 80));
  return { maximized: manualMaximized || win.isMaximized() || win.isFullScreen() };
});
ipcMain.handle('window:minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle('window:close', event => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.handle('desktop:provider-status', () => ({ provider: 'minimax', endpoint: 'https://api.minimaxi.com/v1', keyConfigured: Boolean(process.env.MINIMAX_API_KEY) }));
ipcMain.handle('desktop:list-models', () => listMiniMaxModels({ apiKey: process.env.MINIMAX_API_KEY }));
ipcMain.handle('desktop:project-root', () => projectRoot);
ipcMain.handle('desktop:pick-files', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { title: '选择附件', properties: ['openFile', 'multiSelections'] });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('desktop:extension-file', async (_event, { path: filename, kind }) => {
  try { return { ok: true, result: await readExtensionFile(projectRoot, filename, kind) }; }
  catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('tasks:list', () => { try { return { ok: true, tasks: scheduler.list() }; } catch (error) { return { ok: false, error: error.message, tasks: [] }; } });
ipcMain.handle('tasks:save', (_event, input) => { try { return { ok: true, task: scheduler.save(input) }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('tasks:status', (_event, { id, status }) => { try { scheduler.setStatus(id, status); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('tasks:run', (_event, { id }) => { try { scheduler.run(id).catch(error => scheduler.emit('failure', error.message)); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('tasks:cancel', (_event, { id }) => { try { scheduler.cancel(id); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('tasks:delete', (_event, { id }) => { try { scheduler.remove(id); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('tasks:detail', (_event, { id }) => { try { return { ok: true, task: scheduler.detail(id) }; } catch (error) { return { ok: false, error: error.message }; } });

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
  scheduler.start();
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  quitting = true;
  codex.stop();
  if (scheduler.active && !tasksStopped && event?.preventDefault) {
    event.preventDefault();
    stoppingTasks ||= scheduler.stop().catch(() => undefined).finally(() => { tasksStopped = true; app.quit(); });
  } else if (!stoppingTasks) stoppingTasks = scheduler.stop().catch(() => undefined);
});
}
