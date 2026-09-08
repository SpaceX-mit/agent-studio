const test = require('node:test');
const assert = require('node:assert/strict');
const { listMiniMaxModels } = require('../electron/minimax-models.cjs');

test('forwards bearer key to the China endpoint and preserves API model IDs', async () => {
  const result = await listMiniMaxModels({ apiKey: 'test-only', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.minimaxi.com/v1/models');
    assert.equal(options.headers.authorization, 'Bearer test-only');
    assert.ok(options.signal);
    return Response.json({ data: [{ id: 'MiniMax-M3' }, { id: 'MiniMax-M2.1' }, { id: 'MiniMax-M3' }, { name: 'Display name only' }, null] });
  } });
  assert.deepEqual(result, { ok: true, models: ['MiniMax-M3', 'MiniMax-M2.1'] });
});

test('missing key performs no network request or hard-coded fallback', async () => {
  const result = await listMiniMaxModels({ fetchImpl: () => assert.fail('must not fetch') });
  assert.equal(result.ok, false);
  assert.deepEqual(result.models, []);
});

for (const status of [401, 403, 404, 429, 500]) {
  test(`HTTP ${status} is visible and never returns default models`, async () => {
    const result = await listMiniMaxModels({ apiKey: 'test-only', fetchImpl: async () => new Response('private upstream detail', { status }) });
    assert.equal(result.ok, false);
    assert.deepEqual(result.models, []);
    assert.match(result.error, new RegExp(String(status)));
    assert.doesNotMatch(result.error, /private upstream detail/);
  });
}

for (const body of [{ data: [] }, { data: {} }, { error: { message: 'error' } }, { base_resp: { status_code: 1004 }, data: ['Unavailable'] }]) {
  test(`rejects empty or invalid API response: ${JSON.stringify(body)}`, async () => {
    const result = await listMiniMaxModels({ apiKey: 'test-only', fetchImpl: async () => Response.json(body) });
    assert.equal(result.ok, false);
    assert.deepEqual(result.models, []);
  });
}

test('timeout gives a retry message', async () => {
  const result = await listMiniMaxModels({ apiKey: 'test-only', fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
  assert.match(result.error, /超时/);
});
