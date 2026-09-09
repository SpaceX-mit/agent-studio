const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { resizeBounds, wireWindowFrame } = require('../electron/window-frame.cjs');

test('all resize edges preserve the opposite edge and enforce minimum size', () => {
  const bounds = { x: 100, y: 100, width: 1280, height: 820 };
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const result = resizeBounds(bounds, edge, 50, 40, [960, 640]);
    assert.equal(result.width, edge.includes('w') ? 1230 : edge.includes('e') ? 1330 : 1280);
    assert.equal(result.height, edge.includes('n') ? 780 : edge.includes('s') ? 860 : 820);
    assert.equal(result.x, edge.includes('w') ? 150 : 100);
    assert.equal(result.y, edge.includes('n') ? 140 : 100);
  }
  assert.deepEqual(resizeBounds(bounds, 'nw', 9000, 9000, [960, 640]), { x: 420, y: 280, width: 960, height: 640 });
  assert.deepEqual(resizeBounds(bounds, 'se', -9000, -9000, [960, 640]), { ...bounds, width: 960, height: 640 });
});

test('frame bridge rejects foreign windows and invalid input, cancels on blur and cleans up', () => {
  const handlers = new Map(), ipc = Object.assign(new EventEmitter(), { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) });
  let bounds = { x: 100, y: 100, width: 1280, height: 820 }, maximized = false;
  const win = Object.assign(new EventEmitter(), { webContents: { isDestroyed: () => false, send() {} }, isMaximized: () => maximized, isFullScreen: () => false, getBounds: () => bounds, setBounds: value => { bounds = value; }, getMinimumSize: () => [960, 640] });
  wireWindowFrame(win, ipc, true);
  const send = input => ipc.emit('window:resize-frame', { sender: win.webContents }, input);
  send({ phase: 'start', edge: 'bad', x: 0, y: 0 }); send({ phase: 'move', x: 100, y: 100 }); assert.equal(bounds.width, 1280);
  ipc.emit('window:resize-frame', { sender: {} }, { phase: 'start', edge: 'e', x: 0, y: 0 }); send({ phase: 'move', x: 100, y: 100 }); assert.equal(bounds.width, 1280);
  send({ phase: 'start', edge: 'e', x: 0, y: 0 }); send({ phase: 'move', x: NaN, y: 0 }); assert.equal(bounds.width, 1280);
  send({ phase: 'move', x: 100, y: 0 }); assert.equal(bounds.width, 1380);
  win.emit('blur'); send({ phase: 'move', x: 200, y: 0 }); assert.equal(bounds.width, 1380);
  maximized = true; win.emit('maximize'); send({ phase: 'start', edge: 'e', x: 0, y: 0 }); send({ phase: 'move', x: 100, y: 0 }); assert.equal(bounds.width, 1380);
  win.emit('closed'); assert.equal(ipc.listenerCount('window:resize-frame'), 0); assert.equal(handlers.size, 0);
});
