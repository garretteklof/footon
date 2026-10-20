import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { addDays, localDateAt, validateDate } from "../time";
import { getUser } from "../users";
import * as finalSurge from "./final-surge";
import { saveCredentials, deleteCredentials, type Credentials, type Secrets } from "./secrets";

export type Workout = {
  date: string; name: string | null; description: string | null;
  status: "planned" | "completed" | "unknown"; isRace: boolean | null;
  activities: { activityType: string | null; plannedAmount: number | null; plannedAmountUnit: string | null }[];
};
export type Account = {
  userId: string; provider: string; accountId: string; credentialRef: string; timezone: string;
  snapshot: string | null; start: string | null; end: string | null; syncedAt: string | null;
};
export function getAccount(db: Database, userId: string) {
  return db.query<Account, [string]>(`SELECT user_id AS userId, provider, account_id AS accountId, credential_ref AS credentialRef,
    timezone, snapshot_json AS snapshot, start_date AS start, end_date AS end, synced_at AS syncedAt
    FROM training_accounts JOIN users ON users.id=user_id WHERE user_id=?`).get(userId);
}
function providerFor(provider: string) {
  if (provider !== "final-surge") throw new Error("Unsupported configured training-plan provider");
  return finalSurge;
}
export async function connectAccount(
  db: Database, userId: string, provider: string, credentials: Credentials,
  secrets: Secrets = Bun.secrets, http: typeof fetch = fetch,
) {
  getUser(db, userId);
  const reference = randomUUID(), accountId = await providerFor(provider).connect(reference, credentials, http);
  const owner = db.query<{ user_id: string }, [string, string]>(
    "SELECT user_id FROM training_accounts WHERE provider=? AND account_id=?",
  ).get(provider, accountId);
  if (owner && owner.user_id !== userId) throw new Error("This training account is already connected to another user");
  await saveCredentials(reference, credentials, secrets);
  let previous: Account | null;
  try {
    previous = db.transaction(() => {
      const previous = getAccount(db, userId);
      if (previous?.provider === provider && previous.accountId === accountId)
        db.query("UPDATE training_accounts SET credential_ref=?, refresh_version=refresh_version+1 WHERE user_id=?").run(reference, userId);
      else db.query(`INSERT INTO training_accounts (user_id,provider,account_id,credential_ref) VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider, account_id=excluded.account_id, credential_ref=excluded.credential_ref,
        snapshot_json=NULL, start_date=NULL, end_date=NULL, synced_at=NULL, refresh_version=0`).run(userId, provider, accountId, reference);
      return previous;
    })();
  } catch {
    await deleteCredentials(reference, secrets);
    throw new Error("Could not associate the training account; the previous connection was preserved");
  }
  let warning: string | null = null;
  if (previous) {
    try { await deleteCredentials(previous.credentialRef, secrets); }
    catch { warning = "Connected, but the previous credential entry could not be removed from the OS credential store"; }
  }
  return { sync: await trainingPlan(db, userId, "refresh", secrets, http), warning };
}
export async function trainingPlan(
  db: Database, userId: string, query: "week" | "refresh" | { days: number } | { date: string },
  secrets: Secrets = Bun.secrets, http: typeof fetch = fetch,
) {
  const account = getAccount(db, userId);
  if (!account) throw new Error("No training-plan provider configured for this user; run bun run training connect");
  const provider = providerFor(account.provider), today = localDateAt(Date.now(), account.timezone);
  const monday = addDays(today, -((new Date(today).getUTCDay() + 6) % 7)), nextSunday = addDays(monday, 13);
  let start = monday, end = query === "refresh" ? nextSunday : addDays(monday, 6);
  if (typeof query === "object") {
    if ("date" in query) start = end = validateDate(query.date);
    else {
      if (!Number.isInteger(query.days) || query.days < 1 || query.days > 90) throw new Error("days must be an integer from 1 to 90");
      start = today; end = addDays(today, query.days - 1);
    }
  }
  const fresh = (value: Account) => !!value.syncedAt && !!value.start && !!value.end
    && value.start <= start && value.end >= end && Date.now() - Date.parse(value.syncedAt) < 30 * 60000;
  let failed = false;
  if (query === "refresh" || !fresh(account)) {
    const fetchStart = start < monday ? start : monday, fetchEnd = end > nextSunday ? end : nextSunday;
    // Allocate ordering in SQLite so it also works between the CLI and MCP processes.
    const refresh = db.query<{ refresh_version: number }, [string, string]>(
      "UPDATE training_accounts SET refresh_version=refresh_version+1 WHERE user_id=? AND credential_ref=? RETURNING refresh_version",
    ).get(userId, account.credentialRef);
    if (!refresh) throw new Error("Training connection changed during refresh; retry the request");
    try {
      const workouts = await provider.getWorkouts(account, fetchStart, fetchEnd, secrets, http);
      if (workouts.some(workout => workout.date < fetchStart || workout.date > fetchEnd)) throw new Error("Invalid provider range");
      workouts.sort((a, b) => a.date.localeCompare(b.date));
      db.query(`UPDATE training_accounts SET snapshot_json=?, start_date=?, end_date=?, synced_at=?
        WHERE user_id=? AND provider=? AND account_id=? AND credential_ref=? AND refresh_version=?`)
        .run(JSON.stringify(workouts), fetchStart, fetchEnd, new Date().toISOString(), userId, account.provider, account.accountId, account.credentialRef, refresh.refresh_version);
    } catch { failed = true; }
  }
  const latest = getAccount(db, userId);
  if (!latest || latest.credentialRef !== account.credentialRef) throw new Error("Training connection changed during refresh; retry the request");
  const stale = failed || !fresh(latest);
  return {
    provider: latest.provider, timezone: latest.timezone, start, end, stale,
    warning: stale ? "Training provider unavailable; cached data may be incomplete or outdated" : null,
    syncedAt: latest.syncedAt,
    workouts: (JSON.parse(latest.snapshot ?? "[]") as Workout[]).filter(workout => workout.date >= start && workout.date <= end),
  };
}
