import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { MockAgent, setGlobalDispatcher } from 'undici';

// Env must be set BEFORE importing anything that reads it (config/env.ts).
process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
process.env.DISCORD_WEBHOOK_URL = 'https://discord.test/api/webhooks/1/abc';
process.env.DISCORD_MAX_TRIES = '2';
process.env.DISCORD_RETRY_MS = '0'; // keep the retry path fast in tests
process.env.CORS_ORIGINS = 'https://bannawat.site,http://localhost:5173';
process.env.LOG_LEVEL = 'fatal';

// Mock Discord. The reply status is dynamic so we can simulate failure.
let discordStatus = 204;
let discordCalls = 0;
const agent = new MockAgent();
agent.disableNetConnect();
setGlobalDispatcher(agent);
agent
  .get('https://discord.test')
  .intercept({ path: '/api/webhooks/1/abc', method: 'POST' })
  .reply(() => {
    discordCalls++;
    return { statusCode: discordStatus, data: '' };
  })
  .persist();

const { buildServer } = await import('../server.js');
const { eventLog } = await import('../store/eventLog.js');
type App = Awaited<ReturnType<typeof buildServer>>;

let app: App;

function sign(body: string): string {
  const h = crypto.createHmac('sha256', 'test-secret');
  h.update(body);
  return `sha256=${h.digest('hex')}`;
}

const pushBody = JSON.stringify({
  ref: 'refs/heads/main',
  compare: 'https://github.com/bannawat/reporadar/compare/a...b',
  repository: {
    full_name: 'bannawat/reporadar',
    html_url: 'https://github.com/bannawat/reporadar',
  },
  sender: { login: 'bannawat', html_url: 'https://github.com/bannawat' },
  commits: [{ id: 'abcdef1', message: 'feat: x', url: 'https://x/1' }],
});

function inject(headers: Record<string, string>, body = pushBody) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/github',
    headers: { 'content-type': 'application/json', ...headers },
    payload: body,
  });
}

before(async () => {
  app = await buildServer();
  await app.ready();
});

beforeEach(() => {
  eventLog.clear();
  discordStatus = 204;
  discordCalls = 0;
});

test('rejects invalid signature with 401', async () => {
  const res = await inject({
    'x-github-event': 'push',
    'x-github-delivery': 'd1',
    'x-hub-signature-256': 'sha256=deadbeef',
  });
  assert.equal(res.statusCode, 401);
});

test('acks ping with 200', async () => {
  const body = JSON.stringify({ zen: 'hi' });
  const res = await inject(
    {
      'x-github-event': 'ping',
      'x-github-delivery': 'ping-1',
      'x-hub-signature-256': sign(body),
    },
    body,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().pong, true);
});

test('valid push: 202, stored, and served by /logs', async () => {
  const res = await inject({
    'x-github-event': 'push',
    'x-github-delivery': 'push-1',
    'x-hub-signature-256': sign(pushBody),
  });
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().event, 'push');

  const logs = await app.inject({ method: 'GET', url: '/logs' });
  assert.equal(logs.statusCode, 200);
  const data = logs.json();
  assert.equal(data.count, 1);
  assert.equal(data.events[0].id, 'push-1');
  assert.equal(data.events[0].event, 'push');
});

test('duplicate delivery id is idempotent', async () => {
  const headers = {
    'x-github-event': 'push',
    'x-github-delivery': 'dup-1',
    'x-hub-signature-256': sign(pushBody),
  };
  const first = await inject(headers);
  assert.equal(first.statusCode, 202);
  const second = await inject(headers);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().duplicate, true);

  const logs = await app.inject({ method: 'GET', url: '/logs' });
  assert.equal(logs.json().count, 1); // not stored twice
});

test('discord non-2xx: returns 502, does NOT store or mark seen (GitHub can retry)', async () => {
  discordStatus = 500; // simulate Discord unreachable
  const headers = {
    'x-github-event': 'push',
    'x-github-delivery': 'retry-1',
    'x-hub-signature-256': sign(pushBody),
  };
  const failed = await inject(headers);
  assert.equal(failed.statusCode, 502);
  assert.equal(discordCalls, 2); // retried up to DISCORD_MAX_TRIES

  // Nothing stored, delivery not marked seen.
  const logs1 = await app.inject({ method: 'GET', url: '/logs' });
  assert.equal(logs1.json().count, 0);

  // GitHub redelivers the SAME id; Discord now healthy -> it succeeds and stores.
  discordStatus = 204;
  const ok = await inject(headers);
  assert.equal(ok.statusCode, 202);
  const logs2 = await app.inject({ method: 'GET', url: '/logs' });
  assert.equal(logs2.json().count, 1);
  assert.equal(logs2.json().events[0].id, 'retry-1');
});

test('discord 4xx (not 429) fails fast without retrying', async () => {
  discordStatus = 404; // deleted webhook — retrying can never help
  const res = await inject({
    'x-github-event': 'push',
    'x-github-delivery': 'gone-1',
    'x-hub-signature-256': sign(pushBody),
  });
  assert.equal(res.statusCode, 502);
  assert.equal(discordCalls, 1);
});

test('/logs respects limit and returns newest first', async () => {
  for (let i = 1; i <= 3; i++) {
    await inject({
      'x-github-event': 'push',
      'x-github-delivery': `n-${i}`,
      'x-hub-signature-256': sign(pushBody),
    });
  }
  const logs = await app.inject({ method: 'GET', url: '/logs?limit=2' });
  const data = logs.json();
  assert.equal(data.count, 2);
  assert.equal(data.events[0].id, 'n-3');
});

test('CORS: allowed origin is reflected on /logs', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/logs',
    headers: { origin: 'https://bannawat.site' },
  });
  assert.equal(res.headers['access-control-allow-origin'], 'https://bannawat.site');
});
