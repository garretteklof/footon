import { chmodSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

const migrationsDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, readwrite: true });
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  if (path !== ":memory:") chmodSync(path, 0o600);
  return db;
}

export function migrate(db: Database, directory = migrationsDirectory): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const applied = new Set(db.query<{ version: string }, []>("SELECT version FROM schema_migrations").all().map(row => row.version));
  const names = readdirSync(directory).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(directory, name), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
    });
    apply();
  }
}
