const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CodexRpc } = require('../electron/codex-rpc.cjs');
const { TaskScheduler } = require('../electron/task-scheduler.cjs');

function mockChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  return child;
}

test('close followed by process exit and pipe error emits closed only once', async () => {
  const child = mockChild();
  const rpc = new CodexRpc(child);
  let closed = 0;
  rpc.on('closed', () => closed++);
  const pending = assert.rejects(rpc.request('thread/start'), /closed/);
  rpc.close();
  child.emit('exit', 0, null);
  child.stdin.emit('error', new Error('EPIPE'));
  child.emit('error', new Error('late process error'));
  rpc.close();
  await pending;
  assert.equal(closed, 1);
  assert.equal(rpc.pending.size, 0);
  assert.equal(child.killed, true);
  await assert.rejects(rpc.request('initialize'), /closed/);
  assert.throws(() => rpc.notify('initialized'), /closed/);
  assert.throws(() => rpc.respond(1, {}), /closed/);
});

test('late stdout and stderr are ignored after RPC closure', () => {
  const child = mockChild();
  const rpc = new CodexRpc(child);
  rpc.on('notification', () => assert.fail('late notification'));
  rpc.on('stderr', () => assert.fail('late stderr'));
  rpc.close();
  child.stdout.emit('data', '{"method":"turn/completed"}\n');
  child.stderr.emit('data', 'late warning');
});

test('unexpected exit still reports failure to a connected client', async () => {
  const child = mockChild();
  const rpc = new CodexRpc(child);
  let failure;
  rpc.on('closed', error => { failure = error; });
  const pending = assert.rejects(rpc.request('initialize'), /exited \(1/);
  child.emit('exit', 1, null);
  await pending;
  assert.match(failure.message, /exited \(1/);
});

// Exercise the real main-process event wiring without opening or quitting the user's window.
async function mainHarness({ lock = true, runner = async () => ({ output: 'task output' }) } = {}) {
  const app = new EventEmitter();
  app.setPath = () => {};
  app.requestSingleInstanceLock = () => lock;
  let quits = 0, scheduler;
  app.quit = () => { quits++; };
  app.whenReady = () => Promise.resolve();
  const handlers = new Map();
  const windows = [];
  const rpc = new EventEmitter();
  const sent = [];
  let stopped = 0;
  const notifications = [];
  const cache = path.resolve(__dirname, '../../.project-cache/tmp');
  fs.mkdirSync(cache, { recursive: true });
  class Scheduler extends TaskScheduler {
    constructor() { super({ directory: fs.mkdtempSync(path.join(cache, 'task-main-')), runner }); scheduler = this; }
  }
  class Notification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; }
    show() { notifications.push(this.options); }
  }
  class Window extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.contents = { isDestroyed: () => this.rendererDestroyed, send: (...args) => sent.push(args) };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    get webContents() {
      if (this.destroyed) throw new TypeError('Object has been destroyed');
      return this.contents;
    }
    loadFile() { return Promise.resolve(); }
  }
  class Server {
    start() { return rpc; }
    stop() { stopped++; rpc.emit('closed', new Error('closed')); }
  }
  const ipcMain = Object.assign(new EventEmitter(), { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) });
  const electron = { app, BrowserWindow: Window, Notification, ipcMain, Menu: { setApplicationMenu() {} } };
  const filename = path.join(__dirname, '../electron/main.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'electron' ? electron : name === './codex-server.cjs' ? { CodexServer: Server } : name === './task-scheduler.cjs' ? { TaskScheduler: Scheduler } : createRequire(filename)(name),
    __dirname: path.dirname(filename), process: { env: {}, argv: [], platform: 'win32' }
  }, { filename });
  await Promise.resolve();
  handlers.get('codex:connect')?.();
  return { app, handlers, rpc, sent, scheduler, notifications, quitCount: () => quits, win: windows[0], stopCount: () => stopped };
}

test('second desktop instance cannot load task storage or register IPC', async () => {
  const h = await mainHarness({ lock: false });
  assert.equal(h.scheduler, undefined);
  assert.equal(h.handlers.size, 0);
  assert.equal(h.quitCount(), 1);
});

test('task IPC persists changes, emits updates and notifies only opted-in tasks', async () => {
  const h = await mainHarness({ runner: async () => { throw new Error('MODEL_FAILURE'); } });
  const invoke = (name, input) => h.handlers.get(`tasks:${name}`)({}, input);
  const draft = { name: 'Reminder', prompt: 'Remember the report', kind: 'reminder', permission: 'read-only', notify: true, schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' } };
  const saved = invoke('save', draft); assert.equal(saved.ok, true);
  assert.equal(invoke('list').tasks.length, 1);
  assert.ok(h.sent.some(([channel]) => channel === 'tasks:changed'));
  assert.equal(invoke('run', { id: saved.task.id }).ok, true); await h.scheduler.active.done;
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].body, draft.prompt);
  assert.equal(invoke('detail', { id: saved.task.id }).task.runs[0].output, draft.prompt);
  const failed = invoke('save', { ...draft, kind: 'agent', model: 'test' });
  invoke('run', { id: failed.task.id }); await h.scheduler.active.done;
  assert.equal(h.notifications[1].body, 'MODEL_FAILURE');
  const quiet = invoke('save', { ...draft, notify: false });
  invoke('run', { id: quiet.task.id }); await h.scheduler.active.done;
  assert.equal(h.notifications.length, 2);
  assert.equal(invoke('status', { id: saved.task.id, status: 'paused' }).ok, true);
  assert.equal(invoke('delete', { id: saved.task.id }).ok, true);
  assert.equal(invoke('detail', { id: saved.task.id }).ok, false);
  await h.scheduler.stop();
});

test('quit aborts an active task once and contains persistence failure', async () => {
  const h = await mainHarness({ runner: async (_task, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) });
  const saved = h.scheduler.save({ name: 'Wait', prompt: 'Wait', kind: 'agent', model: 'test', permission: 'read-only', notify: false, schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' } });
  const done = h.scheduler.run(saved.id); await Promise.resolve();
  h.scheduler.persist = () => { throw new Error('DISK_FAILURE'); };
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } };
  h.app.emit('before-quit', event); h.app.emit('before-quit', event);
  await assert.rejects(done, /DISK_FAILURE/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, 2);
  assert.equal(h.quitCount(), 1);
  assert.equal(h.scheduler.closed, true);
});

function emitAll(rpc) {
  for (const name of ['notification', 'request', 'stderr', 'parse-error', 'closed']) rpc.emit(name, new Error('test event'));
}

test('all RPC event channels forward while the window is alive', async () => {
  const h = await mainHarness();
  emitAll(h.rpc);
  assert.equal(h.sent.length, 5);
});

for (const state of ['window destroyed', 'renderer destroyed', 'closed event', 'app quitting']) {
  test(`shutdown forwarding is safe: ${state}`, async () => {
    const h = await mainHarness();
    if (state === 'window destroyed') h.win.destroyed = true;
    if (state === 'renderer destroyed') h.win.rendererDestroyed = true;
    if (state === 'closed event') { h.win.destroyed = true; h.win.emit('closed'); }
    if (state === 'app quitting') {
      h.app.emit('before-quit');
      assert.equal(h.stopCount(), 1);
      assert.equal(h.handlers.get('codex:connect')().ok, false);
    }
    assert.doesNotThrow(() => emitAll(h.rpc));
    assert.equal(h.sent.length, 0);
  });
}
