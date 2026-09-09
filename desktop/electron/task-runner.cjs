const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { once } = require('node:events');
const { CodexRpc } = require('./codex-rpc.cjs');
const { findCommand, ensureProjectConfig } = require('./codex-server.cjs');
const { startMiniMaxAdapter } = require('./minimax-adapter.cjs');

function createTaskRunner(projectRoot, { apiKey = () => process.env.MINIMAX_API_KEY, upstream, timeoutMs = 10 * 60 * 1000 } = {}) {
  return async (task, { signal, runId }) => {
    if (!apiKey()?.trim()) throw new Error('未配置 MINIMAX_API_KEY，请带密钥重新启动项目副本。');
    const home = path.join(projectRoot, '.project-cache', 'scheduled-tasks', 'runs', runId);
    const cache = path.join(projectRoot, '.project-cache');
    fs.mkdirSync(home, { recursive: true });
    let rpc, adapter, timer, child, halted = false, output = '';
    const append = text => { output = (output + text).slice(-200000); };
    let fail;
    const aborted = new Promise((_, reject) => { fail = error => { halted = true; reject(error); }; });
    const cancel = () => fail(new Error('执行已停止。'));
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => fail(new Error('任务执行超过 10 分钟，已停止。')), timeoutMs);
    try {
      const execute = async () => {
        if (signal.aborted || halted) throw new Error('执行已停止。');
        adapter = startMiniMaxAdapter({ port: 0, apiKey: apiKey(), upstream });
        await once(adapter, 'listening');
        if (signal.aborted || halted) throw new Error('执行已停止。');
        ensureProjectConfig(home, projectRoot);
        const command = findCommand(projectRoot).command;
        const settings = [
          'model_providers.minimax.name="MiniMax"', 'model_providers.minimax.wire_api="responses"',
          'model_providers.minimax.env_key="MINIMAX_API_KEY"',
          `model_providers.minimax.base_url="http://127.0.0.1:${adapter.address().port}/v1"`,
          'web_search="disabled"', 'features.responses_websockets=false', 'features.responses_websockets_v2=false',
        ];
        child = spawn(command, [...settings.flatMap(setting => ['-c', setting]), 'app-server', '--stdio'], {
          cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env, CODEX_HOME: home, MINIMAX_API_KEY: apiKey(), TEMP: home, TMP: home, TMPDIR: home,
            npm_config_cache: path.join(cache, 'npm-cache'), npm_config_store_dir: path.join(cache, 'pnpm-store'),
            PIP_CACHE_DIR: path.join(cache, 'pip'), UV_CACHE_DIR: path.join(cache, 'uv'),
            CARGO_HOME: path.join(cache, 'cargo'), RUSTUP_HOME: path.join(cache, 'rustup'),
            CARGO_TARGET_DIR: path.join(cache, 'cargo-target'),
          },
        });
        rpc = new CodexRpc(child);
        rpc.on('closed', error => fail(error));
        rpc.on('request', message => {
          // Unattended tasks cannot grant extra permissions or invent interactive answers.
          rpc.respond(message.id, undefined, { code: -32000, message: 'Scheduled task requires interactive approval. Run it in a chat.' });
          fail(new Error('任务需要交互或额外权限，请在对话中执行。'));
        });
        let threadId;
        const completed = new Promise((resolve, reject) => rpc.on('notification', message => {
          const params = message.params || {};
          if (!threadId || params.threadId !== threadId) return;
          if (message.method === 'item/agentMessage/delta') append(params.delta || '');
          if (message.method === 'item/completed' && params.item?.type === 'commandExecution') append(`\n$ ${params.item.command}\n${params.item.aggregatedOutput || ''}\n`);
          if (message.method === 'item/completed' && params.item?.type === 'fileChange') append(`\n${JSON.stringify(params.item.changes || [])}\n`);
          if (message.method === 'error' && !params.willRetry) reject(new Error(params.error?.message || '模型请求失败。'));
          if (message.method === 'turn/completed') {
            if (params.turn?.status !== 'completed') reject(new Error(params.turn?.error?.message || '任务未正常完成。'));
            else resolve();
          }
        }));
        completed.catch(() => {});
        await rpc.request('initialize', { clientInfo: { name: 'felix_scheduled_task', version: '1' }, capabilities: { experimentalApi: true } });
        rpc.notify('initialized', {});
        const result = await rpc.request('thread/start', { cwd: projectRoot, model: task.model, modelProvider: 'minimax', sandbox: task.permission, approvalPolicy: 'never', ephemeral: true });
        threadId = result.thread?.id;
        if (!threadId) throw new Error('Codex 未返回任务线程。');
        await rpc.request('turn/start', { threadId, input: [{ type: 'text', text: task.prompt }] });
        await completed;
        if (!output.trim()) throw new Error('任务结束但没有输出。');
        return { output, threadId };
      };
      return await Promise.race([execute(), aborted]);
    } catch (error) { error.output = output; throw error; }
    finally {
      halted = true;
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit').catch(() => {});
        if (process.platform === 'win32' && child.pid) await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => resolve()));
        rpc?.close();
        let deadline;
        await Promise.race([exited, new Promise(resolve => { deadline = setTimeout(resolve, 2000); })]);
        clearTimeout(deadline);
      } else rpc?.close();
      if (adapter) { adapter.closeAllConnections(); await new Promise(resolve => adapter.close(resolve)); }
    }
  };
}

module.exports = { createTaskRunner };
