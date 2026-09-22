-- MilkSU Cloud Agent D1 schema (bound as env.DB in milksu-admin deploy).
-- Sessions default to in-memory Map until this binding exists.

CREATE TABLE IF NOT EXISTS cloud_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_token_hash TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  kernel TEXT NOT NULL DEFAULT 'pi',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  transcript_json TEXT NOT NULL DEFAULT '[]',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cloud_sessions_owner_updated
  ON cloud_sessions(owner_token_hash, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS cloud_session_events (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  turn_id TEXT NOT NULL DEFAULT '',
  timestamp_ms INTEGER NOT NULL,
  json_payload TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (session_id) REFERENCES cloud_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cloud_session_events_session_ts
  ON cloud_session_events(session_id, timestamp_ms);

-- User-supplied cloud credentials: ciphertext only (AES-GCM). Never store plaintext.
CREATE TABLE IF NOT EXISTS cloud_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  owner_token_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  iv_b64 TEXT NOT NULL,
  ciphertext_b64 TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS cloud_credentials_owner
  ON cloud_credentials(owner_token_hash, updated_at_ms DESC);
