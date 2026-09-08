const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { CodexRpc } = require('./codex-rpc.cjs');
const { startMiniMaxAdapter } = require('./minimax-adapter.cjs');

function findCommand(projectRoot) {
  if (process.env.CODEX_APP_SERVER_COMMAND) {
    const configured = path.resolve(process.env.CODEX_APP_SERVER_COMMAND);
    if (!configured.startsWith(path.resolve(projectRoot) + path.sep)) throw new Error('CODEX_APP_SERVER_COMMAND must point inside the project directory');
    if (!fs.existsSync(configured)) throw new Error(`Project Codex executable not found: ${configured}`);
    return { command: configured, args: [] };
  }
  const candidates = [
    path.join(projectRoot, '.project-cache', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    path.join(projectRoot, 'codex-upstream', 'codex-rs', 'target', 'debug', process.platform === 'win32' ? 'codex.exe' : 'codex'),
    path.join(projectRoot, 'codex-upstream', 'codex-rs', 'target', 'release', process.platform === 'win32' ? 'codex.exe' : 'codex')
  ];
  const found = candidates.find(file => fs.existsSync(file));
  if (!found) throw new Error(`Project open-source Codex executable not found. Build codex-upstream\\codex-rs first; refusing to use an installed Codex CLI.`);
  return { command: found, args: [] };
}

class CodexServer {
  constructor(projectRoot) { this.projectRoot = projectRoot; this.rpc = null; this.child = null; this.adapter = null; }

  start() {
    if (this.rpc) return this.rpc;
    const resolved = findCommand(this.projectRoot);
    const cache = path.join(this.projectRoot, '.project-cache');
    const temp = path.join(cache, 'temp');
    fs.mkdirSync(temp, { recursive: true });
    const env = { ...process.env, CODEX_HOME: path.join(cache, 'codex-home'), TEMP: temp, TMP: temp, TMPDIR: temp, npm_config_cache: path.join(cache, 'npm-cache') };
    // Always bind the local compatibility endpoint. With no key it returns a
    // deliberate 401 explaining the missing environment variable, instead of
    // making app-server fail with an opaque connection-refused error.
    this.adapter = startMiniMaxAdapter({ apiKey: env.MINIMAX_API_KEY, onError: error => this.rpc?.emit('stderr', `MiniMax adapter error: ${error.message}`) });
    fs.mkdirSync(env.CODEX_HOME, { recursive: true });
    // MiniMax chat completions cannot execute OpenAI-hosted web_search tools.
    this.child = spawn(resolved.command, [...resolved.args, '-c', 'web_search="disabled"', '-c', 'features.responses_websockets=false', '-c', 'features.responses_websockets_v2=false', 'app-server', '--stdio'], {
      cwd: this.projectRoot, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    this.rpc = new CodexRpc(this.child);
    this.rpc.command = resolved.command;
    this.rpc.on('closed', () => { this.rpc = null; this.child = null; });
    this.child.on('error', error => this.rpc?.emit('stderr', `Codex process error: ${error.message}`));
    return this.rpc;
  }

  stop() { if (this.rpc) this.rpc.close(); if (this.adapter) this.adapter.close(); this.rpc = null; this.child = null; this.adapter = null; }
}

module.exports = { CodexServer, findCommand };
