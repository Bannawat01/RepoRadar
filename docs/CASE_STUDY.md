# RepoRadar — Real-Time DevOps Monitoring Bot

**Role:** Backend & Automation Developer · **Stack:** TypeScript, Fastify, Zod, Discord (originally n8n)

## Overview

RepoRadar is a webhook-driven automation service that turns raw GitHub activity into
clean, real-time Discord notifications. It captures Push, Pull Request, and Issue events,
validates and normalizes them through a low-latency TypeScript API, then routes and renders
them as color-coded rich embeds in Discord.

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
GitHub Webhook ──▶ Fastify API ──────────────────────────▶ Discord
  push/PR/issue     verify · validate · normalize            rich embed
                    route · build embed · retry
```

The pipeline keeps three concerns separate inside one deployable, each unit-testable
on its own:

- **Ingress** — HMAC verification and Zod validation (`plugins/`, `schemas/`).
- **Normalization** — GitHub's payload collapsed into a stable `NormalizedEvent` (`transformers/`).
- **Presentation & delivery** — event-type routing, embed construction, retrying HTTP delivery (`discord/`).

### From workflow tool to typed service

The routing and presentation layer originally ran as an n8n Cloud workflow: a Switch node
branching on event type, three Code nodes building embeds, and an HTTP node with retry
configured on it. n8n made the first version fast to prototype and easy to reason about
visually — but it put a hosted third-party runtime, a second set of credentials, and a
network hop on the critical path of every notification. When that hosted instance lapsed,
the whole pipeline went dark despite the API being perfectly healthy.

So I ported the workflow into the API as typed modules (`discord/embeds.ts`,
`discord/deliver.ts`), preserving the behavior node-for-node — same colors, same fields,
same two-tier retry semantics — and covered it with unit tests the visual workflow never
had. The migration removed an entire class of failure (third-party availability), cut one
network hop and one shared secret, and made the presentation logic reviewable in a diff.
The original workflow JSON is archived in `n8n/` with its credentials scrubbed.

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
occasionally return `5xx`. Delivery handles this in two tiers: a retry loop (5 attempts,
3s floor backoff, extended when Discord's own `retry_after` asks for longer) absorbs
transient rate-limits and blips automatically, while a non-429 `4xx` — a deleted webhook,
say — fails fast rather than burning retries on something that can never succeed. If the
retries are exhausted, delivery throws a typed error carrying a structured diagnostic
(`status`, `retryAfter`, message), which the route logs before returning `502` and
declining to mark the event seen — so GitHub redelivers once the downstream recovers.
The result is an at-least-once delivery guarantee with no silent data loss.

**Edge-case-aware formatting.** The notification logic distinguishes cases most bots
ignore: a *merged* PR (green) versus one *closed without merging* (red), force-pushes and
branch create/delete events, tags versus branches, and issue label changes. PR embeds
surface `+additions / -deletions` and changed-file counts at a glance.

## Engineering practices

The API ships with a `node:test` suite covering the normalization edge cases, the embed
builders, the idempotency/ring-buffer store, and full route integration — including the
failure paths, where a mocked Discord `500` is asserted to retry and then trigger a
redelivery rather than a dropped event, and a `404` is asserted to fail fast without
retrying. Configuration is validated at boot with Zod, so the service fails fast with a
clear message rather than crashing mid-request. Secrets are read only from the environment,
and a CORS-guarded `GET /logs` endpoint exposes a live activity feed to my portfolio frontend.

## Outcome

A production-minded, fault-tolerant automation pipeline that demonstrates secure webhook
handling, thoughtful data modelling, and real-world resilience engineering — the kind of
backend plumbing that has to *just work* unattended. It also demonstrates knowing when a
low-code tool has earned its place and when to retire it: the visual workflow shaped the
design quickly, and folding it back into typed, tested code removed the last external
dependency the pipeline had.
