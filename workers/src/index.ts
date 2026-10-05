export interface Env {
  DB: D1Database;
  INSTANCE_SECRET_KEY: string;
  ADMIN_TOKEN: string;
}

type HookRow = { id: string; name: string; owner: string; repo: string; discord_url: string; github_secret: string; enabled: number; created_at: string; updated_at: string };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const now = () => new Date().toISOString();

function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let n = 0; for (let i = 0; i < a.length; i++) n |= a.charCodeAt(i) ^ b.charCodeAt(i); return n === 0; }
async function key(secret: string) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(value: string, secret: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(value))); return `${b64(iv)}.${b64(data)}`; }
async function open(value: string, secret: string) { const [iv, data] = value.split('.'); if (!iv || !data) throw new Error('bad ciphertext'); return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(secret), unb64(data))); }
async function validSignature(body: ArrayBuffer, header: string | null, secret: string) { if (!header?.startsWith('sha256=')) return false; const k = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const digest = new Uint8Array(await crypto.subtle.sign('HMAC', k, body)); return safeEqual(`sha256=${[...digest].map((x) => x.toString(16).padStart(2, '0')).join('')}`, header); }
function discordUrl(value: unknown): string | null { if (typeof value !== 'string') return null; try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'discord.com' && /^\/api\/webhooks\/[^/]+\/[^/]+/.test(u.pathname) ? u.toString() : null; } catch { return null; } }
function text(value: unknown, max = 120) { return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null; }
function repoPart(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : null; }
function publicHook(row: HookRow) { return { id: row.id, name: row.name, owner: row.owner, repo: row.repo, enabled: Boolean(row.enabled), created_at: row.created_at, updated_at: row.updated_at, endpoint: `/webhooks/${row.id}` }; }
function authorized(request: Request, env: Env) { return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${env.ADMIN_TOKEN}`); }
function payload(event: string, input: any) { const repo = input.repository?.full_name ?? 'unknown repository'; const title = event === 'push' ? `${input.commits?.length ?? 0} commit(s) pushed to ${String(input.ref ?? '').replace('refs/heads/', '')}` : event === 'pull_request' ? `PR #${input.number ?? ''} ${input.action ?? 'updated'}: ${input.pull_request?.title ?? ''}` : `Issue #${input.issue?.number ?? ''} ${input.action ?? 'updated'}: ${input.issue?.title ?? ''}`; const url = event === 'push' ? input.compare : event === 'pull_request' ? input.pull_request?.html_url : input.issue?.html_url; return { username: 'RepoRadar', embeds: [{ title: title.slice(0, 256), url, color: 5793266, author: { name: input.sender?.login ?? 'GitHub' }, footer: { text: repo }, timestamp: now() }] }; }
async function readJson(request: Request) { try { return await request.json() as Record<string, unknown>; } catch { return null; } }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname;
    if (request.method === 'GET' && path === '/healthz') return json({ status: 'ok' });
    if (path.startsWith('/api/')) {
      if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
      if (request.method === 'GET' && path === '/api/hooks') { const rows = await env.DB.prepare('SELECT * FROM hooks ORDER BY created_at DESC').all<HookRow>(); return json({ hooks: rows.results.map(publicHook) }); }
      if (request.method === 'POST' && path === '/api/hooks') {
        const input = await readJson(request); const name = text(input?.name); const owner = repoPart(input?.owner); const repo = repoPart(input?.repo); const discord = discordUrl(input?.discord_url);
        if (!name || !owner || !repo || !discord) return json({ error: 'invalid hook details' }, 400);
        const id = crypto.randomUUID(); const githubSecret = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/=/g, ''); const created = now();
        await env.DB.prepare('INSERT INTO hooks (id,name,owner,repo,discord_url,github_secret,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, name, owner, repo, await seal(discord, env.INSTANCE_SECRET_KEY), await seal(githubSecret, env.INSTANCE_SECRET_KEY), 1, created, created).run();
        return json({ hook: { id, name, owner, repo, enabled: true, created_at: created, updated_at: created, endpoint: `/webhooks/${id}` }, github_secret: githubSecret }, 201);
      }
      const match = path.match(/^\/api\/hooks\/([\w-]+)$/);
      if (match && request.method === 'PATCH') { const input = await readJson(request); const current = await env.DB.prepare('SELECT * FROM hooks WHERE id=?').bind(match[1]).first<HookRow>(); if (!current) return json({ error: 'not found' }, 404); const name = input?.name === undefined ? current.name : text(input.name); const owner = input?.owner === undefined ? current.owner : repoPart(input.owner); const repo = input?.repo === undefined ? current.repo : repoPart(input.repo); const discord = input?.discord_url === undefined ? await open(current.discord_url, env.INSTANCE_SECRET_KEY) : discordUrl(input.discord_url); const enabled = input?.enabled === undefined ? current.enabled : input.enabled === true ? 1 : input.enabled === false ? 0 : -1; if (!name || !owner || !repo || !discord || enabled < 0) return json({ error: 'invalid hook details' }, 400); const updated = now(); await env.DB.prepare('UPDATE hooks SET name=?,owner=?,repo=?,discord_url=?,enabled=?,updated_at=? WHERE id=?').bind(name, owner, repo, await seal(discord, env.INSTANCE_SECRET_KEY), enabled, updated, current.id).run(); return json({ hook: { ...publicHook(current), name, owner, repo, enabled: Boolean(enabled), updated_at: updated } }); }
      if (match && request.method === 'DELETE') { await env.DB.prepare('DELETE FROM hooks WHERE id=?').bind(match[1]).run(); return new Response(null, { status: 204 }); }
      return json({ error: 'not found' }, 404);
    }
    const webhook = path.match(/^\/webhooks\/([\w-]+)$/);
    if (!webhook || request.method !== 'POST') return json({ error: 'not found' }, 404);
    const hook = await env.DB.prepare('SELECT * FROM hooks WHERE id=?').bind(webhook[1]).first<HookRow>();
    if (!hook || !hook.enabled) return json({ error: 'not found' }, 404);
    const body = await request.arrayBuffer(); const secret = await open(hook.github_secret, env.INSTANCE_SECRET_KEY);
    if (!await validSignature(body, request.headers.get('x-hub-signature-256'), secret)) return json({ error: 'invalid signature' }, 401);
    const event = request.headers.get('x-github-event'); if (event === 'ping') return json({ ok: true, pong: true }); if (!['push', 'pull_request', 'issues'].includes(event ?? '')) return json({ ok: true, ignored: event ?? 'unknown' }, 202);
    let input: any; try { input = JSON.parse(decoder.decode(body)); } catch { return json({ error: 'invalid JSON' }, 400); }
    if (input.repository?.owner?.login !== hook.owner || input.repository?.name !== hook.repo) return json({ error: 'repository does not match hook' }, 403);
    const discord = await fetch(await open(hook.discord_url, env.INSTANCE_SECRET_KEY), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(event!, input)) });
    return discord.ok ? json({ ok: true, event }, 202) : json({ error: 'discord delivery failed' }, 502);
  },
} satisfies ExportedHandler<Env>;