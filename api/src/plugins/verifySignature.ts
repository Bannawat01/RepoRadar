import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';

type ParserDone = (err: Error | null, body?: unknown) => void;

/**
 * We need the RAW request body to compute the HMAC — Fastify's default JSON
 * parser discards it. This plugin installs a content-type parser that keeps the
 * raw buffer on `request.rawBody` while still producing a parsed JSON body.
 */
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify GitHub's X-Hub-Signature-256 header against the raw body.
 * Constant-time comparison to avoid timing attacks.
 */
export function isValidGitHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  const hmac = crypto.createHmac('sha256', env.GITHUB_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const expected = `sha256=${hmac.digest('hex')}`;
  return safeEqual(expected, signatureHeader);
}

async function rawBodyPlugin(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done: ParserDone) => {
      req.rawBody = body;
      try {
        const json = body.length ? JSON.parse(body.toString('utf8')) : {};
        done(null, json);
      } catch (err) {
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );
}

export default fp(rawBodyPlugin, { name: 'raw-body' });
