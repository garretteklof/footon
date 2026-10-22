import type { Database } from "bun:sqlite";

export function initializeSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS training_accounts (
      user_id TEXT PRIMARY KEY,
      account_id TEXT UNIQUE,
      snapshot_json TEXT, start_date TEXT, end_date TEXT, synced_at TEXT,
      refresh_version INTEGER NOT NULL DEFAULT 0,
      CHECK (length(user_id) > 0), CHECK (account_id IS NULL OR length(account_id) > 0)
    );
  `);
}
