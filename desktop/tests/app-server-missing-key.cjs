const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CodexRpc } = require('../electron/codex-rpc.cjs');
const { findCommand } = require('../electron/codex-server.cjs');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const env = { ...process.env, CODEX_HOME: path.join(root, '.project-cache/codex-home') };
  delete env.MINIMAX_API_KEY;
  const child = spawn(findCommand(root).command, ['app-server', '--stdio'], { cwd: root, env, windowsHide: true });
  const rpc = new CodexRpc(child);
  let stderr = '';
  rpc.on('stderr', chunk => { stderr += chunk; });
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('app-server smoke timed out')), 30000); });
  const run = async () => {
    await rpc.request('initialize', { clientInfo: { name: 'replica_smoke', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    rpc.notify('initialized', {});
    const { thread } = await rpc.request('thread/start', { cwd: root, model: 'MiniMax-M2.1', modelProvider: 'minimax', ephemeral: true });
    const completed = new Promise(resolve => rpc.on('notification', event => {
      if (event.method === 'turn/completed' && event.params.threadId === thread.id) resolve(event.params.turn);
    }));
    await rpc.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'hello' }] });
    const turn = await completed;
    assert.equal(turn.status, 'failed');
    assert.match(turn.error.message, /MINIMAX_API_KEY/);
    assert.doesNotMatch(stderr, /MCP server startup failed.*node_repl/);
    console.log('PASS: project Codex reports missing key via turn/completed; no node_repl startup failure.');
  };
  try { await Promise.race([run(), timeout]); }
  finally { clearTimeout(timer); rpc.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
