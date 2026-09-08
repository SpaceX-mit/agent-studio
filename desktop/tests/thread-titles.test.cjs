const test = require('node:test');
const assert = require('node:assert/strict');
const { automaticThreadTitle, ensureThreadTitle, loadState, defaultState, createThread, appendMessage } = require('../src/store.ts');

const values = new Map();
global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };

test('first send names an existing empty chat and subsequent messages preserve it', () => {
  const state = defaultState();
  const thread = createThread(state);
  appendMessage(state, thread.id, 'user', '  检查工作区\n 并修复构建错误  ');
  assert.equal(thread.title, '检查工作区 并修复构建错误');
  assert.equal(thread.titleSource, 'auto');
  appendMessage(state, thread.id, 'user', '接下来修改界面');
  assert.equal(thread.title, '检查工作区 并修复构建错误');
});

test('legacy default titles are repaired on load, without renaming empty or manual chats', () => {
  const state = defaultState();
  state.threads = [
    { id: 'legacy', title: '新对话', messages: [{ role: 'user', content: '修复历史会话标题' }] },
    { id: 'empty', title: '新对话', messages: [] },
    { id: 'manual', title: '新对话', titleSource: 'manual', messages: [{ role: 'user', content: '保留手动标题' }] },
    { id: 'named', title: '发布检查', messages: [{ role: 'user', content: '原始消息' }] },
  ];
  localStorage.setItem('codex-desktop-state-v1', JSON.stringify(state));
  assert.deepEqual(loadState().threads.map(thread => thread.title), ['修复历史会话标题', '新对话', '新对话', '发布检查']);
});

test('long titles keep enough content to scroll and truncate on grapheme boundaries', () => {
  assert.equal(automaticThreadTitle(undefined, 'x'.repeat(80)).length, 80);
  assert.equal(automaticThreadTitle(undefined, 'x'.repeat(200)), 'x'.repeat(120) + '...');
  assert.equal(automaticThreadTitle(undefined, '\u{1F680}'.repeat(121)), '\u{1F680}'.repeat(120) + '...');
  assert.equal(automaticThreadTitle(undefined, ' \n '), undefined);
});

test('a generated title matching the placeholder is not replaced again', () => {
  const thread = { title: '新对话', messages: [{ role: 'user', content: '新对话' }] };
  ensureThreadTitle(thread);
  assert.equal(automaticThreadTitle(thread, '其他内容'), undefined);
});
