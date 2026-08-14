CREATE TABLE IF NOT EXISTS ml_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ml_oauth_states (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ml_connection_controls (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
