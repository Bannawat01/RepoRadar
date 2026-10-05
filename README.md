# RepoRadar

A self-hosted GitHub-to-Discord notifier for Cloudflare Workers + D1. Each deployment owns its webhook mappings, secrets, and admin token; no n8n or central service is required.

## Deploy

Prerequisites: Node 20+, a Cloudflare account, and Wrangler login.

```sh
cd workers
npm install
npx wrangler login
npx wrangler d1 create reporadar
```

Copy the returned `database_id` into `workers/wrangler.jsonc`, then create the database schema and deployment secrets:

```sh
npx wrangler d1 migrations apply reporadar --remote
npx wrangler secret put INSTANCE_SECRET_KEY
npx wrangler secret put ADMIN_TOKEN
npm run build
npx wrangler deploy
```

Generate both values with a password manager or `openssl rand -base64 32`. `INSTANCE_SECRET_KEY` must remain stable: changing it makes previously stored encrypted hook credentials unreadable. Do not commit `.dev.vars`.

Open the Worker URL, unlock it with `ADMIN_TOKEN`, and create a webhook. Copy its displayed Payload URL and one-time GitHub secret into **GitHub  Settings  Webhooks  Add webhook**. Use `application/json`, then select Pushes, Pull requests, and Issues. Create the Discord webhook in Discord server settings and paste it only into the form.

For local development:

```sh
cp .dev.vars.example .dev.vars
# set real local values and use a local D1 database
npx wrangler d1 migrations apply reporadar --local
npm run dev
```

## How it works

`POST /webhooks/:id` validates GitHub's HMAC-SHA256 over the raw request body and checks the configured owner/repository. It writes the delivery to D1 before returning `202`. A Worker continuation and a five-minute cron process pending jobs. Network errors, Discord 429 (honouring `retry_after`), and 5xx responses retry up to five times; non-429 4xx becomes failed. Delivery IDs are unique per hook and a conditional D1 update claims a job, preventing concurrent sends. Failed rows can be retried from the UI.

This is at-least-once delivery: if Discord accepts a request but the Worker stops before recording `sent`, a retry can produce a duplicate message. GitHub is not relied on to redeliver failed downstream work.

The UI keeps the admin token only in memory; locking or refreshing removes it. List APIs never return stored Discord URLs or GitHub secrets. Secrets are AES-GCM encrypted in D1 with `INSTANCE_SECRET_KEY`.

## Free-tier notes

Cloudflare's limits and pricing change. As of October 2026, Workers Free allows 100,000 requests/day, 10 ms CPU/request, 50 subrequests/request, and five cron triggers/account. D1 Free includes 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage; requests can fail until the daily reset if limits are reached. This project offers no uptime guarantee. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Checks

```sh
cd workers
npm test
npm run build
```

`npm run build` is a non-deploying Wrangler dry run. Deployment is intentionally left to the instance owner.

MIT licensed. Contributions welcome.
