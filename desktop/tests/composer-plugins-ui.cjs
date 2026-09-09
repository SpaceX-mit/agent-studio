const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const dist = path.join(root, 'desktop/dist');
  const artifacts = path.join(root, '.project-cache/ui-checks');
  fs.mkdirSync(artifacts, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(dist, '.' + (req.url === '/' ? '/index.html' : req.url));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    fs.createReadStream(file).pipe(res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const names = ['Documents', 'PDF', 'Spreadsheets', 'Presentations', 'Template Creator', 'Browser', 'Research', 'Reports', 'Chrome'];
      window.__plugins = names.map((name, index) => ({ id: `${name.toLowerCase().replaceAll(' ', '-')}@local`, name: name.toLowerCase().replaceAll(' ', '-'), installed: name !== 'Chrome', enabled: name !== 'Chrome', source: { type: 'local', path: 'D:/test/plugins' }, availability: 'AVAILABLE', interface: { displayName: name, iconSmall: `D:/test/${index}.svg` } }));
      window.__requests = []; window.__failPlugins = false;
      localStorage.setItem('codex-desktop-state-v1', JSON.stringify({ mode: 'work', theme: 'light', model: 'test-model', projects: [], threads: [], automations: [] }));
      window.desktop = {
        getProjectRoot: async () => 'D:/Workspace2026/my-agent-plantform', providerStatus: async () => ({ keyConfigured: true }), listModels: async () => ({ ok: true, models: ['test-model'] }),
        readExtensionFile: async file => { const index = Number(file.match(/(\d+)\.svg/)[1]); return { ok: true, result: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="22"><rect width="18" height="22" rx="4" fill="${['#388bef', '#ef6a74', '#60aa73', '#e7b83f'][index % 4]}"/><path d="M5 6h8M5 10h8M5 14h6" stroke="white"/></svg>`) }; },
      };
      window.codex = {
        connect: async () => ({ ok: true }), notify: async () => {},
        request: async (method, params) => {
          window.__requests.push({ method, params });
          if (method === 'plugin/list') return window.__failPlugins ? { ok: false, error: { message: 'CATALOG_UNAVAILABLE' } } : { ok: true, result: { marketplaces: [{ name: 'local', path: 'D:/test/marketplace', plugins: window.__plugins }], marketplaceLoadErrors: [] } };
          if (method === 'plugin/read') { const summary = window.__plugins.find(plugin => plugin.name === params.pluginName); return { ok: true, result: { plugin: { summary, skills: [], mcpServers: [], apps: [], hooks: [] } } }; }
          if (method === 'plugin/install') { const plugin = window.__plugins.find(plugin => plugin.name === params.pluginName); plugin.installed = true; plugin.enabled = true; return { ok: true, result: { appsNeedingAuth: [] } }; }
          if (method === 'thread/start') return { ok: true, result: { thread: { id: 'composer-test' } } };
          if (method === 'turn/start') { queueMicrotask(() => window.__notify({ method: 'turn/completed', params: { threadId: params.threadId, turn: { id: 'test-turn', status: 'completed' } } })); return { ok: true, result: { turn: { id: 'test-turn' } } }; }
          return { ok: true, result: { data: [] } };
        },
        onNotification: listener => { window.__notify = listener; return () => {}; }, onServerRequest: () => () => {}, onError: () => () => {}, onStderr: () => () => {}, onClosed: () => () => {},
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const trigger = page.locator('.work-plugins');
    const menu = page.getByRole('dialog', { name: '选择插件' });
    const search = page.getByRole('textbox', { name: '搜索对话插件' });
    await trigger.click();
    await menu.getByRole('button', { name: 'Documents', exact: true }).waitFor();
    assert.equal(await page.locator('.composer-plugin-preview img').count(), 3);
    assert.ok(await menu.locator('.composer-plugin-list').evaluate(element => element.scrollHeight > element.clientHeight));
    await menu.getByRole('button', { name: '连接插件', exact: true }).hover();
    const connections = page.getByRole('menu', { name: '连接插件', exact: true });
    await connections.getByRole('menuitem', { name: 'Chrome', exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'composer-plugins-desktop.png') });
    await search.fill('pdf');
    assert.equal(await menu.locator('.composer-plugin-list button').count(), 1);
    await menu.getByRole('button', { name: 'PDF', exact: true }).click();
    await menu.waitFor({ state: 'detached' });
    const message = page.getByRole('textbox', { name: '消息', exact: true });
    assert.equal(await message.inputValue(), '');
    await page.getByRole('button', { name: '移除 PDF', exact: true }).waitFor();
    assert.equal(await message.evaluate(element => element === document.activeElement), true);
    await trigger.click(); await search.fill('does-not-exist');
    await menu.getByText('没有匹配的插件').waitFor();
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    await trigger.click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '移除 Documents', exact: true }).waitFor();
    await trigger.click(); await menu.getByRole('button', { name: '连接插件', exact: true }).click();
    await connections.getByRole('menuitem', { name: 'Chrome', exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'Chrome', exact: true });
    await detail.getByRole('button', { name: '安装', exact: true }).click();
    await detail.getByText('插件已安装。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__requests.filter(item => item.method === 'plugin/install').length), 1);
    await detail.getByRole('button', { name: '关闭详情' }).click();
    await trigger.click(); await menu.getByRole('button', { name: 'Chrome', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__failPlugins = true; }); await trigger.click();
    await menu.getByRole('alert').getByText('CATALOG_UNAVAILABLE').waitFor();
    await page.evaluate(() => { window.__failPlugins = false; }); await menu.getByRole('button', { name: '重试' }).click();
    await menu.getByRole('button', { name: 'Documents', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    for (const viewport of [{ width: 960, height: 640 }, { width: 600, height: 720 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => document.querySelector('.desktop-app').classList.add('dark'));
      await trigger.click();
      await menu.getByRole('button', { name: 'Documents', exact: true }).waitFor();
      await menu.getByRole('button', { name: '连接插件', exact: true }).click();
      await connections.waitFor();
      assert.equal(await page.locator('.composer-plugin-menu').evaluateAll(elements => elements.filter(element => getComputedStyle(element).visibility !== 'hidden').every(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; })), true);
      await page.screenshot({ path: path.join(artifacts, `composer-plugins-dark-${viewport.width}.png`) });
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    }
    await trigger.click(); await menu.getByRole('button', { name: '连接插件', exact: true }).click();
    await connections.getByRole('menuitem', { name: '浏览所有插件', exact: true }).click();
    await page.locator('.extensions').waitFor();
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await page.getByRole('button', { name: '移除 PDF', exact: true }).waitFor();
    await page.getByRole('button', { name: '移除 Documents', exact: true }).click();
    await message.fill('整理这份报告');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction(() => window.__requests.some(item => item.method === 'turn/start'));
    assert.deepEqual(await page.evaluate(() => window.__requests.find(item => item.method === 'turn/start').params.input), [{ type: 'text', text: '整理这份报告' }, { type: 'mention', name: 'pdf', path: 'plugin://pdf@local' }]);
    assert.equal(await page.locator('.composer-plugin-chips').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: real-catalog menu rendering, icons, search, nested connection/install, keyboard, error/retry, viewport placement, dark theme, browse/draft preservation and Codex plugin mentions.');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
