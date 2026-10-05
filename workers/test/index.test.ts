import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

const env = { GITHUB_WEBHOOK_SECRET: 'test-secret', DISCORD_WEBHOOK_URL: 'https://discord.test/webhook' };
const body = JSON.stringify({ repository: { full_name: 'o/r', html_url: 'https://github.com/o/r' }, sender: { login: 'octo' }, ref: 'refs/heads/main', commits: [] });

async function signature(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `sha256=${[...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

test('health and signed push delivery', async () => {
  assert.equal((await worker.fetch(new Request('https://x/healthz'), env, {} as ExecutionContext)).status, 200);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const response = await worker.fetch(new Request('https://x/webhooks/github', { method: 'POST', headers: { 'x-github-event': 'push', 'x-hub-signature-256': await signature(body) }, body }), env, {} as ExecutionContext);
  globalThis.fetch = original;
  assert.equal(response.status, 202);
});

test('rejects an invalid signature', async () => {
  const response = await worker.fetch(new Request('https://x/webhooks/github', { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=nope' }, body }), env, {} as ExecutionContext);
  assert.equal(response.status, 401);
});
