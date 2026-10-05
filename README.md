# RepoRadar

> A self-hosted GitHub  Discord notifier built with Cloudflare Workers and D1.

Paste a repository URL, choose a Discord webhook, and RepoRadar turns GitHub activity into useful Discord messages. Every deployment owns its data and secrets—there is no central service or n8n instance.

## What it does

| You do | RepoRadar does |
| --- | --- |
| Paste `https://github.com/owner/repository` | Extracts the owner and repository automatically |
| Add a Discord webhook | Tests it before a route can be created |
| Configure the generated URL in GitHub | Verifies GitHub signatures and queues deliveries |
| Push code or open a PR | Sends a Discord notification and retries failures |

## Deploy

### 1. Prerequisites

- Node.js 20+
- A Cloudflare account

```sh
cd workers
npm install
npx wrangler login
```

### 2. Create D1

```sh
npx wrangler d1 create reporadar
```

Copy the returned `database_id` into `workers/wrangler.jsonc`.

### 3. Create tables and secrets

```sh
npx wrangler d1 migrations apply reporadar --remote
npx wrangler secret put INSTANCE_SECRET_KEY
npx wrangler secret put ADMIN_TOKEN
```

Use unique, strong values. `INSTANCE_SECRET_KEY` must stay unchanged after hooks exist, because it encrypts their saved credentials. `ADMIN_TOKEN` unlocks the dashboard.

### 4. Publish

```sh
npx wrangler deploy
```

Open the Worker URL shown by Wrangler and sign in with `ADMIN_TOKEN`.

## Create your first webhook

1. In RepoRadar, enter a display name.
2. Paste a full GitHub repository URL in **GitHub Repository**—for example `https://github.com/Bannawat01/RepoRadar`. Leave **GitHub Owner** empty.
3. Paste a Discord webhook URL, then select **Test Discord webhook**. Confirm that Discord receives the test message.
4. Select **Create secure webhook** and copy the shown Payload URL and Secret. The secret is shown once.
5. In the GitHub repository, open **Settings  Webhooks  Add webhook** and paste both values.
   - Content type: `application/json`
   - Events: Pushes, Pull requests, Issues
6. Push a commit. The delivery appears in RepoRadar's Activity list and in Discord.

## Share with a team

The deployed Worker URL is already shareable. Send teammates the URL and `ADMIN_TOKEN` separately, ideally using a password manager.

> Everyone with `ADMIN_TOKEN` is an administrator: they can manage hooks and view deliveries. Do not commit it or post it in public chat.

If the token is exposed, replace it:

```sh
cd workers
npx wrangler secret put ADMIN_TOKEN
```

Refresh the dashboard and sign in with the new value. This small deployment intentionally has one shared admin token; add individual accounts only when access levels are needed.

## Local development

```sh
cd workers
cp .dev.vars.example .dev.vars
# Set local values in .dev.vars
npx wrangler d1 migrations apply reporadar --local
npm run dev
```

Never commit `.dev.vars`.

## How it works

GitHub requests are validated with HMAC-SHA256 before RepoRadar accepts them. Valid events are stored in D1, delivered to Discord, and retried up to five times for temporary failures. A five-minute cron job resumes pending deliveries.

Delivery is at-least-once: if Discord receives a message but the Worker stops before saving its success, one duplicate can occur on retry.

## Checks

```sh
cd workers
npm test
npm run build
```

`npm run build` performs a Wrangler dry-run; deploy explicitly with `npx wrangler deploy`.

## Security notes

- Discord URLs and GitHub webhook secrets are encrypted in D1.
- The dashboard token stays only in the current browser session.
- Hook lists never expose saved Discord URLs or GitHub secrets.
- Review Cloudflare's current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before production use.

MIT licensed.