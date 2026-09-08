const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CodexRpc } = require('../electron/codex-rpc.cjs');
const { findCommand } = require('../electron/codex-server.cjs');
const { startMiniMaxAdapter } = require('../electron/minimax-adapter.cjs');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const scratch = fs.mkdtempSync(path.join(root, '.project-cache/tool-bridge-'));
  let count = 0;
  let rpc;
  let adapter;
  let timer;
  let upstreamError;
  const denyMode = process.argv.includes('--deny');
  const approvalMode = process.argv.includes('--approval') || denyMode;
  let approvalCount = 0;
  const upstream = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      count++;
      const send = chunk => res.write('data: ' + JSON.stringify({ choices: [chunk] }) + '\n\n');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (count === 1) {
        const tools = body.tools || [];
        const tool = tools.find(tool => /(^|__)(shell_command|exec_command|shell)$/.test(tool.function.name));
        assert.ok(tool, 'No shell tool in: ' + tools.map(tool => tool.function.name).join(', '));
        const props = tool.function.parameters.properties;
        const command = "Write-Output 'CODEX_TOOL_BRIDGE_OK'";
        const args = props.cmd ? { cmd: command, max_output_tokens: 1000 } : { command: props.command.type === 'array' ? ['powershell.exe', '-NoProfile', '-Command', command] : command };
        if (approvalMode) { args.sandbox_permissions = 'require_escalated'; args.justification = 'Print the local tool-bridge test marker.'; }
        send({ delta: { content: 'Checking the workspace.', tool_calls: [{ index: 0, id: 'smoke-call', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' });
      } else if (count === 2) {
        const result = body.messages.find(message => message.role === 'tool' && message.tool_call_id === 'smoke-call');
        assert.ok(result, 'Codex did not return tool output to MiniMax');
        if (denyMode) {
          assert.match(result.content, /reject|denied|declin|cancel/i);
          send({ delta: { content: 'Command approval was denied; no file was changed.' }, finish_reason: 'stop' });
          res.end('data: [DONE]\n\n');
          return;
        }
        assert.match(result.content, /CODEX_TOOL_BRIDGE_OK/);
        const patchTool = body.tools.find(tool => /(^|__)apply_patch$/.test(tool.function.name));
        const patch = '*** Begin Patch\n*** Add File: bridge-result.txt\n+CODEX_PATCH_OK\n*** End Patch';
        const tool = patchTool || body.tools.find(tool => /(^|__)(exec_command|shell_command)$/.test(tool.function.name));
        assert.ok(tool, 'No file-editing or shell tool');
        const writeCommand = "Set-Content -LiteralPath 'bridge-result.txt' -Value 'CODEX_PATCH_OK'";
        const args = patchTool ? { input: patch } : tool.function.parameters.properties.cmd ? { cmd: writeCommand } : { command: writeCommand };
        if (approvalMode && !patchTool) { args.sandbox_permissions = 'require_escalated'; args.justification = 'Write the test result inside the isolated test directory.'; }
        send({ delta: { tool_calls: [{ index: 0, id: 'patch-call', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' });
      } else {
        const result = body.messages.find(message => message.role === 'tool' && message.tool_call_id === 'patch-call');
        assert.ok(result, 'Missing patch output: ' + JSON.stringify(body.messages.map(message => ({ role: message.role, id: message.tool_call_id, calls: message.tool_calls }))));
        assert.equal(fs.readFileSync(path.join(scratch, 'bridge-result.txt'), 'utf8').trim(), 'CODEX_PATCH_OK');
        send({ delta: { content: 'Verified CODEX_TOOL_BRIDGE_OK from the real command.' }, finish_reason: 'stop' });
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { upstreamError = error; res.end('data: ' + JSON.stringify({ error: { message: error.message } }) + '\n\n'); }
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  adapter = startMiniMaxAdapter({ port: 0, apiKey: 'local-test', upstream: 'http://127.0.0.1:' + upstream.address().port });
  await once(adapter, 'listening');
  const env = { ...process.env, CODEX_HOME: path.join(scratch, 'codex-home'), MINIMAX_API_KEY: 'local-test', TEMP: scratch, TMP: scratch };
  fs.mkdirSync(env.CODEX_HOME);
  const binary = findCommand(root).command;
  const child = spawn(binary, ['-c', 'model_providers.minimax.name="MiniMax test"', '-c', 'model_providers.minimax.wire_api="responses"', '-c', 'model_providers.minimax.env_key="MINIMAX_API_KEY"', '-c', 'model_providers.minimax.base_url="http://127.0.0.1:' + adapter.address().port + '/v1"', '-c', 'web_search="disabled"', 'app-server', '--stdio'], { cwd: scratch, env, windowsHide: true });
  rpc = new CodexRpc(child);
  rpc.on('request', event => {
    if (event.method.endsWith('/requestApproval')) {
      approvalCount++;
      rpc.respond(event.id, { decision: denyMode ? 'decline' : 'accept' });
    } else rpc.respond(event.id, undefined, { code: -32601, message: 'Unexpected smoke test request' });
  });
  const executions = [];
  const replies = [];
  rpc.on('notification', event => {
    if (event.method === 'item/completed' && event.params.item?.type === 'commandExecution') executions.push(event.params.item);
    if (event.method === 'item/agentMessage/delta') replies.push(event.params.delta);
  });
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Tool round-trip timed out')), 60000); });
  const run = async () => {
    await rpc.request('initialize', { clientInfo: { name: 'tool_bridge_test', version: '1' }, capabilities: { experimentalApi: true } });
    rpc.notify('initialized', {});
    const { thread } = await rpc.request('thread/start', { cwd: scratch, model: process.argv.includes('--custom') ? 'gpt-5.2' : 'MiniMax-M2.1', modelProvider: 'minimax', sandbox: approvalMode ? 'read-only' : 'danger-full-access', approvalPolicy: approvalMode ? 'on-request' : 'never', ephemeral: !process.argv.includes('--fork') });
    const done = new Promise(resolve => rpc.on('notification', event => { if (event.method === 'turn/completed' && event.params.threadId === thread.id) resolve(event.params.turn); }));
    await rpc.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Run a local command to print CODEX_TOOL_BRIDGE_OK, then report its result.' }] });
    const turn = await done;
    if (upstreamError) throw upstreamError;
    assert.equal(turn.status, 'completed', JSON.stringify(turn.error));
    if (denyMode) {
      assert.equal(count, 2);
      assert.ok(approvalCount > 0);
      assert.ok(!executions.some(item => item.exitCode === 0));
      assert.ok(!fs.existsSync(path.join(scratch, 'bridge-result.txt')));
      assert.match(replies.join(''), /approval was denied/);
      console.log('PASS: Codex approval declined -> no execution -> rejection returned to model -> final explanation.');
      return;
    }
    assert.equal(count, 3, 'Expected command, patch, and final reply requests');
    if (approvalMode) assert.ok(approvalCount > 0, 'No approval request');
    assert.ok(executions.some(item => item.exitCode === 0), 'No successful command execution: ' + JSON.stringify(executions));
    assert.match(replies.join(''), /Verified CODEX_TOOL_BRIDGE_OK/);
    if (process.argv.includes('--fork')) {
      const laterDone = new Promise(resolve => rpc.on('notification', event => {
        if (event.method === 'turn/completed' && event.params.threadId === thread.id && event.params.turn.id !== turn.id) resolve(event.params.turn);
      }));
      await rpc.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'A later turn that must not appear in the fork.' }] });
      const later = await laterDone;
      assert.equal(later.status, 'completed');
      const forked = await rpc.request('thread/fork', { threadId: thread.id, lastTurnId: turn.id, excludeTurns: true, deferGoalContinuation: true });
      const branch = await rpc.request('thread/turns/list', { threadId: forked.thread.id, limit: 100, itemsView: 'full' });
      const original = await rpc.request('thread/turns/list', { threadId: thread.id, limit: 100, itemsView: 'full' });
      assert.equal(branch.data.length, 1);
      assert.equal(original.data.length, 2);
      console.log('PASS: real Codex fork retains selected first turn; excludes later turn; source retains both turns.');
    }
    console.log('PASS: project-built Codex -> real command (exit 0) -> file written and verified -> final response. Approval requests: ' + approvalCount);
  };
  try { await Promise.race([run(), timeout]); }
  finally {
    clearTimeout(timer); rpc.close();
    await once(child, 'exit').catch(() => {});
    adapter.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => adapter.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
