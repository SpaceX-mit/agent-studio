const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const assert = require('node:assert/strict');

async function main() {
  const dist = path.resolve(__dirname, '../dist');
  const artifacts = path.resolve(__dirname, '../../.project-cache/ui-checks');
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const filename = path.resolve(dist, '.' + (req.url === '/' ? '/index.html' : req.url));
    if (!filename.startsWith(dist + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(filename).pipe(res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const history = [
        { id: 'before', type: 'agentMessage', text: '先检查工作区的结构，再读取关键文件。' },
        { id: 'cmd', type: 'commandExecution', command: 'Get-Content desktop/electron/minimax-adapter.cjs', status: 'completed', aggregatedOutput: 'const http = require("node:http");\n检查完成', exitCode: 0, durationMs: 850 },
        { id: 'patch', type: 'fileChange', status: 'completed', changes: [{ path: 'desktop/src/main.tsx', kind: { type: 'update' }, diff: '-old\n+new\n+done' }] },
        { id: 'after', type: 'agentMessage', text: '关键文件已检查，执行记录已保留。' }
      ];
      window.__history = history;
      if (!localStorage.getItem('codex-desktop-state-v1')) localStorage.setItem('codex-desktop-state-v1', JSON.stringify({
        theme: 'light', model: 'test-model', projects: [], automations: [], activeThreadId: 'local', threads: [{ id: 'local', remoteId: 'remote', title: '执行记录测试', status: 'idle', messages: [{ id: 'live-before', role: 'assistant', content: history[0].text, createdAt: new Date().toISOString() }] }]
      }));
      window.desktop = { providerStatus: async () => ({ keyConfigured: true }), listModels: async () => ({ ok: true, models: ['test-model'] }) };
      window.__requests = [];
      window.codex = { connect: async () => ({ ok: true }), notify: async () => {},
        request: async (method, params) => {
          window.__requests.push({ method, params });
          return { ok: true, result: method === 'thread/items/list' ? { data: history } : method === 'thread/turns/list' ? { data: [{ id: 'turn', items: history }] } : method === 'thread/fork' ? { thread: { id: 'branch' } } : { data: [] } };
        },
        onNotification: fn => { window.__notify = fn; return () => {}; },
        onServerRequest: () => () => {}, onError: () => () => {}, onStderr: () => () => {}, onClosed: () => () => {}
      };
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => typeof window.__notify === 'function');
    await page.evaluate(() => {
      const notify = (method, params) => window.__notify({ method, params: { threadId: 'remote', turnId: 'turn', ...params } });
      notify('item/started', { item: { ...window.__history[1], status: 'inProgress', aggregatedOutput: null } });
      notify('item/commandExecution/outputDelta', { itemId: 'cmd', delta: 'temporary' });
      notify('item/completed', { item: window.__history[1] });
      notify('item/completed', { item: window.__history[2] });
      notify('item/agentMessage/delta', { itemId: 'after', delta: window.__history[3].text });
      notify('turn/completed', { turn: { id: 'turn', status: 'completed' } });
    });
    await page.locator('.tool-row').first().waitFor();
    assert.equal(await page.locator('.tool-row').count(), 2);
    await page.locator('.tool-row > summary').first().click();
    assert.match(await page.locator('.tool-output').innerText(), /检查完成/);
    assert.doesNotMatch(await page.locator('.tool-output').innerText(), /temporary/);
    await page.locator('.tool-row > summary').first().click();
    await page.reload();
    await page.locator('.tool-row').first().waitFor();
    assert.equal(await page.locator('.tool-row').count(), 2);
    await page.getByRole('button', { name: '执行记录测试', exact: true }).click();
    assert.equal(await page.locator('.tool-row').count(), 2);
    await page.screenshot({ path: path.join(artifacts, 'tool-activity-desktop.png') });
    await page.locator('.tool-row > summary').nth(1).click();
    await page.locator('.tool-file > summary').click();
    assert.match(await page.locator('.tool-file pre').innerText(), /\+new/);
    await page.setViewportSize({ width: 960, height: 640 });
    const layout = await page.evaluate(() => ({
      threadBottom: document.querySelector('.thread-view').getBoundingClientRect().bottom,
      composerTop: document.querySelector('.composer').getBoundingClientRect().top,
      pageOverflow: document.documentElement.scrollWidth > innerWidth
    }));
    assert.ok(layout.threadBottom <= layout.composerTop + 1, 'Composer overlaps messages');
    assert.equal(layout.pageOverflow, false);
    await page.screenshot({ path: path.join(artifacts, 'tool-activity-small.png') });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: '复制回复', exact: true }).click();
    await page.getByRole('button', { name: '已复制', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '关键文件已检查，执行记录已保留。');
    await page.getByRole('button', { name: '分支到新聊天', exact: true }).hover();
    await page.screenshot({ path: path.join(artifacts, 'reply-actions.png') });
    await page.getByRole('button', { name: '分支到新聊天', exact: true }).click();
    await page.getByRole('button', { name: '执行记录测试 · 分支', exact: true }).waitFor();
    const branchState = await page.evaluate(() => ({ state: JSON.parse(localStorage.getItem('codex-desktop-state-v1')), request: window.__requests.find(entry => entry.method === 'thread/fork') }));
    assert.equal(branchState.request.params.lastTurnId, 'turn');
    assert.equal(branchState.state.activeThreadId, 'remote-branch');
    assert.equal(branchState.state.threads.length, 2);
    assert.equal(branchState.state.threads[0].messages.length, branchState.state.threads[1].messages.length);
    assert.deepEqual(errors, []);
    console.log('PASS: execution records, layout, actual clipboard copy and message-level fork navigation.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
