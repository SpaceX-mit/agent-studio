const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CodexRpc } = require('../electron/codex-rpc.cjs');
const { findCommand } = require('../electron/codex-server.cjs');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const scratch = fs.mkdtempSync(path.join(root, '.project-cache/extensions-rpc-'));
  const home = path.join(scratch, 'home');
  const market = path.join(scratch, 'market');
  const pluginRoot = path.join(market, 'sample');
  const marketplacePath = path.join(market, '.agents/plugins/marketplace.json');
  for (const folder of [home, path.dirname(marketplacePath), path.join(pluginRoot, '.codex-plugin'), path.join(pluginRoot, 'skills/sample')]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'sample', version: '1.0.0', description: 'Extension integration test', skills: './skills' }));
  fs.writeFileSync(path.join(pluginRoot, 'skills/sample/SKILL.md'), '---\nname: sample\ndescription: Isolated extension test fixture\n---\n# Sample\nRead the fixture only.\n');
  fs.writeFileSync(marketplacePath, JSON.stringify({ name: 'fixture', plugins: [{ name: 'sample', source: { source: 'local', path: './sample' }, policy: { installation: 'AVAILABLE', authentication: 'ON_USE' } }] }));
  fs.writeFileSync(path.join(home, 'config.toml'), `[marketplaces.fixture]\nsource_type = "local"\nsource = ${JSON.stringify(market)}\n`);
  let rpc;
  const start = async () => {
    rpc = new CodexRpc(spawn(findCommand(root).command, ['app-server', '--stdio'], { cwd: scratch, env: { ...process.env, CODEX_HOME: home, TEMP: scratch, TMP: scratch }, windowsHide: true }));
    await rpc.request('initialize', { clientInfo: { name: 'extensions_test', version: '1' }, capabilities: { experimentalApi: true } });
    rpc.notify('initialized', {});
  };
  const selector = { marketplacePath, pluginName: 'sample' };
  const getSkill = async () => (await rpc.request('skills/list', { cwds: [scratch], forceReload: true })).data.flatMap(entry => entry.skills).find(skill => skill.pluginId === 'sample@fixture');
  const timer = setTimeout(() => { rpc?.close(); console.error('Extensions RPC timed out'); process.exitCode = 1; }, 60000);
  try {
    await start();
    assert.equal((await rpc.request('plugin/read', selector)).plugin.summary.installed, false);
    await rpc.request('plugin/install', selector);
    assert.equal((await rpc.request('plugin/read', selector)).plugin.summary.installed, true);
    let skill = await getSkill();
    assert.ok(skill?.enabled, 'Installed plugin skill must be discovered');
    assert.ok(skill.path.startsWith(home), 'Skill installation stays in isolated Codex home');
    assert.equal((await rpc.request('skills/config/write', { path: skill.path, enabled: false })).effectiveEnabled, false);
    assert.equal((await getSkill()).enabled, false);
    await rpc.request('skills/config/write', { path: skill.path, enabled: true });
    await rpc.request('config/batchWrite', { edits: [{ keyPath: 'plugins."sample@fixture".enabled', value: false, mergeStrategy: 'replace' }], reloadUserConfig: true });
    assert.equal((await rpc.request('plugin/read', selector)).plugin.summary.enabled, false);
    rpc.close();
    await start();
    assert.equal((await rpc.request('plugin/read', selector)).plugin.summary.enabled, false, 'Disable survives app-server restart');
    await rpc.request('config/batchWrite', { edits: [{ keyPath: 'plugins."sample@fixture".enabled', value: true, mergeStrategy: 'replace' }], reloadUserConfig: true });
    assert.equal((await getSkill()).enabled, true);
    await rpc.request('plugin/uninstall', { pluginId: 'sample@fixture' });
    assert.equal((await rpc.request('plugin/read', selector)).plugin.summary.installed, false);
    assert.equal(await getSkill(), undefined);
    console.log('PASS: real project Codex installs, discovers, enables, disables, persists and uninstalls plugins/skills.');
    console.log('Isolated test home: ' + home);
  } finally { clearTimeout(timer); rpc?.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
