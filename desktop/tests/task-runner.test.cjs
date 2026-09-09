const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { createTaskRunner } = require('../electron/task-runner.cjs');
const { TaskScheduler } = require('../electron/task-scheduler.cjs');
const root = path.resolve(__dirname, '../..');
const task = { name: 'Runner integration', model: 'MiniMax-M2.1', prompt: 'Print FELIX_SCHEDULE_OK using a read-only shell command and report the result.', permission: 'read-only' };

test('real project Codex executes a scheduled tool request and persists final output', { timeout: 60000 }, async () => {
  let requests = 0, upstreamError;
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (requests === 1) {
        const tool = body.tools.find(item => /(^|__)(exec_command|shell_command|shell)$/.test(item.function.name));
        assert.ok(tool);
        const props = tool.function.parameters.properties;
        const command = "Write-Output 'FELIX_SCHEDULE_OK'";
        const args = props.cmd ? { cmd: command, max_output_tokens: 100 } : { command: props.command.type === 'array' ? ['powershell.exe', '-NoProfile', '-Command', command] : command };
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'scheduled-call', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }) + '\n\n');
      } else {
        const result = body.messages.find(message => message.role === 'tool' && message.tool_call_id === 'scheduled-call');
        assert.ok(result); assert.match(result.content, /FELIX_SCHEDULE_OK/);
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Verified FELIX_SCHEDULE_OK from the scheduled run.' }, finish_reason: 'stop' }] }) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { upstreamError = error; res.end('data: [DONE]\n\n'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const runner = createTaskRunner(root, { apiKey: () => 'local-test', upstream: `http://127.0.0.1:${server.address().port}`, timeoutMs: 45000 });
    const directory = fs.mkdtempSync(path.join(root, '.project-cache/tmp/task-real-runner-'));
    let clock = Date.now();
    const scheduler = new TaskScheduler({ directory, runner, now: () => clock });
    const saved = scheduler.save({ ...task, kind: 'agent', notify: false, schedule: { kind: 'once', at: new Date(clock + 1000).toISOString() } });
    await scheduler.tick(); assert.equal(requests, 0);
    clock += 1500; await scheduler.tick();
    const result = scheduler.detail(saved.id).runs[0];
    await scheduler.stop();
    if (upstreamError) throw upstreamError;
    assert.equal(result.status, 'completed', result.error);
    assert.equal(result.trigger, 'scheduled');
    assert.equal(requests, 2); assert.match(result.output, /Verified FELIX_SCHEDULE_OK/); assert.ok(result.threadId);
    const restarted = new TaskScheduler({ directory, runner });
    assert.equal(restarted.detail(saved.id).runs[0].output, result.output);
    assert.equal(restarted.detail(saved.id).status, 'completed'); await restarted.stop();
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('missing key fails explicitly before launching a Codex process', async () => {
  const runner = createTaskRunner(root, { apiKey: () => '' });
  await assert.rejects(runner(task, { signal: new AbortController().signal, runId: randomUUID() }), /MINIMAX_API_KEY/);
});

test('cancellation closes active model connections and terminates the dedicated child', { timeout: 20000 }, async () => {
  const controller = new AbortController();
  let incoming;
  const requested = new Promise(resolve => { incoming = resolve; });
  const server = http.createServer((req, res) => { incoming(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const runner = createTaskRunner(root, { apiKey: () => 'local-test', upstream: `http://127.0.0.1:${server.address().port}`, timeoutMs: 8000 });
    const done = runner(task, { signal: controller.signal, runId: randomUUID() });
    const rejected = assert.rejects(done, /停止|超过/);
    await Promise.race([requested, done.catch(() => {})]); controller.abort(); await rejected;
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
