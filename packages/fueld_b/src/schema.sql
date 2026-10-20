CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC'
);
CREATE TABLE IF NOT EXISTS identities (
  platform TEXT NOT NULL, external_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (platform, external_id)
);
CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);
CREATE TABLE IF NOT EXISTS food_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fdc_id INTEGER NOT NULL, food_name TEXT NOT NULL,
  quantity_g REAL NOT NULL CHECK (quantity_g > 0), consumed_at TEXT NOT NULL,
  nutrients_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS food_logs_user_day ON food_logs(user_id, consumed_at);
CREATE TABLE IF NOT EXISTS training_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, account_id TEXT NOT NULL, credential_ref TEXT NOT NULL,
  snapshot_json TEXT, start_date TEXT, end_date TEXT, synced_at TEXT,
  refresh_version INTEGER NOT NULL DEFAULT 0,
  UNIQUE (provider, account_id)
);
