import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { resolveDatabasePath } from "./client";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
type ColumnSpec = readonly [name: string, type: string, notNull: number, primaryKeyPosition: number, defaultValue: string | null];
const expectedColumns: Record<string, ColumnSpec[]> = {
  users: [["id", "text", 0, 1, null], ["created_at", "text", 1, 0, null], ["display_name", "text", 0, 0, null], ["timezone", "text", 1, 0, "'UTC'"]],
  identities: [["platform", "text", 1, 1, null], ["external_id", "text", 1, 2, null], ["user_id", "text", 1, 0, null]],
  food_logs: [["id", "text", 0, 1, null], ["user_id", "text", 1, 0, null], ["fdc_id", "integer", 1, 0, null], ["food_name", "text", 1, 0, null], ["quantity_g", "real", 1, 0, null], ["consumed_at", "text", 1, 0, null], ["nutrients_json", "text", 1, 0, null]],
  training_accounts: [["user_id", "text", 0, 1, null], ["provider", "text", 1, 0, null], ["account_id", "text", 1, 0, null], ["credential_ref", "text", 1, 0, null], ["snapshot_json", "text", 0, 0, null], ["start_date", "text", 0, 0, null], ["end_date", "text", 0, 0, null], ["synced_at", "text", 0, 0, null], ["refresh_version", "integer", 1, 0, "0"]],
};

function validateExistingSchema(db: Database) {
  for (const [table, expected] of Object.entries(expectedColumns)) {
    const columns = db.query<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }, []>(`PRAGMA table_info("${table}")`).all();
    const actual: ColumnSpec[] = columns.map(column => [column.name, column.type.toLowerCase(), column.notnull, column.pk, column.dflt_value]);
    if (actual.length === 0 || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Cannot baseline database: ${table} columns or constraints do not match the inspected Footon schema`);
    }
  }
  const objects = new Set(db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index')",
  ).all().map(row => row.name));
  for (const name of ["food_logs_user_day", "identities_user"]) {
    if (!objects.has(name)) throw new Error(`Cannot baseline database: expected index ${name} is missing`);
  }
  const foodLogSql = db.query<{ sql: string }, [string]>(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
  ).get("food_logs")?.sql ?? "";
  if (!/check\s*\(\s*(?:["`]?food_logs["`]?\s*\.\s*)?["`]?quantity_g["`]?\s*>\s*0\s*\)/i.test(foodLogSql)) {
    throw new Error("Cannot baseline database: food_logs quantity constraint is missing");
  }
  const accountIndexes = db.query<{ name: string; unique: number }, []>("PRAGMA index_list('training_accounts')").all();
  const hasUniqueProviderAccount = accountIndexes.some(index => {
    if (!index.unique) return false;
    const columns = db.query<{ name: string }, []>(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`).all().map(column => column.name);
    return columns.join("\0") === "provider\0account_id";
  });
  if (!hasUniqueProviderAccount) throw new Error("Cannot baseline database: training account uniqueness constraint is missing");
  for (const table of ["identities", "food_logs", "training_accounts"]) {
    const foreignKeys = db.query<{ table: string; from: string; to: string; on_delete: string }, []>(`PRAGMA foreign_key_list("${table}")`).all();
    if (!foreignKeys.some(key => key.table === "users" && key.from === "user_id" && key.to === "id" && key.on_delete.toLowerCase() === "cascade")) {
      throw new Error(`Cannot baseline database: ${table} user foreign key does not match`);
    }
  }
  const foreignKeyErrors = db.query("PRAGMA foreign_key_check").all();
  if (foreignKeyErrors.length) throw new Error("Cannot baseline database: foreign-key check failed");
}

export function baselineStorage(path?: string) {
  const databasePath = resolveDatabasePath(path);
  if (databasePath === ":memory:" || !existsSync(databasePath)) {
    throw new Error(`Cannot baseline missing Footon database at ${databasePath}; baselining only applies to an existing database`);
  }
  const migrations = readMigrationFiles({ migrationsFolder });
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  if (!migrations.length || !journal.entries.length) throw new Error("Cannot baseline: no generated Drizzle baseline migration exists");
  const first = migrations[0];
  const firstEntry = journal.entries[0];
  const firstSql = readFileSync(`${migrationsFolder}/${firstEntry.tag}.sql`);
  const hash = createHash("sha256").update(firstSql).digest("hex");

  const db = new Database(databasePath, { create: false, readwrite: true });
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    validateExistingSchema(db);
    const hasMigrationTable = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    ).get();
    if (hasMigrationTable) {
      const applied = db.query<{ count: number }, []>("SELECT count(*) AS count FROM __drizzle_migrations").get()?.count ?? 0;
      if (applied > 0) throw new Error("Cannot baseline: Drizzle migration history already exists");
    }
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )`);
      db.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(hash, first.folderMillis);
    })();
    return { databasePath, migration: firstEntry.tag, createdAt: first.folderMillis };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  try {
    const result = baselineStorage();
    console.info(`Baselined existing Footon schema at ${result.databasePath} (${result.migration})`);
  } catch (error) {
    console.error("Footon database baseline failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
