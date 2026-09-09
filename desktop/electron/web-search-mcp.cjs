const readline = require('node:readline');

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_LIMIT = 8;
const MAX_QUERY_LENGTH = 500;

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(item, name) {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return decodeXml(match?.[1]);
}

function parseRss(xml, source) {
  const results = [];
  for (const item of xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || []) {
    const title = tag(item, 'title');
    const url = tag(item, 'link') || tag(item, 'guid');
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    results.push({ title, url, snippet: tag(item, 'description'), publishedAt: tag(item, 'pubDate') || tag(item, 'published'), source });
  }
  return results;
}

async function fetchFeed(url, source, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': 'Felix/1.0 web-search' }, signal: controller.signal });
    if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
    return parseRss(await response.text(), source);
  } finally {
    clearTimeout(timer);
  }
}

async function searchWeb(query, { limit = DEFAULT_LIMIT, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const normalized = String(query || '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!normalized) throw new Error('Search query cannot be empty');
  const count = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 20));
  const encoded = encodeURIComponent(normalized);
  const feeds = [
    [`https://www.bing.com/news/search?q=${encoded}&format=rss`, 'Bing News'],
    [`https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`, 'Google News']
  ];
  const settled = await Promise.allSettled(feeds.map(([url, source]) => fetchFeed(url, source, timeoutMs)));
  const results = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const seen = new Set();
  const unique = results.filter(result => {
    const key = result.url.replace(/[?#].*$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, count);
  if (!unique.length) {
    const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason?.message).filter(Boolean);
    throw new Error(errors.length ? `Web search failed: ${errors.join('; ')}` : 'Web search returned no results');
  }
  return unique;
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(message) {
  if (!message || typeof message !== 'object' || !message.method) return;
  const id = message.id;
  if (message.method === 'initialize') {
    if (id !== undefined) send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'felix-web-search', version: '1.0.0' } } });
    return;
  }
  if (message.method === 'notifications/initialized' || message.method === 'ping') {
    if (message.method === 'ping' && id !== undefined) send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (message.method === 'tools/list') {
    if (id !== undefined) send({ jsonrpc: '2.0', id, result: { tools: [{ name: 'web_search', description: 'Search the public web and news feeds. Use this for current events, recent facts, and information that may have changed.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The search query.' }, limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of results (default 8).' } }, required: ['query'], additionalProperties: false } }] } });
    return;
  }
  if (message.method === 'tools/call') {
    try {
      if (message.params?.name !== 'web_search') throw new Error(`Unknown tool: ${message.params?.name || '(missing)'}`);
      const results = await searchWeb(message.params?.arguments?.query, { limit: message.params?.arguments?.limit });
      if (id !== undefined) send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ query: message.params.arguments.query, results }, null, 2) }], isError: false } });
    } catch (error) {
      if (id !== undefined) send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: error.message }], isError: true } });
    }
    return;
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${message.method}` } });
}

if (require.main === module) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => { try { const message = JSON.parse(line); handle(message).catch(error => process.stderr.write(`web-search-mcp: ${error.message}\n`)); } catch (error) { process.stderr.write(`web-search-mcp: invalid JSON (${error.message})\n`); } });
}

module.exports = { decodeXml, parseRss, searchWeb };
