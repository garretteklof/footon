CREATE TABLE IF NOT EXISTS food_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  fdc_id INTEGER NOT NULL, food_name TEXT NOT NULL,
  quantity_g REAL NOT NULL CHECK (quantity_g > 0), consumed_at TEXT NOT NULL,
  nutrients_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS food_logs_user_day ON food_logs(user_id, consumed_at);
CREATE TABLE IF NOT EXISTS training_accounts (
  user_id TEXT PRIMARY KEY,
  account_id TEXT UNIQUE,
  snapshot_json TEXT, start_date TEXT, end_date TEXT, synced_at TEXT,
  refresh_version INTEGER NOT NULL DEFAULT 0,
  CHECK (length(user_id) > 0), CHECK (account_id IS NULL OR length(account_id) > 0)
);
