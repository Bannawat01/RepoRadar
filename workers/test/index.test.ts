import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { githubRepo } from '../src/index.js';

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
test('stored webhook test requires the admin token', async () => {
  const response = await worker.fetch(new Request('https://x/api/hooks/hook-1/test', { method: 'POST' }), env, {} as ExecutionContext);
  assert.equal(response.status, 401);
});

test('GitHub repository URL supplies owner and repo', () => {
  assert.deepEqual(githubRepo('', 'https://github.com/Bannawat01/RepoRadar'), { owner: 'Bannawat01', repo: 'RepoRadar' });
  assert.equal(githubRepo('', 'https://example.com/Bannawat01/RepoRadar'), null);
});

test('creates a hook from a GitHub repository URL', async () => {
  const bindings: unknown[][] = [];
  const createEnv = { ...env, DB: { prepare: () => ({ bind: (...values: unknown[]) => { bindings.push(values); return { run: async () => ({}) }; } }) } } as any;
  const response = await worker.fetch(new Request('https://x/api/hooks', { method: 'POST', headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'RepoRadar', owner: '', repo: 'https://github.com/Bannawat01/RepoRadar', discord_url: 'https://discord.com/api/webhooks/123/token' }) }), createEnv, {} as ExecutionContext);
  assert.equal(response.status, 201);
  assert.equal(bindings[0][2], 'Bannawat01');
  assert.equal(bindings[0][3], 'RepoRadar');
});
test('resets a hook secret', async () => {
  const hook = { id: 'hook-1', name: 'Route', owner: 'Bannawat01', repo: 'RepoRadar', enabled: 1 };
  const updates: unknown[][] = [];
  const resetEnv = { ...env, DB: { prepare: (sql: string) => ({ bind: (...values: unknown[]) => sql.startsWith('SELECT') ? { first: async () => hook } : (updates.push(values), { run: async () => ({}) }) }) } } as any;
  const response = await worker.fetch(new Request('https://x/api/hooks/hook-1/secret', { method: 'POST', headers: { authorization: 'Bearer admin-token' } }), resetEnv, {} as ExecutionContext);
  assert.equal(response.status, 200);
  assert.match((await response.json() as any).github_secret, /^[A-Za-z0-9+/]+$/);
  assert.equal(updates[0][2], 'hook-1');
});