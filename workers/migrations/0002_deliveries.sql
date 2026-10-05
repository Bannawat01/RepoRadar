CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  hook_id TEXT NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
  github_delivery TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','sent','failed')) DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(hook_id, github_delivery)
);
CREATE INDEX deliveries_due ON deliveries(status, next_attempt_at);