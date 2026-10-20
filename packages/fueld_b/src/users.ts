import type { Database } from "bun:sqlite";
import { normalizePhone, type ConfiguredUser } from "./config";

export function initializeUsers(db: Database, users: ConfiguredUser[]) {
  db.transaction(() => {
    for (const user of users) {
      db.query(`INSERT INTO users (id, name, timezone) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, timezone=excluded.timezone`).run(user.id, user.name, user.timezone);
      db.query("INSERT INTO training_accounts (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING").run(user.id);
    }
  })();
}

export function getUser(db: Database, userId: string) {
  const user = db.query<{ userId: string; name: string; timezone: string }, [string]>(
    "SELECT id AS userId, name, timezone FROM users WHERE id=?",
  ).get(userId);
  if (!user) throw new Error("Configured user is not initialized");
  return user;
}

export function userForSender(users: ConfiguredUser[], sender: string) {
  let phone: string;
  try { phone = normalizePhone(sender); } catch { throw new Error("Unrecognized iMessage sender"); }
  const user = users.find(candidate => candidate.phone === phone);
  if (!user) throw new Error("Unrecognized iMessage sender");
  return user;
}
