CREATE TABLE training_plan_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, account_id TEXT NOT NULL, credentials_env TEXT NOT NULL,
 UNIQUE(provider, account_id)
);
CREATE TABLE training_workouts (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, account_id TEXT NOT NULL, workout_id TEXT NOT NULL,
 workout_date TEXT NOT NULL, normalized_json TEXT NOT NULL, raw_json TEXT NOT NULL, synced_at TEXT NOT NULL,
 PRIMARY KEY(user_id, provider, account_id, workout_id)
);
CREATE TABLE training_sync (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL, account_id TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, synced_at TEXT NOT NULL,
 PRIMARY KEY(user_id, provider, account_id, start_date, end_date)
);
