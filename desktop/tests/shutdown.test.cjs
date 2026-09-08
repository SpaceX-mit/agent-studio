const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { CodexRpc } = require('../electron/codex-rpc.cjs');

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
async function mainHarness() {
  const app = new EventEmitter();
  app.setPath = () => {};
  app.whenReady = () => Promise.resolve();
  const handlers = new Map();
  const windows = [];
  const rpc = new EventEmitter();
  const sent = [];
  let stopped = 0;
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
  const electron = { app, BrowserWindow: Window, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, Menu: { setApplicationMenu() {} } };
  const filename = path.join(__dirname, '../electron/main.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'electron' ? electron : name === './codex-server.cjs' ? { CodexServer: Server } : createRequire(filename)(name),
    __dirname: path.dirname(filename), process: { env: {}, argv: [], platform: 'win32' }
  }, { filename });
  await Promise.resolve();
  handlers.get('codex:connect')();
  return { app, handlers, rpc, sent, win: windows[0], stopCount: () => stopped };
}

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
