import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { sql } from "drizzle-orm";
import { users } from "./schema";

export type FootonDb = BunSQLiteDatabase<Record<string, never>>;
export type StorageConnection = {
  path: string;
  sqlite: Database;
  db: FootonDb;
  close: () => void;
};

const packageDatabasePath = fileURLToPath(new URL("../db/foot.sqlite", import.meta.url));
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export function resolveDatabasePath(path?: string) {
  const configuredPath = path ?? process.env.FOOTON_DB_PATH;
  if (!configuredPath) return packageDatabasePath;
  return configuredPath === ":memory:" ? configuredPath : resolve(configuredPath);
}

function prepareDirectory(path: string) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function connect(path: string, create: boolean): StorageConnection {
  const memory = path === ":memory:";
  if (!memory) {
    if (!create && !existsSync(path)) {
      throw new Error(`Footon database not found at ${path}; run the explicit database migration command to initialize it`);
    }
    if (create) prepareDirectory(path);
  }

  const sqlite = new Database(path, { create: memory || create, readwrite: true });
  try {
    if (!memory) chmodSync(path, 0o600);
    sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    const db = drizzle({ client: sqlite });
    return { path, sqlite, db, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

/** Opens an existing database; it never silently creates an empty production file. */
export function openStorage(path?: string): StorageConnection {
  const resolvedPath = resolveDatabasePath(path);
  return connect(resolvedPath, resolvedPath === ":memory:");
}

/** Applies checked-in Drizzle migrations to an already-open connection. */
export function migrateDatabase(db: FootonDb) {
  migrate(db, { migrationsFolder });
}

/** Explicit migration entry point; may create the configured database file. */
export function migrateStorage(path?: string) {
  const connection = connect(resolveDatabasePath(path), true);
  try {
    migrateDatabase(connection.db);
  } finally {
    connection.close();
  }
}

export function upsertUsers(db: FootonDb, configuredUsers: readonly { id: string; name: string; timezone: string }[]) {
  if (configuredUsers.length === 0) return;
  const createdAt = new Date().toISOString();
  db.insert(users).values(configuredUsers.map(user => ({
    id: user.id,
    createdAt,
    displayName: user.name,
    timezone: user.timezone,
  }))).onConflictDoUpdate({
    target: users.id,
    set: {
      displayName: sql`excluded.display_name`,
      timezone: sql`excluded.timezone`,
    },
  }).run();
}
