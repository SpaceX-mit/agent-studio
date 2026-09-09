const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseRss, decodeXml } = require('../electron/web-search-mcp.cjs');
const { ensureProjectConfig } = require('../electron/codex-server.cjs');

test('decodes XML entities and parses RSS items into structured results', () => {
  assert.equal(decodeXml('<![CDATA[A &amp; B]]>'), 'A & B');
  const results = parseRss(`<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[AI &amp; safety]]></title><link>https://example.com/a?x=1&amp;y=2</link><description>Summary &lt;here&gt;</description><pubDate>Wed, 09 Sep 2026 10:00:00 GMT</pubDate></item>
    <item><title>Missing URL</title></item>
  </channel></rss>`, 'Test News');
  assert.deepEqual(results, [{ title: 'AI & safety', url: 'https://example.com/a?x=1&y=2', snippet: 'Summary', publishedAt: 'Wed, 09 Sep 2026 10:00:00 GMT', source: 'Test News' }]);
});

test('generates project-only MCP config with absolute Node and script paths', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'felix-search-config-'));
  const root = path.resolve(__dirname, '../..');
  ensureProjectConfig(home, root);
  const first = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
  assert.match(first, /\[mcp_servers\.felix_web_search\]/);
  assert.match(first, /command = ".*node(?:\.exe)?"/i);
  assert.match(first, /enabled = true/);
  assert.match(first, /web-search-mcp\.cjs/);
  ensureProjectConfig(home, root);
  assert.equal(fs.readFileSync(path.join(home, 'config.toml'), 'utf8'), first);
});
