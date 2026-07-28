# RepoRadar — Architecture & End-to-End Wiring

## Data flow

```
┌──────────┐   1. webhook POST   ┌─────────────────────┐   3. embed POST   ┌─────────┐
│  GitHub  │ ──────────────────▶ │   RepoRadar API     │ ────────────────▶ │ Discord │
│  events  │   X-Hub-Signature   │ (Fastify / TS)      │  Rich Embed JSON  │ channel │
└──────────┘                     └─────────────────────┘  + retry/backoff  └─────────┘
                                   │
                                   │ 2. verify HMAC + zod-validate + normalize + build embed
                                   ▼
                              clean event object
```

> **History:** steps 2b–3 (route by event, build embed, POST to Discord) originally ran in an
> n8n Cloud workflow (`n8n/RepoRadar.json`). That logic was ported into the API
> (`src/discord/embeds.ts` + `src/discord/deliver.ts`) so the pipeline needs no external
> automation runtime. Behavior — colors, fields, retry tiers — is unchanged.

### 1. GitHub → API
GitHub sends a `POST` to `/webhooks/github` on every configured event. Key headers:

- `X-GitHub-Event` — event name (`push`, `pull_request`, `issues`, `ping`).
- `X-Hub-Signature-256` — `sha256=<hmac>` of the raw body, keyed with the webhook secret.
- `X-GitHub-Delivery` — unique delivery UUID (useful for idempotency/logging).

### 2. API validation & normalization
The API pipeline, in order:

1. **Verify signature** — recompute `HMAC-SHA256(rawBody, GITHUB_WEBHOOK_SECRET)` and compare in constant time. Reject with `401` on mismatch.
2. **Validate payload** — parse against a zod schema per event type. Reject malformed payloads with `400`.
3. **Normalize** — collapse GitHub's large payload into a small, stable shape (`NormalizedEvent`) so the embed logic never depends on GitHub's raw structure.
4. **Present & deliver** — `buildDiscordPayload()` turns the normalized event into an embed; `deliverToDiscord()` posts it. Reply `202 Accepted` on success, `502` if Discord is unreachable after retries.

> Why keep the normalize step as its own layer? It isolates GitHub's schema churn in one typed place, makes the embed builders trivial, and lets both halves be unit-tested independently.

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

### 3. API → Discord
`src/discord/embeds.ts` branches on `event` (`push` / `pull_request` / `issues`) — the former
n8n **Switch** node — and each builder produces the embed object (color, emoji, title, fields).
`src/discord/deliver.ts` then `POST`s it to `DISCORD_WEBHOOK_URL`.

Discord embed contract (what the API sends):

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
| `DISCORD_WEBHOOK_URL` | API | Discord channel webhook the embed is posted to |
| `DISCORD_MAX_TRIES` | API | Delivery attempts before giving up (default `5`) |
| `DISCORD_RETRY_MS` | API | Floor backoff between attempts in ms (default `3000`) |

Both secrets are held by the API only; nothing else in the pipeline holds credentials.

## Setup order

1. **Discord** — Server Settings → Integrations → Webhooks → *New Webhook* → copy URL.
2. **API** — put the Discord URL + a GitHub secret into `.env`, run `npm run dev`, expose via a tunnel.
3. **GitHub** — Repo → Settings → Webhooks → *Add webhook*: Payload URL = `https://<tunnel>/webhooks/github`, Content type = `application/json`, Secret = `GITHUB_WEBHOOK_SECRET`, choose events (Pushes, Pull requests, Issues).
4. **Test** — GitHub sends a `ping`; the API returns `202`; open a test issue and confirm the embed lands in Discord.

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
"seen" *after* a successful Discord delivery, so a downstream failure still lets GitHub retry.

| Variable | Used by | Purpose |
|----------|---------|---------|
| `CORS_ORIGINS` | API | Comma-separated allowed frontend origins for `GET /logs` |

## Tests

`npm test` runs the `node:test` suite via `tsx`:
- `transformers/toNormalized.test.ts` — every event edge case (force-push, branch create/delete, tags, PR merged vs closed vs reopened, issue labeled).
- `store/eventLog.test.ts` — ring-buffer eviction + delivery-id dedup.
- `routes/routes.test.ts` — signature rejection, ping, full push→store→`/logs`, idempotent duplicate, retry + fail-fast delivery paths, CORS reflection (Discord mocked via undici `MockAgent`).
- `discord/embeds.test.ts` — per-event embed fields, colors, and title clipping.

## Discord delivery resilience

`deliverToDiscord()` is hardened in two tiers:

1. **Retry** — `DISCORD_MAX_TRIES` attempts (default 5) with a `DISCORD_RETRY_MS`
   floor backoff (default 3s), waiting longer when Discord's `retry_after`
   (body or `Retry-After` header) asks for it. Covers `429` rate-limits, `5xx`,
   and network blips. Non-429 `4xx` (e.g. a deleted webhook) fails fast — retrying
   can never help.
2. **Diagnostic + 502** — on exhaustion it throws `DiscordDeliveryError` carrying
   `{ status, retryAfter, message, at }`. The route logs that and replies **502**
   without marking the delivery seen, so GitHub redelivers instead of the event
   being silently dropped.

Response codes: `401` (bad signature), `400` (invalid payload), `202` (delivered, or
event type ignored), `200` (ping / duplicate), `502` (Discord unreachable).
