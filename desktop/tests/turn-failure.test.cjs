const test = require('node:test');
const assert = require('node:assert/strict');
const { failureMessage, recordTurnFailure } = require('../src/turnFailure.ts');

test('missing credentials explain how to launch without exposing a key', () => {
  assert.match(failureMessage({ message: 'Missing environment variable: MINIMAX_API_KEY' }), /start-desktop.ps1/);
});

test('an error followed by turn completion leaves one persistent error', () => {
  const thread = { status: 'running', messages: [{ id: 'user', role: 'user', content: 'hello' }] };
  recordTurnFailure(thread, 'turn-1', { message: 'Missing environment variable: MINIMAX_API_KEY' });
  recordTurnFailure(thread, 'turn-1', { message: 'Missing environment variable: MINIMAX_API_KEY' });
  assert.equal(thread.status, 'failed');
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[1].role, 'system');
  assert.equal(thread.messages[0].content, 'hello');
});

test('errors on separate turns remain separate and actionable', () => {
  const thread = { status: 'running', messages: [] };
  recordTurnFailure(thread, 'one', { message: 'invalid_prompt' });
  recordTurnFailure(thread, 'two', { message: 'Network disconnected' });
  assert.equal(thread.messages.length, 2);
  assert.match(thread.messages[0].content, /invalid_prompt/);
  assert.match(thread.messages[1].content, /Network disconnected/);
});
