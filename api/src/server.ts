import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import rawBodyPlugin from './plugins/verifySignature.js';
import webhookRoutes from './routes/webhook.js';
import logsRoutes from './routes/logs.js';

export async function buildServer() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    bodyLimit: 5 * 1024 * 1024, // 5 MB — GitHub push payloads can be large.
  });

  // CORS: allow the deployed frontend (and localhost during dev) to call the read API.
  // The webhook route is server-to-server (GitHub) and is unaffected by CORS.
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    methods: ['GET', 'OPTIONS'],
  });

  // Raw-body parser (needed for HMAC verification) must be registered before routes.
  await app.register(rawBodyPlugin);

  // Health check for uptime monitors / tunnels.
  app.get('/healthz', async () => ({ status: 'ok' }));

  await app.register(webhookRoutes);
  await app.register(logsRoutes);

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only auto-start when run directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  void main();
}
