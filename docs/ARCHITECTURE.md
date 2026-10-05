# Architecture

GitHub -> `POST /webhooks/:id` -> Worker (raw-body HMAC + repo check) -> D1 delivery row -> Worker continuation / Cron -> Discord.

D1 stores encrypted hook credentials and delivery state. The admin UI is served by the same Worker and accesses `/api/*` with the in-memory admin token. Configuration responses omit Discord URLs and existing GitHub secrets.
