import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { request as undiciRequest } from 'undici';
import { env } from '../config/env.js';
import { isValidGitHubSignature } from '../plugins/verifySignature.js';
import {
  PushEventSchema,
  PullRequestEventSchema,
  IssuesEventSchema,
} from '../schemas/github.js';
import {
  normalizePush,
  normalizePullRequest,
  normalizeIssues,
} from '../transformers/toNormalized.js';
import { eventLog } from '../store/eventLog.js';
import type { NormalizedEvent } from '../types/index.js';

/**
 * Forward the normalized event to n8n and confirm it was accepted.
 *
 * n8n replies with a meaningful status: 200 (delivered to Discord),
 * 401 (bad forward token), or 502 (Discord unreachable after its own retries).
 * We treat ANY non-2xx as a downstream failure and throw — the caller then
 * returns 502 and does NOT mark the delivery "seen", so GitHub redelivers.
 * This closes the fault-tolerance loop end to end.
 */
async function forwardToN8n(payload: NormalizedEvent): Promise<void> {
  const res = await undiciRequest(env.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-reporadar-token': env.N8N_FORWARD_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  // Always drain the body so undici can release the socket back to the pool.
  const text = await res.body.text();

  if (res.statusCode >= 400) {
    throw new Error(
      `n8n forward failed: ${res.statusCode} ${text.slice(0, 200)}`,
    );
  }
}

export default async function webhookRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    '/webhooks/github',
    async (req: FastifyRequest, reply: FastifyReply) => {
      // 1. Verify signature against the raw body.
      const signature = req.headers['x-hub-signature-256'] as
        | string
        | undefined;
      if (!req.rawBody || !isValidGitHubSignature(req.rawBody, signature)) {
        return reply.code(401).send({ error: 'invalid signature' });
      }

      const eventName = req.headers['x-github-event'] as string | undefined;
      const delivery = req.headers['x-github-delivery'] as string | undefined;
      req.log.info({ eventName, delivery }, 'webhook received');

      // GitHub sends a `ping` on webhook creation — ack it.
      if (eventName === 'ping') {
        return reply.code(200).send({ ok: true, pong: true });
      }

      // 2. Idempotency: GitHub retries deliveries. Skip ones we've handled.
      if (eventLog.hasSeen(delivery)) {
        req.log.info({ delivery }, 'duplicate delivery ignored');
        return reply.code(200).send({ ok: true, duplicate: true });
      }

      // 3. Validate + normalize per event type.
      let normalized: NormalizedEvent;
      try {
        switch (eventName) {
          case 'push':
            normalized = normalizePush(PushEventSchema.parse(req.body));
            break;
          case 'pull_request':
            normalized = normalizePullRequest(
              PullRequestEventSchema.parse(req.body),
            );
            break;
          case 'issues':
            normalized = normalizeIssues(IssuesEventSchema.parse(req.body));
            break;
          default:
            // Event we don't handle — ack so GitHub doesn't retry.
            return reply
              .code(202)
              .send({ ok: true, ignored: eventName ?? 'unknown' });
        }
      } catch (err) {
        req.log.warn({ err, eventName }, 'payload validation failed');
        return reply.code(400).send({ error: 'invalid payload' });
      }

      // 4. Forward to n8n and require a 2xx acknowledgement.
      try {
        await forwardToN8n(normalized);
      } catch (err) {
        req.log.error({ err }, 'failed to forward to n8n');
        // Do NOT mark seen — return 502 so GitHub redelivers the event.
        return reply.code(502).send({ error: 'downstream forward failed' });
      }

      // 5. Record for idempotency + the activity feed (only after success).
      const id = delivery ?? `${normalized.event}-${Date.now()}`;
      eventLog.markSeen(delivery);
      eventLog.add(normalized, id);

      return reply.code(202).send({ ok: true, event: normalized.event });
    },
  );
}
