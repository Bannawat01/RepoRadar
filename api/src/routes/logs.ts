import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventLog } from '../store/eventLog.js';

/**
 * Read API for the frontend "Live Activity Feed".
 * GET /logs?limit=5  ->  most recent normalized events, newest first.
 */
export default async function logsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/logs', async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = (req.query as { limit?: string } | undefined)?.limit;
    const parsed = Number.parseInt(raw ?? '', 10);
    // Default 5, clamp to 1..50 to keep the endpoint cheap and predictable.
    const limit = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 50)
      : 5;

    const events = eventLog.recent(limit);
    return reply.code(200).send({ count: events.length, events });
  });
}
