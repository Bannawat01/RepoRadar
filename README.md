# RepoRadar 🛰️

Automated DevOps & GitHub monitoring bot. Captures GitHub Webhooks (Push, PR, Issues),
validates & normalizes the payload via a **TypeScript (Fastify) API**, and delivers
**Rich Embed** messages to **Discord** in real time.

```
GitHub Webhook ──▶ API (validate + normalize + route + embed) ──▶ Discord (rich embed)
   push/PR/issue      HMAC verify, zod parse, retrying delivery      channel + embed
```

> The routing/embed layer originally ran in **n8n** (`n8n/RepoRadar.json`). It now lives in
> the API (`src/discord/`) so the pipeline has no third-party runtime dependency.
> The workflow JSON is kept for reference only.

## Repo layout

```
RepoRadar/
├── api/                      # TypeScript Fastify webhook receiver + validator
│   ├── src/
│   │   ├── server.ts         # Fastify bootstrap
│   │   ├── config/env.ts     # env loading + validation (zod)
│   │   ├── plugins/
│   │   │   └── verifySignature.ts   # GitHub HMAC-SHA256 verification
│   │   ├── routes/
│   │   │   └── webhook.ts     # POST /webhooks/github
│   │   ├── discord/
│   │   │   ├── embeds.ts      # normalized event -> Discord rich embed
│   │   │   └── deliver.ts     # POST to Discord webhook + retry/backoff
│   │   ├── schemas/github.ts # zod schemas: push / pull_request / issues
│   │   ├── transformers/
│   │   │   └── toNormalized.ts       # raw GitHub payload -> normalized event
│   │   └── types/index.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── .gitignore
├── n8n/
│   └── RepoRadar.json        # legacy workflow export (reference only, not required)
├── docs/
│   └── ARCHITECTURE.md       # full end-to-end wiring
├── .gitignore
└── README.md
```

## The two pieces

| Piece | Runs where | Responsibility |
|-------|-----------|----------------|
| **API** | Node (this repo, e.g. Render) | Verify GitHub signature, parse & validate payload, normalize, branch on `event` type, build the Discord embed, POST it to Discord with retries |
| **Discord** | Discord server | Renders the rich embed in the target channel |

## Quick start (API)

```bash
cd api
cp .env.example .env      # fill in secrets
npm install
npm run dev               # Fastify on http://localhost:3000
```

Expose it to GitHub during development (choose one):

```bash
npx localtunnel --port 3000
# or: ngrok http 3000  |  cloudflared tunnel --url http://localhost:3000
```

Point the GitHub webhook at `https://<public-url>/webhooks/github`.

Required env: `GITHUB_WEBHOOK_SECRET`, `DISCORD_WEBHOOK_URL` (see `api/.env.example`).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full end-to-end flow and env vars.
