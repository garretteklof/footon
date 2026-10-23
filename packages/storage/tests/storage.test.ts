import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { baselineStorage } from "../src/baseline";
import { migrateDatabase, migrateStorage, openStorage, resolveDatabasePath, upsertUsers } from "../src/client";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "footon-storage-test-"));
  directories.push(directory);
  return directory;
}

test("default path is package-relative and FOOTON_DB_PATH overrides it", () => {
  const expected = fileURLToPath(new URL("../db/foot.sqlite", import.meta.url));
  expect(resolveDatabasePath()).toBe(expected);
  const previous = process.env.FOOTON_DB_PATH;
  try {
    process.env.FOOTON_DB_PATH = "/tmp/footon-override.sqlite";
    expect(resolveDatabasePath()).toBe(resolve("/tmp/footon-override.sqlite"));
  } finally {
    if (previous === undefined) delete process.env.FOOTON_DB_PATH;
    else process.env.FOOTON_DB_PATH = previous;
  }
});

test("openStorage uses the FOOTON_DB_PATH override", () => {
  const path = join(temporaryDirectory(), "override.sqlite");
  migrateStorage(path);
  const previous = process.env.FOOTON_DB_PATH;
  try {
    process.env.FOOTON_DB_PATH = path;
    const storage = openStorage();
    expect(storage.path).toBe(resolve(path));
    storage.close();
  } finally {
    if (previous === undefined) delete process.env.FOOTON_DB_PATH;
    else process.env.FOOTON_DB_PATH = previous;
  }
});
test("opening an absent production path fails without creating an empty database", () => {
  const path = join(temporaryDirectory(), "missing.sqlite");
  expect(() => openStorage(path)).toThrow("database not found");
  expect(existsSync(path)).toBe(false);
});

test("Drizzle migrates an isolated in-memory database with shared tables and safe SQLite settings", () => {
  const storage = openStorage(":memory:");
  try {
    migrateDatabase(storage.db);
    expect(storage.sqlite.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    expect(storage.sqlite.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout).toBe(5000);
    expect(storage.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    upsertUsers(storage.db, [{ id: "test-user", name: "Test User", timezone: "UTC" }]);
    expect(storage.sqlite.query("SELECT id, display_name FROM users").get()).toEqual({ id: "test-user", display_name: "Test User" });
    expect(storage.sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name='training_refresh_state'").get()).not.toBeNull();
  } finally {
    storage.close();
  }
});

test("baseline stamps an existing schema then applies only later migrations", () => {
  const directory = temporaryDirectory();
  const path = join(directory, "foot.sqlite");
  const sqlite = new Database(path, { create: true, readwrite: true });
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, display_name TEXT, timezone TEXT NOT NULL DEFAULT 'UTC');
    CREATE TABLE identities (
      platform TEXT NOT NULL, external_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (platform, external_id)
    );
    CREATE INDEX identities_user ON identities(user_id);
    CREATE TABLE food_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fdc_id INTEGER NOT NULL, food_name TEXT NOT NULL,
      quantity_g REAL NOT NULL CHECK (quantity_g > 0), consumed_at TEXT NOT NULL,
      nutrients_json TEXT NOT NULL
    );
    CREATE INDEX food_logs_user_day ON food_logs(user_id, consumed_at);
    CREATE TABLE training_accounts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, account_id TEXT NOT NULL, credential_ref TEXT NOT NULL,
      snapshot_json TEXT, start_date TEXT, end_date TEXT, synced_at TEXT,
      refresh_version INTEGER NOT NULL DEFAULT 0,
      UNIQUE (provider, account_id)
    );
    INSERT INTO users (id, created_at, display_name, timezone) VALUES ('legacy-user', '2026-01-01T00:00:00.000Z', 'Legacy User', 'UTC');
    INSERT INTO identities (platform, external_id, user_id) VALUES ('bluebubbles', 'test-sender', 'legacy-user');
    INSERT INTO food_logs (id, user_id, fdc_id, food_name, quantity_g, consumed_at, nutrients_json)
      VALUES ('legacy-entry', 'legacy-user', 1, 'Apple', 50, '2026-01-02T12:00:00.000Z', '{}');
    INSERT INTO training_accounts (user_id, provider, account_id, credential_ref)
      VALUES ('legacy-user', 'final-surge', 'legacy-account', 'legacy-user');
  `);
  sqlite.close();

  expect(baselineStorage(path).migration).toBe("0000_baseline");
  migrateStorage(path);
  const migrated = openStorage(path);
  try {
    const migrationCount = migrated.sqlite.query<{ count: number }, []>("SELECT count(*) AS count FROM __drizzle_migrations").get()?.count;
    expect(migrationCount).toBe(2);
    for (const table of ["users", "identities", "food_logs", "training_accounts"]) {
      expect(migrated.sqlite.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()?.count).toBe(1);
    }
    expect(migrated.sqlite.query("SELECT name FROM sqlite_master WHERE type='table' AND name='training_refresh_state'").get()).not.toBeNull();
    expect(migrated.sqlite.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(migrated.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  } finally {
    migrated.close();
  }
});
