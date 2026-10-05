export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  DISCORD_WEBHOOK_URL: string;
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function validSignature(body: ArrayBuffer, signature: string | null, secret: string) {
  if (!signature?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  const expected = `sha256=${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  return safeEqual(expected, signature);
}

function discordPayload(event: string, payload: any) {
  const repo = payload.repository?.full_name ?? 'unknown repository';
  const sender = payload.sender?.login ?? 'GitHub';
  let title = `${event} in ${repo}`;
  let url = payload.repository?.html_url;
  if (event === 'push') {
    title = `${payload.commits?.length ?? 0} commit(s) pushed to ${payload.ref?.replace('refs/heads/', '') ?? 'repository'}`;
    url = payload.compare ?? url;
  } else if (event === 'pull_request') {
    title = `PR #${payload.number ?? ''} ${payload.action ?? 'updated'}: ${payload.pull_request?.title ?? ''}`;
    url = payload.pull_request?.html_url ?? url;
  } else if (event === 'issues') {
    title = `Issue #${payload.issue?.number ?? ''} ${payload.action ?? 'updated'}: ${payload.issue?.title ?? ''}`;
    url = payload.issue?.html_url ?? url;
  }
  return { username: 'RepoRadar', embeds: [{ title: title.slice(0, 256), url, color: 5793266, author: { name: sender }, footer: { text: repo }, timestamp: new Date().toISOString() }] };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') return json({ status: 'ok' });
    if (request.method !== 'POST' || url.pathname !== '/webhooks/github') return json({ error: 'not found' }, 404);

    const body = await request.arrayBuffer();
    if (!await validSignature(body, request.headers.get('x-hub-signature-256'), env.GITHUB_WEBHOOK_SECRET)) {
      return json({ error: 'invalid signature' }, 401);
    }
    const event = request.headers.get('x-github-event');
    if (event === 'ping') return json({ ok: true, pong: true });
    if (!['push', 'pull_request', 'issues'].includes(event ?? '')) return json({ ok: true, ignored: event ?? 'unknown' }, 202);
    let payload: any;
    try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ error: 'invalid JSON' }, 400); }
    const discord = await fetch(env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(discordPayload(event!, payload)) });
    if (!discord.ok) return json({ error: 'discord delivery failed' }, 502);
    return json({ ok: true, event }, 202);
  },
} satisfies ExportedHandler<Env>;
