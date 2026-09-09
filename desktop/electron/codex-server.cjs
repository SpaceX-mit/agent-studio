const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
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

function tomlString(value) {
  // JSON quoted strings use the same escapes needed by TOML basic strings.
  return JSON.stringify(String(value));
}

function nodeCommand() {
  if (process.env.FELIX_NODE_COMMAND) return process.env.FELIX_NODE_COMMAND;
  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    return execFileSync(command, ['node'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean) || 'node';
  } catch {
    return 'node';
  }
}

function ensureProjectConfig(codexHome, projectRoot) {
  const configPath = path.join(codexHome, 'config.toml');
  const script = path.join(projectRoot, 'desktop', 'electron', 'web-search-mcp.cjs');
  let existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  // Replace only Felix's managed section, preserving all user/project config.
  const lines = existing.split(/\r?\n/);
  const section = lines.findIndex(line => line.trim() === '[mcp_servers.felix_web_search]');
  if (section >= 0) {
    let start = section;
    if (start > 0 && lines[start - 1].trim() === '# Felix project web search bridge. This config lives under .project-cache.') start--;
    let end = section + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
    lines.splice(start, end - start);
    existing = lines.join('\n');
  }
  const suffix = [
    '',
    '# Felix project web search bridge. This config lives under .project-cache.',
    '[mcp_servers.felix_web_search]',
    // Electron's process.execPath is electron.exe, not a Node interpreter.
    // The project launcher already requires Node on PATH for its tooling.
    `command = ${tomlString(nodeCommand())}`,
    `args = [${tomlString(script)}]`,
    'enabled = true',
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 20',
    'default_tools_approval_mode = "auto"',
    ''
  ].join('\n');
  fs.writeFileSync(configPath, existing.replace(/\s*$/, '') + suffix, 'utf8');
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
    ensureProjectConfig(env.CODEX_HOME, this.projectRoot);
    // Hosted web_search is unavailable through MiniMax Chat Completions. Felix
    // exposes an equivalent local MCP tool backed by public RSS search feeds.
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

module.exports = { CodexServer, findCommand, ensureProjectConfig };
