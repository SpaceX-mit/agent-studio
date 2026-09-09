const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const cache = path.join(root, '.project-cache/tmp');
  fs.mkdirSync(cache, { recursive: true });
  const isolated = fs.mkdtempSync(path.join(cache, 'scheduled-electron-'));
  const desktop = path.join(isolated, 'desktop');
  fs.cpSync(path.join(root, 'desktop/electron'), path.join(desktop, 'electron'), { recursive: true });
  fs.cpSync(path.join(root, 'desktop/dist'), path.join(desktop, 'dist'), { recursive: true });
  fs.symlinkSync(path.join(root, 'desktop/node_modules'), path.join(desktop, 'node_modules'), 'junction');
  const executablePath = require('electron');
  const args = [path.join(desktop, 'electron/main.cjs')];
  const env = { ...process.env, TEMP: cache, TMP: cache };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'MINIMAX_API_KEY', 'CODEX_APP_SERVER_COMMAND', 'VITE_DEV_SERVER_URL']) delete env[key];
  let app, duplicate;
  const errors = [];
  try {
    app = await electron.launch({ executablePath, args, env, timeout: 20000 });
    let page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    if (await page.evaluate(() => window.desktop.customFrame)) {
      await page.locator('.window-surface').waitFor();
      assert.equal(await page.locator('.window-resize').count(), 8);
      const initial = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      await page.evaluate(() => {
        window.desktop.resizeFrame({ phase: 'start', edge: 'se', x: 100, y: 100 });
        window.desktop.resizeFrame({ phase: 'move', x: 160, y: 140 });
        window.desktop.resizeFrame({ phase: 'end' });
      });
      await page.waitForFunction(width => innerWidth === width, initial.width + 60);
      const beforeMaximize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      await page.getByRole('button', { name: '最大化', exact: true }).click();
      await page.locator('.window-surface.maximized').waitFor();
      assert.equal(await page.locator('.window-resize').count(), 0);
      const restore = page.getByRole('button', { name: '向下还原', exact: true });
      await restore.waitFor();
      assert.equal(await restore.getAttribute('title'), '向下还原');
      await restore.click();
      await page.locator('.window-surface:not(.maximized)').waitFor();
      await page.getByRole('button', { name: '最大化', exact: true }).waitFor();
      // Windows rounds physical pixels at fractional display scales (e.g. 125%).
      await page.waitForFunction(size => Math.abs(innerWidth - size.width) <= 2 && Math.abs(innerHeight - size.height) <= 2, beforeMaximize);
      const restoredBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restoredBounds[key] - beforeMaximize[key]) <= 2, `Restored window preserves ${key}`);
      await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), initial);
      await page.waitForFunction(width => innerWidth === width, initial.width);
      const corner = await page.locator('.window-resize-se').boundingBox();
      await page.mouse.move(corner.x + 5, corner.y + 5); await page.mouse.down();
      await page.mouse.move(corner.x + 29, corner.y + 21, { steps: 4 }); await page.mouse.up();
      await page.waitForFunction(width => innerWidth > width, initial.width);
      await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), initial);
      await page.waitForFunction(width => innerWidth === width, initial.width);
      const frameScreenshot = path.join(root, '.project-cache/ui-checks/window-soft-frame.png');
      await page.screenshot({ path: frameScreenshot, omitBackground: true });
      const pixels = await app.evaluate(({ nativeImage }, file) => {
        const image = nativeImage.createFromPath(file), size = image.getSize(), bitmap = image.toBitmap();
        const pixel = (x, y) => Array.from(bitmap.subarray((y * size.width + x) * 4, (y * size.width + x) * 4 + 4));
        return { corner: pixel(0, 0), outside: pixel(1, Math.floor(size.height / 2)), inside: pixel(30, Math.floor(size.height / 2)) };
      }, frameScreenshot);
      assert.equal(pixels.corner[3], 0, 'Outer corner is transparent, not black');
      assert.ok(pixels.outside[3] < 80, 'Outer edge fades into a translucent shadow');
      assert.equal(pixels.inside[3], 255, 'Application surface remains opaque');
      console.log('PASS: soft frame alpha pixels, real pointer resize, maximize/restore and retained controls.');
    }
    await page.getByRole('button', { name: '已安排', exact: true }).click();
    await page.getByText('暂无已安排的任务', { exact: true }).waitFor();
    const saved = await page.evaluate(async () => window.desktop.saveTask({ name: 'Electron scheduled reminder', prompt: 'ELECTRON_TIMER_OK', kind: 'reminder', model: '', permission: 'read-only', notify: false, schedule: { kind: 'once', at: new Date(Date.now() + 3500).toISOString() } }));
    assert.equal(saved.ok, true);
    await page.getByRole('button', { name: '查看任务 Electron scheduled reminder' }).click();
    await page.getByRole('dialog').locator('.task-run summary').filter({ hasText: '已完成' }).click({ timeout: 10000 });
    await page.getByRole('dialog').locator('pre').getByText('ELECTRON_TIMER_OK', { exact: true }).waitFor();
    const persisted = await page.evaluate(id => window.desktop.taskDetail(id), saved.task.id);
    assert.equal(persisted.task.runs[0].trigger, 'scheduled');
    await page.screenshot({ path: path.join(root, '.project-cache/ui-checks/scheduled-electron.png') });
    duplicate = spawn(executablePath, args, { env, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Second instance did not exit')), 10000);
      duplicate.once('error', error => { clearTimeout(timer); reject(error); });
      duplicate.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Duplicate exit ${code}`)); });
    });
    assert.equal(app.windows().length, 1);
    await app.close(); app = null;
    app = await electron.launch({ executablePath, args, env, timeout: 20000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: '已安排', exact: true }).click();
    await page.getByRole('button', { name: '查看任务 Electron scheduled reminder' }).click();
    await page.getByRole('dialog').locator('.task-run summary').click();
    await page.getByRole('dialog').locator('pre').getByText('ELECTRON_TIMER_OK', { exact: true }).waitFor();
    const reloaded = await page.evaluate(id => window.desktop.taskDetail(id), saved.task.id);
    assert.equal(reloaded.task.runs.length, 1);
    assert.equal(reloaded.task.status, 'completed');
    assert.deepEqual(errors, []);
    console.log('PASS: isolated Electron main/preload/UI, real timer, persisted output, single-instance lock, clean shutdown and restart.');
  } finally {
    if (duplicate?.exitCode === null) duplicate.kill();
    if (app) await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
