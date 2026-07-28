# Deploy RepoRadar API to Render

## Prerequisites
- Push this repo to GitHub (the `.env` file is gitignored — secrets won't leak).
- Have your 2 secret values ready: `GITHUB_WEBHOOK_SECRET`, `DISCORD_WEBHOOK_URL`.

## 1. Create the service (Blueprint)
1. Render Dashboard → **New → Blueprint**.
2. Connect your GitHub account and pick the **RepoRadar** repo.
3. Render reads `render.yaml` and proposes the `reporadar-api` web service. Click **Apply**.

Key settings (already in `render.yaml`):
- Root directory: `api`
- Build: `npm install --include=dev && npm run build`  (dev deps needed for the TypeScript compile)
- Start: `npm start`  (runs `node dist/server.js`)
- Health check: `/healthz`

## 2. Set the secrets
In the service → **Environment** tab, fill the `sync:false` vars:

| Key | Value |
|-----|-------|
| `GITHUB_WEBHOOK_SECRET` | same value you put in the GitHub webhook's Secret field |
| `DISCORD_WEBHOOK_URL` | Discord channel webhook URL (Server Settings → Integrations → Webhooks) |

Optional tuning: `DISCORD_MAX_TRIES` (default `5`), `DISCORD_RETRY_MS` (default `3000`).

`CORS_ORIGINS` (= `https://bannawat.site`), `HOST`, and `NODE_VERSION` are already set by the blueprint.
Do **not** set `PORT` — Render injects it automatically and the app reads it.

## 3. Deploy & grab the URL
After the first deploy you get a URL like `https://reporadar-api.onrender.com`.
Test it: `https://reporadar-api.onrender.com/healthz` → `{"status":"ok"}`.

Use this as the GitHub webhook **Payload URL**:
`https://reporadar-api.onrender.com/webhooks/github`

## 4. (Optional) Custom subdomain api.bannawat.site
1. Render service → **Settings → Custom Domains → Add** `api.bannawat.site`.
2. Render shows a CNAME target (e.g. `reporadar-api.onrender.com`).
3. In your DNS (Netlify DNS, since bannawat.site is on Netlify): add a **CNAME** record
   `api` → that target. Wait for it to verify (SSL is issued automatically).
4. Payload URL becomes `https://api.bannawat.site/webhooks/github`.

## Note on the free plan
Render's free web service **sleeps after ~15 min idle** and cold-starts (~50s) on the next
request. GitHub's webhook timeout is ~10s, so the first delivery after a sleep may fail — but
GitHub retries, and the API's idempotency layer prevents duplicates. To avoid cold starts,
either upgrade the plan or ping `/healthz` every ~10 min (e.g. a scheduled task / uptime monitor).
