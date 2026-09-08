const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { startMiniMaxAdapter } = require('../electron/minimax-adapter.cjs');
const { convertRequest, translateStream } = require('../electron/minimax-adapter.cjs');
const tool = { type: 'function', name: 'shell', description: 'Run a command', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } };
const request = (input = []) => ({ model: 'test-model', tools: [tool], input });
const stream = chunks => Buffer.from(chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\r\n\r\n').join('') + 'data: [DONE]\n\n');
const frame = (delta, finish_reason = null) => ({ choices: [{ delta, finish_reason }] });
async function translate(chunks, defs = convertRequest(request()).definitions) {
  const bytes = stream(chunks);
  const events = [];
  async function* splitBytes() { for (let i = 0; i < bytes.length; i++) yield bytes.subarray(i, i + 1); }
  await translateStream(splitBytes(), defs, 'test-model', event => events.push(structuredClone(event)));
  return events;
}

test('preserves system instructions, tool schema, call ID, and tool results in next request', () => {
  const input = request([
    { role: 'developer', content: [{ type: 'input_text', text: 'Approval required' }] },
    { role: 'user', content: 'List files' },
    { type: 'function_call', name: 'shell', call_id: 'c1', arguments: '{"cmd":"ls"}' },
    { type: 'function_call_output', call_id: 'c1', output: 'README.md' }
  ]);
  input.instructions = 'Coding agent system instructions';
  const { body } = convertRequest(input);
  assert.equal(body.messages[0].content, input.instructions);
  assert.equal(body.messages[1].role, 'system');
  assert.deepEqual(body.tools[0].function.parameters, tool.parameters);
  assert.equal(body.messages[3].tool_calls[0].id, 'c1');
  assert.deepEqual(body.messages[4], { role: 'tool', tool_call_id: 'c1', content: 'README.md' });
});

test('assembles interleaved parallel calls and fragmented names/arguments', async () => {
  const events = await translate([
    frame({ content: '先检查目录。', tool_calls: [{ index: 0, id: 'a', function: { name: 'sh', arguments: '{"cmd":' } }] }),
    frame({ tool_calls: [{ index: 1, id: 'b', function: { name: 'shell', arguments: '{"cmd":"pwd"}' } }, { index: 0, function: { name: 'ell', arguments: '"ls"}' } }] }, 'tool_calls')
  ]);
  const result = events.at(-1);
  assert.equal(result.type, 'response.completed');
  assert.equal(result.response.output[0].content[0].text, '先检查目录。');
  assert.deepEqual(result.response.output.slice(1).map(item => [item.call_id, JSON.parse(item.arguments).cmd]), [['a', 'ls'], ['b', 'pwd']]);
});

test('namespace and freeform input survive both directions', async () => {
  const { definitions, body } = convertRequest({ model: 'test', tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'apply_patch', description: 'Patch', format: { definition: 'patch grammar' } }] }], input: [] });
  const name = body.tools[0].function.name;
  const patch = '*** Begin Patch\n*** End Patch';
  const events = await translate([frame({ tool_calls: [{ index: 0, id: 'patch', function: { name, arguments: JSON.stringify({ input: patch }) } }] }, 'tool_calls')], definitions);
  const item = events.at(-1).response.output[0];
  assert.equal(item.type, 'custom_tool_call');
  assert.equal(item.namespace, 'functions');
  assert.equal(item.input, patch);
  const history = convertRequest({ model: 'test', input: [item, { type: 'custom_tool_call_output', call_id: 'patch', output: 'Success' }] }).body.messages;
  assert.equal(history[0].tool_calls[0].function.name, name);
  assert.equal(JSON.parse(history[0].tool_calls[0].function.arguments).input, patch);
  assert.equal(history[1].tool_call_id, 'patch');
});

for (const [label, chunks] of [
  ['truncated stream', [frame({ content: 'partial' })]],
  ['length limit', [frame({ content: 'partial' }, 'length')]],
  ['error event', [{ error: { code: 'invalid_prompt', message: 'Provider refused' } }]],
  ['invalid arguments', [frame({ tool_calls: [{ index: 0, id: 'a', function: { name: 'shell', arguments: '{' } }] }, 'tool_calls')]],
  ['unknown tool', [frame({ tool_calls: [{ index: 0, id: 'a', function: { name: 'invented', arguments: '{}' } }] }, 'tool_calls')]],
  ['empty response', [frame({}, 'stop')]]
]) test(label + ' fails without executing calls or emitting completed', async () => {
  const events = await translate(chunks);
  assert.equal(events.at(-1).type, 'response.failed');
  assert.ok(!events.some(event => event.type === 'response.completed' || event.type === 'response.output_item.done'));
});

test('client tool search loads discovered tools into the next request', async () => {
  const converted = convertRequest({ model: 'test', tools: [{ type: 'tool_search', execution: 'client', parameters: { type: 'object' } }], input: [] });
  const events = await translate([frame({ tool_calls: [{ index: 0, id: 'search', function: { name: 'tool_search', arguments: '{"query":"files"}' } }] }, 'tool_calls')], converted.definitions);
  const call = events.at(-1).response.output[0];
  assert.equal(call.type, 'tool_search_call');
  assert.deepEqual(call.arguments, { query: 'files' });
  const next = convertRequest({ model: 'test', input: [call, { type: 'tool_search_output', call_id: 'search', tools: [tool] }] });
  assert.equal(next.body.tools[0].function.name, 'shell');
  assert.equal(next.body.messages[1].tool_call_id, 'search');
});

async function withServers(t, handler) {
  const upstream = http.createServer(handler);
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const adapter = startMiniMaxAdapter({ port: 0, apiKey: 'test-only', upstream: 'http://127.0.0.1:' + upstream.address().port });
  await once(adapter, 'listening');
  t.after(async () => {
    adapter.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => adapter.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  });
  return 'http://127.0.0.1:' + adapter.address().port + '/v1/responses';
}

test('policy rejection is propagated once without rewriting instructions', async t => {
  let requests = 0;
  let received;
  const url = await withServers(t, async (req, res) => {
    requests++; let raw = ''; for await (const bytes of req) raw += bytes;
    received = JSON.parse(raw);
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'invalid_prompt', message: 'Rejected' } }));
  });
  const response = await fetch(url, { method: 'POST', body: JSON.stringify({ ...request(), instructions: 'Keep approvals enabled.' }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'invalid_prompt');
  assert.equal(requests, 1);
  assert.equal(received.messages[0].content, 'Keep approvals enabled.');
});

test('client disconnect cancels upstream streaming', { timeout: 5000 }, async t => {
  let disconnected;
  const closed = new Promise(resolve => { disconnected = resolve; });
  const url = await withServers(t, async (req, res) => {
    for await (const _ of req) { /* Consume request before watching response closure. */ }
    res.on('close', disconnected);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify(frame({ content: 'Working' })) + '\n\n');
  });
  const controller = new AbortController();
  const response = await fetch(url, { method: 'POST', body: JSON.stringify(request()), signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await reader.cancel().catch(() => {});
  await closed;
});
