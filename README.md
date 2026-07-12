# RepoRadar 🛰️

Automated DevOps & GitHub monitoring bot. Captures GitHub Webhooks (Push, PR, Issues),
validates & normalizes the payload via a **TypeScript (Fastify) API**, routes the data through
**n8n**, and delivers **Rich Embed** messages to **Discord** in real time.

```
GitHub Webhook ──▶ API (validate + normalize) ──▶ n8n (route) ──▶ Discord (rich embed)
   push/PR/issue      HMAC verify, zod parse         switch on event      channel + embed
```

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
│   │   ├── schemas/github.ts # zod schemas: push / pull_request / issues
│   │   ├── transformers/
│   │   │   └── toNormalized.ts       # raw GitHub payload -> normalized event
│   │   └── types/index.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── .gitignore
├── n8n/
│   └── reporadar-workflow.json   # importable workflow stub
├── docs/
│   └── ARCHITECTURE.md       # full end-to-end wiring
├── .gitignore
└── README.md
```

## The three pieces

| Piece | Runs where | Responsibility |
|-------|-----------|----------------|
| **API** | Local Node (this repo) | Verify GitHub signature, parse & validate payload, emit a clean normalized JSON event, forward to n8n webhook |
| **n8n** | Hosted (n8n Cloud / self-host) | Receive normalized event, branch on `event` type, build the Discord embed, POST to Discord |
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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full end-to-end flow, env vars, and n8n setup.
