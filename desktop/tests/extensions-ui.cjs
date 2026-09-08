const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { CodexRpc } = require('../electron/codex-rpc.cjs');
const { findCommand } = require('../electron/codex-server.cjs');
const { readExtensionFile } = require('../electron/extension-files.cjs');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const dist = path.join(root, 'desktop/dist');
  const artifacts = path.join(root, '.project-cache/ui-checks');
  fs.mkdirSync(artifacts, { recursive: true });
  // Read the actual project catalog. All UI mutations below are isolated in memory.
  const rpc = new CodexRpc(spawn(findCommand(root).command, ['app-server', '--stdio'], { cwd: root, env: { ...process.env, CODEX_HOME: path.join(root, '.project-cache/codex-home'), TEMP: artifacts, TMP: artifacts }, windowsHide: true }));
  let browser;
  let server;
  try {
    await rpc.request('initialize', { clientInfo: { name: 'extensions_ui_test', version: '1' }, capabilities: { experimentalApi: true } });
    const catalog = await rpc.request('plugin/list', { cwds: [root], marketplaceKinds: ['local'] });
    const skills = await rpc.request('skills/list', { cwds: [root], forceReload: true });
    assert.ok(catalog.marketplaces.some(market => market.plugins.length));
    const catalogPlugins = catalog.marketplaces.flatMap(market => market.plugins);
    const sample = catalogPlugins.find(plugin => plugin.name === 'game-studio');
    assert.ok(sample);
    server = http.createServer((req, res) => {
      const filename = path.resolve(dist, '.' + (req.url === '/' ? '/index.html' : req.url));
      if (!filename.startsWith(dist + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
      res.setHeader('content-type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
      fs.createReadStream(filename).pipe(res);
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('readExtension', async (filename, kind) => {
      try { return { ok: true, result: await readExtensionFile(root, filename, kind) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
    await page.exposeFunction('readPlugin', async params => {
      try { return { ok: true, result: await rpc.request('plugin/read', params) }; }
      catch (error) { return { ok: false, error: { message: error.message } }; }
    });
    await page.addInitScript(({ catalog, skills, root }) => {
      const records = [];
      window.__requests = records;
      window.__fail = false;
      const plugins = catalog.marketplaces.flatMap(market => market.plugins);
      const allSkills = skills.data.flatMap(entry => entry.skills);
      window.desktop = { getProjectRoot: async () => root, providerStatus: async () => ({ keyConfigured: true }), listModels: async () => ({ ok: true, models: ['test-model'] }), readExtensionFile: (...args) => window.readExtension(...args) };
      const listeners = new Set();
      window.codex = { connect: async () => ({ ok: true }), notify: async () => {}, request: async (method, params) => {
        records.push({ method, params });
        if (method === 'plugin/read') return window.readPlugin(params);
        if (window.__fail && ['plugin/list', 'skills/config/write'].includes(method)) return { ok: false, error: { message: 'TEST_CONNECTION_FAILURE' } };
        let result = {};
        if (method === 'plugin/list') result = catalog;
        else if (method === 'skills/list') result = skills;
        else if (method === 'plugin/install') { const plugin = plugins.find(plugin => plugin.name === params.pluginName); plugin.installed = true; plugin.enabled = true; result = { appsNeedingAuth: [] }; }
        else if (method === 'plugin/uninstall') { const plugin = plugins.find(plugin => plugin.id === params.pluginId); plugin.installed = false; plugin.enabled = false; }
        else if (method === 'config/batchWrite') { const plugin = plugins.find(plugin => params.edits[0].keyPath.includes(plugin.id)); plugin.enabled = params.edits[0].value; }
        else if (method === 'skills/config/write') { const skill = allSkills.find(skill => skill.path === params.path); skill.enabled = params.enabled; result = { effectiveEnabled: skill.enabled }; }
        else result = { data: [] };
        return { ok: true, result: JSON.parse(JSON.stringify(result)) };
      }, onNotification: fn => { listeners.add(fn); return () => listeners.delete(fn); }, onServerRequest: () => () => {}, onError: () => () => {}, onStderr: () => () => {}, onClosed: () => () => {} };
    }, { catalog, skills, root });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('aside > button').filter({ hasText: '插件' }).click();
    await page.getByRole('heading', { name: 'Developer Tools', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.ext-icon img').length > 5 && [...document.querySelectorAll('.ext-icon img')].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: path.join(artifacts, 'extensions-plugins.png') });
    await page.getByRole('textbox', { name: '搜索插件' }).fill('Game Studio');
    assert.equal(await page.locator('.ext-row').count(), 1);
    await page.getByRole('button', { name: '管理 Game Studio', exact: true }).click();
    await page.getByRole('button', { name: '安装', exact: true }).click();
    await page.getByRole('switch', { name: '启用插件' }).waitFor();
    await page.getByRole('switch', { name: '启用插件' }).uncheck();
    await page.waitForFunction(() => window.__requests.some(entry => entry.method === 'config/batchWrite'));
    await page.getByRole('button', { name: '卸载', exact: true }).click();
    await page.getByRole('button', { name: '确认卸载', exact: true }).click();
    await page.locator('.ext-dialog').waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: '技能', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.ext-icon img').length > 5 && [...document.querySelectorAll('.ext-icon img')].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: path.join(artifacts, 'extensions-skills.png') });
    await page.locator('.ext-skill-row').filter({ hasText: 'Image Gen' }).first().click();
    await page.getByRole('button', { name: '查看 SKILL.md' }).click();
    await page.locator('.ext-source').waitFor();
    assert.match(await page.locator('.ext-source').innerText(), /image/i);
    await page.getByRole('switch', { name: '启用技能' }).uncheck();
    await page.waitForFunction(() => window.__requests.some(entry => entry.method === 'skills/config/write'));
    await page.evaluate(() => { window.__fail = true; });
    await page.getByRole('switch', { name: '启用技能' }).click();
    await page.getByRole('alert').filter({ hasText: 'TEST_CONNECTION_FAILURE' }).waitFor();
    assert.equal(await page.getByRole('switch', { name: '启用技能' }).isChecked(), false, 'Failed write must not change state');
    await page.getByRole('button', { name: '关闭详情' }).click();
    await page.getByRole('button', { name: '刷新扩展' }).click();
    await page.getByRole('alert').filter({ hasText: '部分扩展加载失败' }).waitFor();
    await page.evaluate(() => { window.__fail = false; });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('.ext-error').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '推荐', exact: true }).click();
    await page.locator('.ext-state[aria-label="未安装"]').first().waitFor({ timeout: 30000 });
    assert.ok(await page.locator('.ext-state[aria-label="未安装"]').count() > 0, 'Recommendations must come from real plugin skills');
    await page.locator('.ext-skill-row').filter({ has: page.locator('.ext-state[aria-label="未安装"]') }).first().click();
    await page.getByRole('button', { name: '安装所属插件', exact: true }).waitFor();
    await page.getByText(/此技能随/).waitFor();
    await page.getByRole('button', { name: '关闭详情' }).click();
    await page.getByRole('button', { name: '系统', exact: true }).click();
    for (const viewport of [{ width: 960, height: 640 }, { width: 600, height: 720 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const scroll = document.querySelector('.ext-scroll');
        return { overflow: document.documentElement.scrollWidth > innerWidth, scrollable: scroll.scrollHeight > scroll.clientHeight, rowOverflow: [...document.querySelectorAll('.ext-row')].some(row => row.scrollWidth > row.clientWidth) };
      });
      assert.equal(layout.overflow, false);
      assert.equal(layout.rowOverflow, false);
      assert.ok(layout.scrollable);
      await page.screenshot({ path: path.join(artifacts, `extensions-${viewport.width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: actual catalog and icons, tabs, search, details, install/uninstall, switches, failure/retry, recommendations, scrolling and narrow layouts.');
  } finally { if (browser) await browser.close(); rpc.close(); if (server) await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
