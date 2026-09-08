const { EventEmitter } = require('node:events');

/** Small JSONL JSON-RPC client used by the Electron main process. */
class CodexRpc extends EventEmitter {
  constructor(child) {
    super();
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.closedError = null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.#consume(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => { if (!this.closedError) this.emit('stderr', String(text)); });
    child.stdin.on('error', error => this.#fail(error));
    child.on('error', error => this.#fail(error));
    child.on('exit', (code, signal) => this.#fail(new Error(`codex app-server exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`)));
  }

  request(method, params = {}) {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(message, error => {
        if (error) { this.pending.delete(id); reject(error); }
      });
    });
  }

  notify(method, params = {}) {
    if (this.closedError) throw this.closedError;
    this.child.stdin.write(JSON.stringify({ method, params }) + '\n');
  }

  respond(id, result, error) {
    if (this.closedError) throw this.closedError;
    const payload = error ? { id, error } : { id, result };
    this.child.stdin.write(JSON.stringify(payload) + '\n');
  }

  close() {
    this.#fail(new Error('codex app-server closed'));
    if (!this.child.killed) { try { this.child.kill(); } catch {} }
  }

  #consume(chunk) {
    if (this.closedError) return;
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try { this.#message(JSON.parse(line)); }
      catch (error) { this.emit('parse-error', { error: String(error), line }); }
    }
  }

  #message(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return this.emit('response', message);
      this.pending.delete(message.id);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message || 'JSON-RPC error'), { code: message.error.code, data: message.error.data }));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) return this.emit('request', message);
    if (message.method) this.emit('notification', message);
    else this.emit('message', message);
  }

  #fail(error) {
    if (this.closedError) return;
    this.closedError = error;
    this.buffer = '';
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    this.emit('closed', error);
  }
}

module.exports = { CodexRpc };
