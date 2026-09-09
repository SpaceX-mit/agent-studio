const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TaskScheduler, scheduleNext, validateTask } = require('../electron/task-scheduler.cjs');

const task = (overrides = {}) => ({ name: '每日检查', prompt: '检查工作区', kind: 'reminder', model: '', permission: 'read-only', notify: true, schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }, ...overrides });
const cache = path.resolve(__dirname, '../../.project-cache/tmp');
fs.mkdirSync(cache, { recursive: true });
const temp = () => fs.mkdtempSync(path.join(cache, 'felix-tasks-'));

test('scheduleNext respects timezone and weekly day', () => {
  const now = Date.parse('2026-09-08T00:00:00.000Z');
  assert.equal(scheduleNext({ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }, now), '2026-09-08T01:00:00.000Z');
  assert.equal(scheduleNext({ kind: 'weekly', day: 5, time: '16:00', timezone: 'Asia/Shanghai' }, now), '2026-09-11T08:00:00.000Z');
});

test('save, list, pause, resume and delete persist task data', () => {
  let clock = Date.parse('2026-09-08T00:00:00.000Z'); const directory = temp();
  const scheduler = new TaskScheduler({ directory, now: () => clock, runner: async () => ({ output: 'ok' }) });
  const saved = scheduler.save(task());
  assert.equal(scheduler.list()[0].name, '每日检查');
  assert.equal(scheduler.list()[0].status, 'active');
  scheduler.setStatus(saved.id, 'paused'); assert.equal(scheduler.list()[0].status, 'paused');
  scheduler.setStatus(saved.id, 'active'); assert.equal(scheduler.list()[0].status, 'active');
  scheduler.remove(saved.id); assert.deepEqual(scheduler.list(), []);
  assert.ok(fs.existsSync(path.join(directory, 'tasks.json')));
});

test('manual run records successful and failed output, and one-time task completes', async () => {
  let clock = Date.parse('2026-09-08T00:00:00.000Z'); const directory = temp(); let count = 0;
  const scheduler = new TaskScheduler({ directory, now: () => clock, runner: async current => { count++; if (current.name === '失败') throw Object.assign(new Error('模型失败'), { output: 'partial' }); return { output: 'finished', threadId: 'thread-1' }; } });
  const success = scheduler.save(task({ name: '成功', kind: 'agent', model: 'MiniMax-M2.1', schedule: { kind: 'once', at: new Date(clock + 60_000).toISOString() } }));
  await scheduler.run(success.id); assert.equal(scheduler.detail(success.id).runs[0].status, 'completed'); assert.equal(scheduler.detail(success.id).status, 'completed');
  const failure = scheduler.save(task({ name: '失败', kind: 'agent', model: 'MiniMax-M2.1' }));
  await scheduler.run(failure.id); assert.equal(scheduler.detail(failure.id).runs[0].status, 'failed'); assert.match(scheduler.detail(failure.id).runs[0].error, /模型失败/); assert.equal(count, 2);
});

test('shutdown waits for cancellation and persists interrupted status', async () => {
  const directory = temp(); let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const first = new TaskScheduler({ directory, now: () => Date.now(), runner: async () => { await waiting; return { output: 'late' }; } });
  const saved = first.save(task({ kind: 'agent', model: 'MiniMax-M2.1' })); const run = first.run(saved.id); await new Promise(resolve => setTimeout(resolve, 5)); const stopping = first.stop(); release({ output: 'late' }); await stopping; await run;
  const restarted = new TaskScheduler({ directory, now: () => Date.now(), runner: async () => ({ output: 'ok' }) });
  assert.equal(restarted.detail(saved.id).runs[0].status, 'interrupted');
  const second = restarted.run(saved.id); restarted.cancel(saved.id); await second;
  assert.equal(restarted.detail(saved.id).runs[0].status, 'interrupted');
});

test('overdue recurring tasks run once, serialize execution and skip missed backlog', async () => {
  let clock = Date.parse('2026-09-08T00:00:00Z'), calls = 0, release;
  const scheduler = new TaskScheduler({ directory: temp(), now: () => clock, runner: async () => { calls++; await new Promise(resolve => { release = resolve; }); return { output: 'done' }; } });
  const first = scheduler.save(task({ kind: 'agent', model: 'test' }));
  const second = scheduler.save(task({ kind: 'agent', model: 'test' }));
  clock = Date.parse('2026-09-11T02:00:00Z');
  const done = scheduler.tick(); await Promise.resolve();
  const running = scheduler.detail(scheduler.active.taskId);
  assert.equal(calls, 1);
  assert.throws(() => scheduler.run(second.id), /已有任务/);
  assert.throws(() => scheduler.remove(running.id), /先停止/);
  assert.throws(() => scheduler.save({ ...running, name: 'changed' }), /先停止/);
  await scheduler.tick(); assert.equal(calls, 1);
  assert.equal(scheduler.detail(running.id).nextRunAt, '2026-09-12T01:00:00.000Z');
  release(); await done;
  const next = scheduler.tick(); await Promise.resolve(); release(); await next;
  assert.equal(calls, 2);
  await scheduler.tick(); assert.equal(calls, 2);
  await scheduler.stop();
});

test('crash recovery marks an unfinished occurrence interrupted without replaying it', async () => {
  let clock = Date.parse('2026-09-08T00:00:00Z'); const directory = temp();
  const before = new TaskScheduler({ directory, now: () => clock });
  const saved = before.save(task({ schedule: { kind: 'once', at: '2026-09-08T01:00:00Z' } }));
  await before.stop();
  const file = path.join(directory, 'tasks.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.tasks[0].nextRunAt = null;
  data.tasks[0].runs = [{ id: 'crashed-run', status: 'running', trigger: 'scheduled', startedAt: saved.schedule.at, output: '' }];
  fs.writeFileSync(file, JSON.stringify(data));
  clock = Date.parse('2026-09-08T02:00:00Z');
  const recovered = new TaskScheduler({ directory, now: () => clock, runner: () => assert.fail('No replay') });
  assert.equal(recovered.detail(saved.id).status, 'completed');
  assert.equal(recovered.detail(saved.id).runs[0].status, 'interrupted');
  await recovered.tick(); assert.equal(recovered.detail(saved.id).runs.length, 1);
  await recovered.stop();
});

test('corrupt storage is never silently replaced with an empty task file', () => {
  const directory = temp(), file = path.join(directory, 'tasks.json'), original = '{invalid-json';
  fs.writeFileSync(file, original);
  const scheduler = new TaskScheduler({ directory });
  assert.throws(() => scheduler.list(), /原文件未覆盖/);
  assert.throws(() => scheduler.save(task()), /原文件未覆盖/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('recurrence follows local wall clock across DST and weekends', () => {
  const schedule = { kind: 'daily', time: '09:00', timezone: 'America/New_York' };
  assert.equal(scheduleNext(schedule, Date.parse('2026-03-07T15:00:00Z')), '2026-03-08T13:00:00.000Z');
  assert.equal(scheduleNext(schedule, Date.parse('2026-10-31T15:00:00Z')), '2026-11-01T14:00:00.000Z');
  assert.equal(scheduleNext({ ...schedule, kind: 'weekdays' }, Date.parse('2026-09-11T15:00:00Z')), '2026-09-14T13:00:00.000Z');
});

test('run history and output are bounded and list responses omit output', async () => {
  const scheduler = new TaskScheduler({ directory: temp(), runner: async () => ({ output: 'x'.repeat(210000) }) });
  const saved = scheduler.save(task({ kind: 'agent', model: 'test' }));
  await scheduler.run(saved.id);
  assert.equal(scheduler.detail(saved.id).runs[0].output.length, 200000);
  assert.equal(scheduler.list()[0].runs[0].output, undefined);
  const reminder = scheduler.save(task());
  for (let count = 0; count < 52; count++) await scheduler.run(reminder.id);
  assert.equal(scheduler.detail(reminder.id).runs.length, 50);
  await scheduler.stop();
});

test('validation rejects unsafe or ambiguous schedules', () => {
  assert.throws(() => validateTask(task({ name: '' }), Date.now()), /名称不能为空/);
  assert.throws(() => validateTask(task({ permission: 'danger-full-access' }), Date.now()), /执行权限无效/);
  assert.throws(() => validateTask(task({ schedule: { kind: 'once', at: new Date(Date.now() - 1000).toISOString() } }), Date.now()), /未来/);
  assert.throws(() => validateTask(task({ schedule: { kind: 'daily', time: '25:00', timezone: 'Asia/Shanghai' } }), Date.now()), /HH:mm/);
});
