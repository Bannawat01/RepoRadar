# RepoRadar — Real-Time DevOps Monitoring Bot

**Role:** Backend & Automation Developer · **Stack:** TypeScript, Fastify, n8n, Discord, Zod

## Overview

RepoRadar is a webhook-driven automation service that turns raw GitHub activity into
clean, real-time Discord notifications. It captures Push, Pull Request, and Issue events,
validates and normalizes them through a low-latency TypeScript API, then routes them
through n8n to deliver colour-coded rich embeds to Discord.

I built it to monitor my own live projects without babysitting them — for example,
tracking validation and bug-fix updates on my open-source npm utility
[`ai-fetch-healer`](https://www.npmjs.com/package/ai-fetch-healer), and watching
backend pull requests on my full-stack TypeScript project **LaekHub**. Instead of
polling dashboards, I get an instant, readable feed of exactly what changed and who
changed it.

## The problem

GitHub's native notifications are noisy, hard to theme, and give no room for custom
routing or business logic. I wanted a single, extensible pipeline that could: verify
that events are authentic, reshape GitHub's sprawling payloads into something stable,
and deliver polished notifications reliably — without dropping events when a downstream
service hiccups.

## Architecture

```
GitHub Webhook ──▶ Fastify API ──▶ n8n Router ──▶ Discord
  push/PR/issue     verify · validate    branch · build      rich embed
                    normalize · forward   embed · retry
```

The system is deliberately split into three focused layers, each doing one job well:

- **Fastify API (TypeScript)** — the security and normalization gateway.
- **n8n workflow** — the routing and presentation layer.
- **Discord** — the delivery surface.

## Technical highlights

**Low-latency Fastify gateway.** I chose Fastify for its schema-first design and
minimal per-request overhead. The API verifies each webhook's `HMAC-SHA256` signature
in constant time against the *raw* request body, validates the payload with Zod schemas
per event type, and collapses GitHub's large payloads into a small, stable
`NormalizedEvent` shape. Keeping GitHub's schema churn isolated in one typed, unit-tested
transform means the rest of the pipeline never depends on GitHub's raw structure.

**Idempotency layer.** GitHub redelivers webhooks on any delivery hiccup, which naively
causes duplicate notifications. RepoRadar tracks each `X-GitHub-Delivery` ID and returns
early on repeats. Crucially, an event is only marked "seen" *after* the downstream
delivery succeeds — so a transient failure never both drops the event *and* blocks a retry.

**Two-tier Discord resilience.** Discord webhooks rate-limit with `429 retry_after` and
occasionally return `5xx`. The delivery node handles this in two tiers: native retry with
exponential-style backoff (5 attempts) absorbs transient rate-limits and blips
automatically; if all retries are exhausted, the event routes to a dedicated error branch
that logs a structured diagnostic and returns a `502`. That `502` propagates back through
the API, which declines to mark the event seen — so GitHub redelivers once the downstream
recovers. The result is an at-least-once delivery guarantee with no silent data loss.

**Edge-case-aware formatting.** The notification logic distinguishes cases most bots
ignore: a *merged* PR (green) versus one *closed without merging* (red), force-pushes and
branch create/delete events, tags versus branches, and issue label changes. PR embeds
surface `+additions / -deletions` and changed-file counts at a glance.

## Engineering practices

The API ships with a `node:test` suite covering the normalization edge cases, the
idempotency/ring-buffer store, and full route integration — including the failure path,
where a mocked `502` from n8n is asserted to trigger a redelivery rather than a dropped
event. Configuration is validated at boot with Zod, so the service fails fast with a clear
message rather than crashing mid-request. Secrets are scoped to where they're used, and a
CORS-guarded `GET /logs` endpoint exposes a live activity feed to my portfolio frontend.

## Outcome

A production-minded, fault-tolerant automation pipeline that demonstrates secure webhook
handling, thoughtful data modelling, and real-world resilience engineering — the kind of
backend plumbing that has to *just work* unattended.
