import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { isValidTimeZone } from "./time";

export function getUser(db: Database, userId: string) {
  const user = db.query<{ userId: string; name: string | null; timezone: string }, [string]>(
    "SELECT id AS userId, display_name AS name, timezone FROM users WHERE id=?",
  ).get(userId);
  if (!user) throw new Error("User not found; resolve a messaging identity first");
  return user;
}
export function setUserName(db: Database, userId: string, name: string): void {
  if (!name.trim() || name.trim().length > 100) throw new Error("Name must contain 1 to 100 characters");
  getUser(db, userId);
  db.query("UPDATE users SET display_name=? WHERE id=?").run(name.trim(), userId);
}
export function setUserTimezone(db: Database, userId: string, timezone: string) {
  if (!isValidTimeZone(timezone)) throw new Error("timezone must be a valid IANA timezone, such as America/Chicago");
  getUser(db, userId);
  db.query("UPDATE users SET timezone=? WHERE id=?").run(timezone, userId);
  return { userId, timezone };
}
export function resolveIdentity(db: Database, platform: string, externalId: string, name?: string) {
  if (!platform || platform.length > 80 || !externalId || externalId.length > 255) throw new Error("Invalid sender identity");
  return db.transaction(() => {
    const existing = db.query<{ userId: string }, [string, string]>(
      "SELECT user_id AS userId FROM identities WHERE platform=? AND external_id=?",
    ).get(platform, externalId);
    const userId = existing?.userId ?? randomUUID();
    if (!existing) {
      db.query("INSERT INTO users (id, created_at) VALUES (?,?)").run(userId, new Date().toISOString());
      db.query("INSERT INTO identities VALUES (?,?,?)").run(platform, externalId, userId);
    }
    if (name !== undefined) setUserName(db, userId, name);
    return { userId, created: !existing, status: existing ? "existing" as const : "created" as const };
  }).immediate();
}
export function linkIdentity(db: Database, userId: string, platform: string, externalId: string): void {
  if (!platform || platform.length > 80 || !externalId || externalId.length > 255) throw new Error("Invalid sender identity");
  db.transaction(() => {
    getUser(db, userId);
    const existing = db.query<{ user_id: string }, [string, string]>(
      "SELECT user_id FROM identities WHERE platform=? AND external_id=?",
    ).get(platform, externalId);
    if (existing && existing.user_id !== userId) throw new Error("That messaging identity is already linked to another user");
    if (!existing) db.query("INSERT INTO identities VALUES (?,?,?)").run(platform, externalId, userId);
  }).immediate();
}
export function listUsers(db: Database) {
  return db.query<{ userId: string; name: string | null; timezone: string }, []>(
    "SELECT id AS userId, display_name AS name, timezone FROM users ORDER BY created_at, rowid",
  ).all().map(user => ({ ...user, identities: db.query<{ platform: string; externalId: string }, [string]>(
    "SELECT platform, external_id AS externalId FROM identities WHERE user_id=? ORDER BY platform, external_id",
  ).all(user.userId) }));
}
