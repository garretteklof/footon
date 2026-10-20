import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
export const databasePath = join(fileURLToPath(new URL("../../data", import.meta.url)), "herm.sqlite");

export function openDatabase(path = databasePath): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
  }
  const db = new Database(path, { create: true, readwrite: true });
  try {
    if (path !== ":memory:") chmodSync(path, 0o600);
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    db.transaction(() => db.exec(schema))();
    return db;
  } catch (error) { db.close(); throw error; }
}
