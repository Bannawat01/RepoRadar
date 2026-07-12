# RepoRadar — Real-Time DevOps Monitoring Bot

**Backend & Automation · TypeScript · Fastify · n8n · Discord**

RepoRadar turns raw GitHub activity into instant, colour-coded Discord notifications.
A low-latency Fastify API verifies each webhook's HMAC signature, validates it with Zod,
and normalizes GitHub's sprawling payloads into a clean, stable event — which n8n then
routes into rich embeds (merged vs. closed PRs, force-pushes, issue updates).

I built it to monitor my own live projects unattended — tracking validation fixes on my
npm utility `ai-fetch-healer` and backend PRs on my full-stack app **LaekHub**.

What makes it production-grade: an idempotency layer that dedupes GitHub's redeliveries,
and two-tier Discord resilience (retry with backoff for 429/5xx, then a 502 fallback that
lets GitHub redeliver). The result is an at-least-once delivery guarantee — no duplicates,
no silently dropped events. Fully unit- and integration-tested.
