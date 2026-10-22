import type { Database } from "bun:sqlite";

export function initializeSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS food_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      fdc_id INTEGER NOT NULL, food_name TEXT NOT NULL,
      quantity_g REAL NOT NULL CHECK (quantity_g > 0), consumed_at TEXT NOT NULL,
      nutrients_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS food_logs_user_day ON food_logs(user_id, consumed_at);
  `);
}
