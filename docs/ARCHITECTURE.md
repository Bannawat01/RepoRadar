# RepoRadar — Architecture & End-to-End Wiring

## Data flow

```
┌──────────┐   1. webhook POST   ┌─────────────────────┐   3. forward   ┌───────────┐   4. embed POST   ┌─────────┐
│  GitHub  │ ──────────────────▶ │   RepoRadar API     │ ─────────────▶ │    n8n    │ ────────────────▶ │ Discord │
│  events  │   X-Hub-Signature   │ (Fastify / TS)      │  normalized    │ (hosted)  │   Rich Embed JSON │ channel │
└──────────┘                     └─────────────────────┘   JSON         └───────────┘                   └─────────┘
                                   │
                                   │ 2. verify HMAC + zod-validate + normalize
                                   ▼
                              clean event object
```

### 1. GitHub → API
GitHub sends a `POST` to `/webhooks/github` on every configured event. Key headers:

- `X-GitHub-Event` — event name (`push`, `pull_request`, `issues`, `ping`).
- `X-Hub-Signature-256` — `sha256=<hmac>` of the raw body, keyed with the webhook secret.
- `X-GitHub-Delivery` — unique delivery UUID (useful for idempotency/logging).

### 2. API validation & normalization
The API does four things and nothing else — keep it thin:

1. **Verify signature** — recompute `HMAC-SHA256(rawBody, GITHUB_WEBHOOK_SECRET)` and compare in constant time. Reject with `401` on mismatch.
2. **Validate payload** — parse against a zod schema per event type. Reject malformed payloads with `400`.
3. **Normalize** — collapse GitHub's large payload into a small, stable shape (`NormalizedEvent`) so n8n and Discord logic never depend on GitHub's raw structure.
4. **Forward** — `POST` the normalized event to the n8n webhook URL. Return `202 Accepted` to GitHub immediately (don't block on downstream).

> Why normalize in the API and not in n8n? It keeps GitHub's schema churn in one typed place, makes n8n branching trivial, and lets you unit-test the transform.

### Normalized event shape

```jsonc
{
  "event": "push" | "pull_request" | "issues",
  "action": "opened" | "closed" | "reopened" | null,   // null for push
  "repo": { "name": "owner/repo", "url": "https://github.com/owner/repo" },
  "actor": { "login": "octocat", "url": "https://github.com/octocat", "avatar": "https://..." },
  "title": "Human-readable summary line",
  "body": "Optional description / commit list",
  "url": "https://github.com/... (deep link to the PR/issue/compare)",
  "meta": { /* event-specific extras: branch, commit count, PR number, labels... */ }
}
```

### 3. API → n8n
n8n exposes a **Webhook** trigger node with its own URL, e.g.
`https://<your-instance>.app.n8n.cloud/webhook/reporadar`.
The API forwards the normalized JSON there. Protect it with a shared secret header
(`X-RepoRadar-Token`) that n8n checks in an `IF` node before proceeding.

### 4. n8n → Discord
Inside n8n:

1. **Webhook** node receives the normalized event.
2. **Switch** node branches on `{{$json.event}}` → `push` / `pull_request` / `issues`.
3. A **Set/Function** node per branch builds the Discord embed object (color, title, fields).
4. **HTTP Request** node `POST`s the embed to the Discord webhook URL.

Discord embed contract (what n8n sends):

```jsonc
{
  "embeds": [{
    "title": "🔀 PR #42 opened: Add rate limiting",
    "url": "https://github.com/owner/repo/pull/42",
    "color": 5814783,
    "author": { "name": "octocat", "icon_url": "https://...", "url": "https://github.com/octocat" },
    "fields": [
      { "name": "Repository", "value": "owner/repo", "inline": true },
      { "name": "Branch", "value": "feature/rate-limit", "inline": true }
    ],
    "timestamp": "2026-07-12T12:00:00.000Z"
  }]
}
```

Suggested colors: push `#2ECC71` (3066993), PR `#5865F2` (5793266), issue `#E67E22` (15105570).

## Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `PORT` | API | Port Fastify listens on (default `3000`) |
| `HOST` | API | Bind address (default `0.0.0.0`) |
| `LOG_LEVEL` | API | Pino log level (`info`, `debug`, ...) |
| `GITHUB_WEBHOOK_SECRET` | API | Secret configured on the GitHub webhook; used for HMAC verification |
| `N8N_WEBHOOK_URL` | API | n8n Webhook trigger URL the API forwards to |
| `N8N_FORWARD_TOKEN` | API + n8n | Shared secret sent as `X-RepoRadar-Token`; n8n verifies it |
| `DISCORD_WEBHOOK_URL` | n8n | Discord channel webhook (lives in n8n, **not** the API) |

Secrets live only where they're used: GitHub secret + n8n URL in the API; Discord URL in n8n. The API never sees Discord.

## Setup order

1. **Discord** — Server Settings → Integrations → Webhooks → *New Webhook* → copy URL. Store it in n8n.
2. **n8n** — Import `n8n/reporadar-workflow.json`, set the Discord URL + `N8N_FORWARD_TOKEN`, activate, copy the Webhook trigger URL.
3. **API** — put the n8n URL + token + a GitHub secret into `.env`, run `npm run dev`, expose via a tunnel.
4. **GitHub** — Repo → Settings → Webhooks → *Add webhook*: Payload URL = `https://<tunnel>/webhooks/github`, Content type = `application/json`, Secret = `GITHUB_WEBHOOK_SECRET`, choose events (Pushes, Pull requests, Issues).
5. **Test** — GitHub sends a `ping`; the API returns `202`; open a test issue and confirm the embed lands in Discord.

## Read API (frontend Live Activity Feed)

Besides ingesting webhooks, the API exposes a small read surface for the deployed
portfolio frontend (`bannawat.site` → `api.bannawat.site`).

- `GET /logs?limit=5` — most recent normalized events, newest first:
  `{ "count": n, "events": [ { ...NormalizedEvent, "id", "receivedAt" } ] }`.
  `limit` defaults to 5, clamped to 1..50.
- `GET /healthz` — `{ "status": "ok" }`.

Events are held in a process-local ring buffer (`src/store/eventLog.ts`, last 50).
It's swappable for Redis/Postgres later without touching the routes.

**CORS** is handled by `@fastify/cors`, restricted to the origins in `CORS_ORIGINS`
(comma-separated). The webhook route is server-to-server (GitHub) and unaffected.

**Idempotency**: GitHub retries deliveries. The API tracks recent `X-GitHub-Delivery`
IDs and returns `200 { duplicate: true }` for repeats — but only marks an event
"seen" *after* a successful n8n forward, so a downstream failure still lets GitHub retry.

| Variable | Used by | Purpose |
|----------|---------|---------|
| `CORS_ORIGINS` | API | Comma-separated allowed frontend origins for `GET /logs` |

## Tests

`npm test` runs the `node:test` suite via `tsx`:
- `transformers/toNormalized.test.ts` — every event edge case (force-push, branch create/delete, tags, PR merged vs closed vs reopened, issue labeled).
- `store/eventLog.test.ts` — ring-buffer eviction + delivery-id dedup.
- `routes/routes.test.ts` — signature rejection, ping, full push→store→`/logs`, idempotent duplicate, CORS reflection (n8n mocked via undici `MockAgent`).

## Discord delivery resilience (n8n)

The `Send to Discord` HTTP node is hardened in two tiers:

1. **Native retry** — `retryOnFail: 5 tries, 3s backoff`. Discord webhooks return
   `429` with a `retry_after` (usually < 2s) plus `5xx`/network blips on bad days;
   the backoff window absorbs these automatically.
2. **Error output** — `onError: continueErrorOutput`. If all retries are exhausted,
   the item routes to `Handle Discord Failure`, which logs a diagnostic
   (`status`, `retry_after`, message) to the n8n execution log and replies **502**
   via `Respond 502`. The failure is surfaced upstream instead of silently dropped.

Every execution path terminates at exactly one Respond node: `401` (bad token),
`200` (success or ignored event), or `502` (Discord unreachable) — required because
the Webhook trigger uses `responseMode: responseNode`.

> Optional API-side follow-up: `forwardToN8n` currently doesn't inspect n8n's status
> code. To let GitHub redeliver on a `502`, add a `res.statusCode >= 400` check in
> `webhook.ts` and throw so the existing `502` + "don't mark seen" path triggers.
