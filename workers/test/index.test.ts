import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

const env = { INSTANCE_SECRET_KEY: 'instance-key', ADMIN_TOKEN: 'admin-token' } as any;

test('health endpoint is public', async () => {
  const response = await worker.fetch(new Request('https://x/healthz'), env, {} as ExecutionContext);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('configuration API requires the admin token', async () => {
  const response = await worker.fetch(new Request('https://x/api/hooks'), env, {} as ExecutionContext);
  assert.equal(response.status, 401);
});
test('Discord test API rejects non-Discord URLs', async () => {
  const response = await worker.fetch(new Request('https://x/api/test-discord', { method: 'POST', headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' }, body: JSON.stringify({ discord_url: 'https://example.com/webhook' }) }), env, {} as ExecutionContext);
  assert.equal(response.status, 400);
});