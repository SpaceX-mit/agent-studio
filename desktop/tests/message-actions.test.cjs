const test = require('node:test');
const assert = require('node:assert/strict');
const { replyText, branchSnapshot, isFinalReply } = require('../src/messageActions.ts');

test('copy preserves markdown and code while omitting hidden reasoning', () => {
  assert.equal(replyText('<think>internal</think>\n**Answer**\n\n```js\nconst a = 1;\n```'), '**Answer**\n\n```js\nconst a = 1;\n```');
});

test('fork snapshot excludes later messages and never mutates source', () => {
  const source = { id: 'source', title: 'History', status: 'completed', pinned: true, archived: false, messages: [
    { id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply one' },
    { id: 'u2', role: 'user', content: 'later' }, { id: 'a2', role: 'assistant', content: 'reply two' }
  ] };
  const copy = branchSnapshot(source, 'a1', 'forked');
  assert.equal(copy.remoteId, 'forked');
  assert.equal(copy.messages.length, 2);
  assert.equal(source.messages.length, 4);
  assert.equal(copy.pinned, false);
  copy.messages[0].content = 'changed';
  assert.equal(source.messages[0].content, 'first');
});

test('intermediate commentary and user messages are not fork points', () => {
  const messages = [{ role: 'user' }, { role: 'assistant' }, { role: 'system', tool: {} }, { role: 'assistant' }];
  assert.equal(isFinalReply(messages, 0), false);
  assert.equal(isFinalReply(messages, 1), false);
  assert.equal(isFinalReply(messages, 3), true);
});
