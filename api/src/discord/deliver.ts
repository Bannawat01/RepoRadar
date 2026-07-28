import { request as undiciRequest } from 'undici';
import { env } from '../config/env.js';
import type { DiscordPayload } from './embeds.js';

export interface DeliveryDiagnostic {
  ok: false;
  stage: 'discord_delivery';
  status: number | null;
  retryAfter: number | null;
  message: string;
  at: string;
}

export class DiscordDeliveryError extends Error {
  readonly diagnostic: DeliveryDiagnostic;
  constructor(diagnostic: DeliveryDiagnostic) {
    super(diagnostic.message);
    this.name = 'DiscordDeliveryError';
    this.diagnostic = diagnostic;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 4xx other than 429 will never succeed on retry — fail fast. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * POST the embed to the Discord webhook.
 *
 * Tier 1 — retry: `DISCORD_MAX_TRIES` attempts with `DISCORD_RETRY_MS` backoff,
 * honouring Discord's `retry_after` (seconds) on 429 when it is longer.
 * Tier 2 — on exhaustion, throw a DiscordDeliveryError carrying a diagnostic
 * so the route can log it and answer 502 instead of dropping the event.
 */
export async function deliverToDiscord(payload: DiscordPayload): Promise<void> {
  let lastStatus: number | null = null;
  let lastRetryAfter: number | null = null;
  let lastMessage = 'Discord delivery failed after retries';

  for (let attempt = 1; attempt <= env.DISCORD_MAX_TRIES; attempt++) {
    let status: number | null = null;
    let retryAfter: number | null = null;

    try {
      const res = await undiciRequest(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      status = res.statusCode;
      const text = await res.body.text(); // always drain: releases the socket

      if (status < 400) return;

      lastMessage = `Discord responded ${status}: ${text.slice(0, 200)}`;
      try {
        const parsed = text ? (JSON.parse(text) as { retry_after?: number }) : {};
        const header = res.headers['retry-after'];
        retryAfter =
          parsed.retry_after ??
          (header != null ? Number(Array.isArray(header) ? header[0] : header) : null);
      } catch {
        retryAfter = null;
      }

      if (!isRetryable(status)) break;
    } catch (err) {
      // Network-level failure (DNS, socket) — retryable.
      lastMessage = err instanceof Error ? err.message : String(err);
    }

    lastStatus = status;
    lastRetryAfter = retryAfter;

    if (attempt < env.DISCORD_MAX_TRIES) {
      const waitMs = Math.max(
        env.DISCORD_RETRY_MS,
        retryAfter != null && Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
      );
      await sleep(waitMs);
    }
  }

  throw new DiscordDeliveryError({
    ok: false,
    stage: 'discord_delivery',
    status: lastStatus,
    retryAfter: lastRetryAfter,
    message: lastMessage,
    at: new Date().toISOString(),
  });
}
