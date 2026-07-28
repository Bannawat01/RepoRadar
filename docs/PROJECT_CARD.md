# RepoRadar — Real-Time DevOps Monitoring Bot

**Backend & Automation · TypeScript · Fastify · Zod · Discord**

RepoRadar turns raw GitHub activity into instant, color-coded Discord notifications.
A low-latency Fastify API verifies each webhook's HMAC signature, validates it with Zod,
normalizes GitHub's sprawling payloads into a clean, stable event, and renders it as a
rich embed (merged vs. closed PRs, force-pushes, issue updates).

I built it to monitor my own live projects unattended — tracking validation fixes on my
npm utility `ai-fetch-healer` and backend PRs on my full-stack app **LaekHub**.

What makes it production-grade: an idempotency layer that dedupes GitHub's redeliveries,
and two-tier Discord resilience (retry with backoff for 429/5xx, fail-fast on permanent
4xx, then a 502 fallback that lets GitHub redeliver). The result is an at-least-once
delivery guarantee — no duplicates, no silently dropped events. Fully unit- and
integration-tested.

The routing and embed layer first shipped as an n8n workflow, then was ported into the
API as typed, tested modules — same behavior node-for-node, one less hosted dependency
on the critical path.
