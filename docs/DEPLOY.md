# Deployment

Follow the `Deploy` section in the root README. Use `wrangler d1 create`, put the returned ID in `workers/wrangler.jsonc`, apply migrations, set `INSTANCE_SECRET_KEY` and `ADMIN_TOKEN` through `wrangler secret put`, then run `wrangler deploy`.

Do not rotate `INSTANCE_SECRET_KEY` without a migration plan: it encrypts configuration already stored in D1.
