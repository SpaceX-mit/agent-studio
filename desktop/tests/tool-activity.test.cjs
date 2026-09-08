const test = require('node:test');
const assert = require('node:assert/strict');
const { applyToolEvent, finishTools, restoreMessages } = require('../src/toolActivity.ts');
const makeThread = () => ({ messages: [{ id: 'before', role: 'assistant', content: 'Checking files' }] });

test('command stays in order after output, completion and turn completion', () => {
  const thread = makeThread();
  applyToolEvent(thread, 'item/started', { turnId: 't', item: { id: 'c', type: 'commandExecution', command: 'Get-Content README.md', status: 'inProgress' } });
  applyToolEvent(thread, 'item/commandExecution/outputDelta', { turnId: 't', itemId: 'c', delta: 'hello' });
  thread.messages.push({ id: 'after', role: 'assistant', content: 'Found it' });
  applyToolEvent(thread, 'item/completed', { turnId: 't', item: { id: 'c', type: 'commandExecution', status: 'completed', aggregatedOutput: 'hello world', exitCode: 0, durationMs: 42 } });
  finishTools(thread, 't');
  assert.deepEqual(thread.messages.map(message => message.id), ['before', 'tool-c', 'after']);
  assert.equal(thread.messages[1].tool.output, 'hello world');
  assert.equal(thread.messages[1].tool.durationMs, 42);
  assert.equal(thread.messages[1].tool.status, 'completed');
  const persisted = JSON.parse(JSON.stringify(thread)).messages[1].tool;
  assert.equal(persisted.output, 'hello world');
  assert.equal(persisted.status, 'completed');
  assert.equal(persisted.command, 'Get-Content README.md');
});

test('completed-only history and live output produce one tool row', () => {
  const thread = makeThread();
  applyToolEvent(thread, 'item/commandExecution/outputDelta', { turnId: 't', itemId: 'c', delta: 'error' });
  const params = { turnId: 't', item: { id: 'c', type: 'commandExecution', status: 'failed', exitCode: 1, aggregatedOutput: 'error' } };
  applyToolEvent(thread, 'item/completed', params);
  applyToolEvent(thread, 'item/completed', params);
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[1].tool.output, 'error');
});

test('history restores commands and file changes alongside text', () => {
  const items = [
    { type: 'agentMessage', id: 'a', text: 'Checking' },
    { type: 'commandExecution', id: 'c', command: 'pwd', status: 'completed', aggregatedOutput: 'D:/project', exitCode: 0 },
    { item: { type: 'fileChange', id: 'f', status: 'completed', changes: [{ path: 'a.txt', kind: { type: 'add' }, diff: '+hi' }] } },
    { type: 'agentMessage', id: 'b', text: 'Done' }
  ];
  const restored = restoreMessages(items, []);
  assert.deepEqual(restored.map(message => message.id), ['live-a', 'tool-c', 'tool-f', 'live-b']);
  assert.equal(restored[2].tool.changes[0].path, 'a.txt');
  assert.deepEqual(restoreMessages(items, restored).map(message => message.id), restored.map(message => message.id));
});

test('omitted remote tools retain their position before the next assistant message', () => {
  const previous = [{ id: 'tool-c', role: 'system', content: '', tool: { kind: 'commandExecution', status: 'completed', output: 'saved' } }, { id: 'live-b', role: 'assistant', content: 'Done' }];
  const restored = restoreMessages([{ id: 'b', type: 'agentMessage', text: 'Done' }], previous);
  assert.deepEqual(restored.map(message => message.id), ['tool-c', 'live-b']);
});

test('turn termination updates unfinished tools without deleting them or other turns', () => {
  const thread = makeThread();
  for (const id of ['one', 'two']) applyToolEvent(thread, 'item/started', { turnId: id, item: { id, type: 'commandExecution', status: 'inProgress' } });
  finishTools(thread, 'one', true);
  assert.equal(thread.messages[1].tool.status, 'failed');
  assert.equal(thread.messages[2].tool.status, 'inProgress');
});
