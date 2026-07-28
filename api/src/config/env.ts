import { z } from 'zod';

/**
 * Validate process.env once at boot. Fail fast with a clear message if a
 * required secret is missing, rather than crashing deep in a request handler.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  // Discord webhook the API posts embeds to directly (no n8n in the path).
  DISCORD_WEBHOOK_URL: z.string().url('DISCORD_WEBHOOK_URL must be a valid URL'),
  // Delivery resilience: attempts and the floor backoff between them (ms).
  DISCORD_MAX_TRIES: z.coerce.number().int().min(1).default(5),
  DISCORD_RETRY_MS: z.coerce.number().int().min(0).default(3000),
  // Comma-separated list of allowed frontend origins for CORS.
  // e.g. "https://bannawat.site,http://localhost:5173"
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n❌ Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const env: Env = parsed.data;
