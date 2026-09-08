const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readExtensionFile } = require('../electron/extension-files.cjs');
const { flattenPlugins, matchesExtension, pluginSelector, canInstall, isPublicPlugin } = require('../src/extensions.ts');

test('catalog preserves marketplace selectors and real availability', () => {
  const list = flattenPlugins({ marketplaces: [{ name: 'openai-api-curated', path: 'D:\\catalog.json', plugins: [{ id: 'test@openai-api-curated', name: 'test', installed: false, enabled: false, interface: { displayName: 'Test Plugin', shortDescription: 'Document tools' } }] }] });
  assert.equal(list.length, 1);
  assert.ok(isPublicPlugin(list[0]));
  assert.ok(matchesExtension(list[0], ' DOCUMENT '));
  assert.ok(!matchesExtension(list[0], 'missing'));
  assert.deepEqual(pluginSelector(list[0]), { marketplacePath: 'D:\\catalog.json', pluginName: 'test' });
  assert.ok(!canInstall({ ...list[0], availability: 'DISABLED_BY_ADMIN' }));
  assert.ok(!canInstall({ ...list[0], installPolicy: 'NOT_AVAILABLE' }));
});

test('file bridge rejects outside paths, junction escapes and non-assets', async () => {
  const cache = path.resolve(__dirname, '../../.project-cache');
  const scratch = await fs.mkdtemp(path.join(cache, 'extension-files-'));
  const project = path.join(scratch, 'project');
  const outside = path.join(scratch, 'outside');
  await fs.mkdir(project); await fs.mkdir(outside);
  await fs.writeFile(path.join(project, 'SKILL.md'), '# Test skill');
  await fs.writeFile(path.join(project, 'config.toml'), 'secret');
  await fs.writeFile(path.join(outside, 'SKILL.md'), 'outside');
  await fs.symlink(outside, path.join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await readExtensionFile(project, path.join(project, 'SKILL.md'), 'skill'), '# Test skill');
  await assert.rejects(readExtensionFile(project, path.join(outside, 'SKILL.md'), 'skill'), /inside this project/);
  await assert.rejects(readExtensionFile(project, path.join(project, 'link/SKILL.md'), 'skill'), /inside this project/);
  await assert.rejects(readExtensionFile(project, path.join(project, 'config.toml'), 'image'), /Unsupported/);
  await assert.rejects(readExtensionFile(project, 'SKILL.md', 'skill'), /absolute/);
});
