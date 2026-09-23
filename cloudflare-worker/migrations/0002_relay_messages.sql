CREATE TABLE IF NOT EXISTS relay_messages (
  id TEXT PRIMARY KEY,
  uuid TEXT NOT NULL REFERENCES clients(uuid) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'text_enter', 'enter')),
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'done', 'failed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_relay_pickup
  ON relay_messages (uuid, state, claimed_until, created_at);
CREATE INDEX IF NOT EXISTS idx_relay_expiry
  ON relay_messages (expires_at);
