const EDGES = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

function resizeBounds(bounds, edge, dx, dy, minimum) {
  const next = { ...bounds };
  if (edge.includes('e')) next.width = Math.max(minimum[0], bounds.width + dx);
  if (edge.includes('s')) next.height = Math.max(minimum[1], bounds.height + dy);
  if (edge.includes('w')) { next.width = Math.max(minimum[0], bounds.width - dx); next.x += bounds.width - next.width; }
  if (edge.includes('n')) { next.height = Math.max(minimum[1], bounds.height - dy); next.y += bounds.height - next.height; }
  return next;
}

function wireWindowFrame(win, ipcMain, enabled) {
  let drag;
  const point = value => Number.isFinite(value?.x) && Number.isFinite(value?.y);
  const state = () => ({ maximized: win.isMaximized() || win.isFullScreen() });
  const publish = () => { drag = undefined; if (!win.webContents.isDestroyed()) win.webContents.send('window:state', state()); };
  const resize = (event, input) => {
    if (!enabled || event.sender !== win.webContents || !input) return;
    if (input.phase === 'end') { drag = undefined; return; }
    if (state().maximized || !point(input)) return;
    if (input.phase === 'start' && EDGES.has(input.edge)) drag = { edge: input.edge, bounds: win.getBounds(), x: input.x, y: input.y };
    if (input.phase === 'move' && drag) {
      win.setBounds(resizeBounds(drag.bounds, drag.edge, Math.round(input.x - drag.x), Math.round(input.y - drag.y), win.getMinimumSize()));
    }
  };
  ipcMain.on('window:resize-frame', resize);
  const getState = event => event.sender === win.webContents ? state() : {};
  ipcMain.handle('window:state', getState);
  for (const name of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(name, publish);
  win.on('blur', () => { drag = undefined; });
  win.on('closed', () => { ipcMain.removeListener('window:resize-frame', resize); ipcMain.removeHandler('window:state'); });
}

module.exports = { resizeBounds, wireWindowFrame };
