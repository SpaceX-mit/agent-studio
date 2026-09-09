const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CronExpressionParser } = require('cron-parser');

function scheduleNext(schedule, now = Date.now()) {
  if (schedule.kind === 'once') return new Date(schedule.at).getTime() > now ? schedule.at : null;
  const [hour, minute] = schedule.time.split(':').map(Number);
  const days = schedule.kind === 'weekdays' ? '1-5' : schedule.kind === 'weekly' ? schedule.day : '*';
  return CronExpressionParser.parse(`${minute} ${hour} * * ${days}`, { currentDate: new Date(now), tz: schedule.timezone }).next().toISOString();
}

function validateTask(input, now) {
  if (!input || typeof input !== 'object') throw new Error('任务参数无效。');
  const string = (value, max, label) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}不能为空且长度不能超过 ${max}。`);
    return value.trim();
  };
  const name = string(input.name, 120, '名称');
  const prompt = string(input.prompt, 20000, '任务内容');
  if (!['agent', 'reminder'].includes(input.kind)) throw new Error('任务类型无效。');
  const model = input.kind === 'agent' ? string(input.model, 200, '模型') : '';
  if (!['read-only', 'workspace-write'].includes(input.permission)) throw new Error('执行权限无效。');
  const raw = input.schedule;
  if (!raw || !['once', 'daily', 'weekdays', 'weekly'].includes(raw.kind)) throw new Error('时间安排无效。');
  let schedule;
  if (raw.kind === 'once') {
    if (typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at)) || Date.parse(raw.at) <= now) throw new Error('请选择未来的运行时间。');
    schedule = { kind: 'once', at: new Date(raw.at).toISOString() };
  } else {
    if (typeof raw.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) throw new Error('时间格式应为 HH:mm。');
    if (typeof raw.timezone !== 'string') throw new Error('请选择时区。');
    try { new Intl.DateTimeFormat('en', { timeZone: raw.timezone }).format(); } catch { throw new Error('时区无效。'); }
    if (raw.kind === 'weekly' && (!Number.isInteger(raw.day) || raw.day < 0 || raw.day > 6)) throw new Error('星期无效。');
    schedule = { kind: raw.kind, time: raw.time, timezone: raw.timezone, ...(raw.kind === 'weekly' ? { day: raw.day } : {}) };
  }
  return { name, prompt, kind: input.kind, model, permission: input.permission, notify: Boolean(input.notify), schedule };
}

class TaskScheduler extends EventEmitter {
  constructor({ directory, runner, now = Date.now }) {
    super();
    this.directory = directory;
    this.file = path.join(directory, 'tasks.json');
    this.runner = runner;
    this.now = now;
    this.tasks = [];
    this.active = null;
    this.closed = false;
    this.stopping = false;
    this.loadError = '';
    fs.mkdirSync(directory, { recursive: true });
    try {
      if (fs.existsSync(this.file)) {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (data.version !== 1 || !Array.isArray(data.tasks)) throw new Error('任务文件格式无效。');
        for (const task of data.tasks) {
          if (typeof task.id !== 'string' || !['active', 'paused', 'completed'].includes(task.status) || !Array.isArray(task.runs)) throw new Error('任务记录无效。');
          validateTask(task, task.schedule?.kind === 'once' ? Date.parse(task.schedule.at) - 1 : now());
          if (task.nextRunAt && !Number.isFinite(Date.parse(task.nextRunAt))) throw new Error('下次运行时间无效。');
          for (const run of task.runs) if (run.status === 'running') {
            run.status = 'interrupted'; run.error = '应用在上次执行期间退出。'; run.finishedAt = new Date(now()).toISOString();
            if (task.schedule.kind === 'once' && !task.nextRunAt) task.status = 'completed';
          }
        }
        this.tasks = data.tasks;
        this.persist();
      }
    } catch (error) { this.loadError = `任务数据读取失败，原文件未覆盖：${error.message}`; this.tasks = []; }
  }

  persist() {
    if (this.loadError) throw new Error(this.loadError);
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ version: 1, tasks: this.tasks }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  change(fn) {
    if (this.closed) throw new Error('任务服务已停止。');
    if (this.loadError) throw new Error(this.loadError);
    const before = structuredClone(this.tasks);
    let value;
    try { value = fn(); this.persist(); }
    catch (error) { this.tasks = before; throw error; }
    this.emit('changed');
    return value;
  }
  list() {
    if (this.loadError) throw new Error(this.loadError);
    return structuredClone(this.tasks.map(task => ({ ...task, runs: task.runs.map(({ output, ...run }) => run) })));
  }
  get(id) { const task = this.tasks.find(item => item.id === id); if (!task) throw new Error('找不到任务。'); return task; }
  detail(id) { return structuredClone(this.get(id)); }
  save(input) {
    const fields = validateTask(input, this.now());
    if (input.id && this.active?.taskId === input.id) throw new Error('请先停止正在运行的任务。');
    return this.change(() => {
      const task = input.id ? this.get(input.id) : { id: randomUUID(), status: 'active', createdAt: new Date(this.now()).toISOString(), runs: [] };
      Object.assign(task, fields, { updatedAt: new Date(this.now()).toISOString() });
      if (task.status === 'completed') task.status = 'active';
      task.nextRunAt = task.status === 'active' ? scheduleNext(task.schedule, this.now()) : null;
      if (!input.id) this.tasks.unshift(task);
      return structuredClone(task);
    });
  }
  setStatus(id, status) {
    if (!['active', 'paused'].includes(status)) throw new Error('状态无效。');
    return this.change(() => {
      const task = this.get(id);
      const next = status === 'active' ? scheduleNext(task.schedule, this.now()) : null;
      if (status === 'active' && !next) throw new Error('一次性任务时间已过，请编辑时间或立即运行。');
      task.status = status; task.nextRunAt = next;
    });
  }
  remove(id) {
    if (this.active?.taskId === id) throw new Error('请先停止正在运行的任务。');
    this.get(id);
    this.change(() => { this.tasks = this.tasks.filter(task => task.id !== id); });
  }
  start() {
    if (this.timer || this.closed || this.stopping) return;
    this.timer = setInterval(() => void this.tick().catch(error => this.emit('failure', error.message)), 1000);
    this.timer.unref();
  }
  async tick() {
    if (this.active || this.closed || this.stopping || this.loadError) return;
    const task = this.tasks.filter(task => task.status === 'active' && task.nextRunAt && Date.parse(task.nextRunAt) <= this.now())
      .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))[0];
    if (task) await this.run(task.id, 'scheduled');
  }
  run(id, trigger = 'manual') {
    if (this.closed || this.stopping) throw new Error('任务服务已停止。');
    if (this.active) throw new Error('已有任务正在执行，请等待完成。');
    const task = this.get(id);
    const run = { id: randomUUID(), status: 'running', trigger, startedAt: new Date(this.now()).toISOString(), output: '' };
    this.change(() => {
      task.runs.unshift(run); task.runs = task.runs.slice(0, 50);
      // Advance before execution: crash recovery never reruns a possibly side-effecting occurrence.
      if (trigger === 'scheduled') task.nextRunAt = scheduleNext(task.schedule, this.now());
    });
    const controller = new AbortController();
    this.active = { taskId: id, runId: run.id, controller };
    const active = this.active;
    const done = Promise.resolve().then(() => this.execute(structuredClone(task), run.id, controller.signal, trigger));
    active.done = done;
    return done;
  }
  async execute(task, runId, signal, trigger) {
    let result = {}, error;
    try {
      result = task.kind === 'reminder' ? { output: task.prompt } : await this.runner(task, { signal, runId });
    } catch (caught) { error = caught; }
    try {
      this.change(() => {
        const current = this.get(task.id);
        const run = current.runs.find(item => item.id === runId);
        Object.assign(run, { status: signal.aborted ? 'interrupted' : error ? 'failed' : 'completed', finishedAt: new Date(this.now()).toISOString(), output: String(result.output || error?.output || '').slice(-200000), error: error ? String(error.message || error).slice(0, 4000) : signal.aborted ? '执行已停止。' : undefined, threadId: result.threadId });
        if (current.schedule.kind === 'once' && (trigger === 'scheduled' || !error && !signal.aborted)) { current.status = 'completed'; current.nextRunAt = null; }
      });
      this.emit('finished', this.detail(task.id));
    } finally { this.active = null; }
  }
  cancel(id) {
    if (this.active?.taskId !== id) throw new Error('该任务未在运行。');
    this.active.controller.abort();
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.timer); this.timer = null;
    try { if (this.active) { this.active.controller.abort(); await this.active.done; } }
    finally { this.closed = true; }
  }
}

module.exports = { TaskScheduler, scheduleNext, validateTask };
