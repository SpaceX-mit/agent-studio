const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { TaskScheduler } = require('../electron/task-scheduler.cjs');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const dist = path.join(root, 'desktop/dist');
  const artifacts = path.join(root, '.project-cache/ui-checks');
  fs.mkdirSync(artifacts, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, '.project-cache/tmp/tasks-ui-'));
  let clock = Date.now(), failList = false, failDetail = false, browser;
  const runner = async (task, { signal }) => {
    if (task.prompt === 'FAIL') throw new Error('TEST_MODEL_FAILURE');
    if (task.prompt === 'WAIT') await new Promise((resolve, reject) => {
      if (signal.aborted) reject(new Error('Cancelled'));
      else signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
    });
    return { output: `真实持久化结果：${task.prompt}` };
  };
  let scheduler = new TaskScheduler({ directory, runner, now: () => clock });
  const sample = scheduler.save({ name: '每日工作区检查', prompt: '检查今天的待办事项', kind: 'agent', model: 'MiniMax-Test', permission: 'read-only', notify: true, schedule: { kind: 'daily', time: '05:00', timezone: 'Asia/Shanghai' } });
  const server = http.createServer((req, res) => {
    const filename = path.resolve(dist, '.' + (req.url === '/' ? '/index.html' : req.url));
    if (!filename.startsWith(dist + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(filename).pipe(res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, timezoneId: 'Asia/Shanghai' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('taskOperation', async (operation, args) => {
      try {
        if (operation === 'listTasks') { if (failList) throw new Error('TEST_LIST_FAILURE'); return { ok: true, tasks: scheduler.list() }; }
        if (operation === 'taskDetail') { if (failDetail) throw new Error('TEST_DETAIL_FAILURE'); return { ok: true, task: scheduler.detail(args[0]) }; }
        if (operation === 'saveTask') return { ok: true, task: scheduler.save(args[0]) };
        if (operation === 'setTaskStatus') scheduler.setStatus(...args);
        if (operation === 'deleteTask') scheduler.remove(args[0]);
        if (operation === 'runTask') void scheduler.run(args[0]);
        if (operation === 'cancelTask') scheduler.cancel(args[0]);
        return { ok: true };
      } catch (error) { return { ok: false, error: error.message }; }
    });
    await page.addInitScript(() => {
      window.desktop = { listModels: async () => ({ ok: true, models: ['MiniMax-Test'] }), providerStatus: async () => ({ keyConfigured: true }), getProjectRoot: async () => 'D:\\Workspace2026\\my-agent-plantform' };
      for (const method of ['listTasks', 'saveTask', 'setTaskStatus', 'runTask', 'cancelTask', 'deleteTask', 'taskDetail']) window.desktop[method] = (...args) => window.taskOperation(method, args);
      window.desktop.onTasksChanged = listener => { window.__taskChanged = listener; return () => { window.__taskChanged = null; }; };
      window.codex = { connect: async () => ({ ok: true }), notify: async () => {}, request: async () => ({ ok: true, result: { data: [] } }), onNotification: () => () => {}, onServerRequest: () => () => {}, onError: () => () => {}, onStderr: () => () => {}, onClosed: () => () => {} };
    });
    const changed = () => page.evaluate(() => window.__taskChanged?.());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: '已安排', exact: true }).click();
    await page.getByRole('button', { name: '查看任务 每日工作区检查' }).waitFor();
    assert.equal(await page.locator('.task-suggestion').count(), 3);
    await page.locator('.task-suggestion.review').hover();
    await page.screenshot({ path: path.join(artifacts, 'scheduled-desktop.png') });
    await page.locator('.task-suggestion.review').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('任务名称', { exact: true }).fill('每周项目回顾');
    assert.equal(await dialog.getByLabel('星期', { exact: true }).inputValue(), '5');
    await dialog.getByRole('button', { name: '保存任务' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(scheduler.list().length, 2);
    await page.getByRole('button', { name: '暂停 每周项目回顾' }).click();
    await page.getByRole('tab', { name: '已暂停', exact: true }).click();
    await page.getByRole('button', { name: '恢复 每周项目回顾' }).waitFor();
    assert.equal(await page.locator('.task-row').count(), 1);
    await page.getByRole('button', { name: '恢复 每周项目回顾' }).click();
    await page.getByText('没有匹配的任务', { exact: true }).waitFor();
    await page.getByRole('tab', { name: '全部', exact: true }).click();
    const search = page.getByRole('textbox', { name: '搜索已安排任务' });
    await search.fill('每日'); assert.equal(await page.locator('.task-row').count(), 1); await search.fill('');
    await page.getByRole('button', { name: '查看任务 每日工作区检查' }).click();
    await dialog.getByRole('button', { name: '立即运行', exact: true }).click();
    await changed();
    await dialog.locator('.task-run summary').first().click();
    await dialog.getByText(/真实持久化结果/).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'scheduled-results.png') });
    await dialog.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
    await editor.getByRole('textbox', { name: '任务内容', exact: true }).fill('FAIL');
    await editor.getByRole('button', { name: '保存任务' }).click(); await editor.waitFor({ state: 'detached' });
    await dialog.getByRole('button', { name: '立即运行', exact: true }).click(); await changed();
    await dialog.locator('.task-run summary').filter({ hasText: '失败' }).click();
    await dialog.getByText('TEST_MODEL_FAILURE', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '编辑', exact: true }).click();
    await editor.getByRole('textbox', { name: '任务内容', exact: true }).fill('WAIT');
    await editor.getByRole('button', { name: '保存任务' }).click(); await editor.waitFor({ state: 'detached' });
    await dialog.getByRole('button', { name: '立即运行', exact: true }).click();
    await dialog.getByRole('button', { name: '停止运行', exact: true }).click(); await changed();
    await dialog.getByText('已中断', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '关闭对话框' }).click();
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('menuitem', { name: '提醒', exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: '创建任务', exact: true });
    await createDialog.getByLabel('任务名称', { exact: true }).fill('定时提醒验证');
    await createDialog.getByLabel('任务内容', { exact: true }).fill('检查真实提醒结果');
    await createDialog.getByLabel('频率').selectOption('once');
    await createDialog.getByLabel('运行时间（本地时区）').fill('2099-09-08T09:45');
    await createDialog.getByRole('button', { name: '保存任务' }).click(); await createDialog.waitFor({ state: 'detached' });
    const reminder = scheduler.list().find(task => task.name === '定时提醒验证');
    assert.equal(reminder.schedule.at, '2099-09-08T01:45:00.000Z', 'Local date input is converted once, without UTC drift');
    scheduler.setStatus(sample.id, 'paused');
    for (const task of scheduler.list()) if (task.id !== reminder.id) scheduler.setStatus(task.id, 'paused');
    clock = Date.parse(reminder.schedule.at) + 1000; await scheduler.tick(); await changed();
    assert.equal(scheduler.detail(reminder.id).runs[0].trigger, 'scheduled');
    await page.getByRole('tab', { name: '已完成', exact: true }).click();
    await page.getByRole('button', { name: '查看任务 定时提醒验证' }).click();
    await dialog.locator('.task-run summary').click(); await dialog.locator('pre').getByText('检查真实提醒结果', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('dialog', { name: '删除任务', exact: true }).getByRole('button', { name: '确认删除' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.ok(!scheduler.list().some(task => task.id === reminder.id));
    await scheduler.stop(); scheduler = new TaskScheduler({ directory, runner, now: () => clock });
    await page.reload(); await page.getByRole('button', { name: '已安排', exact: true }).click();
    await page.getByRole('button', { name: '查看任务 每日工作区检查' }).waitFor();
    assert.equal(scheduler.detail(sample.id).runs.length, 3, 'Results survive service restart');
    failList = true; await changed(); await page.getByRole('alert').getByText('TEST_LIST_FAILURE').waitFor();
    failList = false; await page.getByRole('button', { name: '重试', exact: true }).click(); await page.getByRole('alert').waitFor({ state: 'detached' });
    failDetail = true; await page.getByRole('button', { name: '查看任务 每日工作区检查' }).click();
    await page.getByRole('dialog').getByRole('alert').getByText('TEST_DETAIL_FAILURE').waitFor();
    failDetail = false; await page.getByRole('dialog').getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('dialog').getByText('运行记录', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__taskChanged?.({ error: 'TEST_SERVICE_FAILURE' }));
    await page.getByRole('alert').getByText('TEST_SERVICE_FAILURE').waitFor();
    await changed();
    await page.getByRole('alert').getByText('TEST_SERVICE_FAILURE').waitFor();
    await page.getByRole('button', { name: '关闭错误' }).click();
    for (const size of [{ width: 960, height: 640 }, { width: 600, height: 720 }, { width: 390, height: 760 }]) {
      await page.setViewportSize(size);
      if (size.width === 390) await page.getByRole('button', { name: '收起侧栏' }).click();
      await page.screenshot({ path: path.join(artifacts, `scheduled-${size.width}.png`) });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.scheduled-page').scrollWidth > document.querySelector('.scheduled-page').clientWidth), false, `Overflow at ${size.width}px: ${JSON.stringify(await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, page: document.querySelector('.scheduled-page').clientWidth, scroll: document.querySelector('.scheduled-page').scrollWidth })))}`);
    }
    await page.evaluate(() => { const state = JSON.parse(localStorage.getItem('codex-desktop-state-v1')); state.theme = 'dark'; localStorage.setItem('codex-desktop-state-v1', JSON.stringify(state)); });
    await page.setViewportSize({ width: 1280, height: 820 }); await page.reload(); await page.getByRole('button', { name: '已安排', exact: true }).click();
    await page.getByRole('button', { name: '创建', exact: true }).click(); await page.getByRole('menuitem', { name: '提醒', exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, 'scheduled-dark-editor.png') });
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: real scheduler-backed UI CRUD, suggestions, filtering, run/cancel/failure/output, timed reminder, timezone, restart, retry, responsive/dark screenshots.');
  } finally { await scheduler.stop(); if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
