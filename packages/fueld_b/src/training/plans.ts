import type { Database } from "bun:sqlite";
import { addDays, localDateAt, validateDate } from "../utils/time";
import * as finalSurge from "./final-surge";
import type { ConfiguredUser } from "../config";

export type Workout = {
  date: string; name: string | null; description: string | null;
  status: "planned" | "completed" | "unknown"; isRace: boolean | null;
  activities: { activityType: string | null; plannedAmount: number | null; plannedAmountUnit: string | null }[];
};
export type Account = {
  userId: string; accountId: string | null;
  snapshot: string | null; start: string | null; end: string | null; syncedAt: string | null;
};
export function getAccount(db: Database, userId: string) {
  return db.query<Account, [string]>(`SELECT user_id AS userId, account_id AS accountId,
    snapshot_json AS snapshot, start_date AS start, end_date AS end, synced_at AS syncedAt
    FROM training_accounts WHERE user_id=?`).get(userId);
}
export async function trainingPlan(
  db: Database, user: ConfiguredUser, query: "week" | "refresh" | { days: number } | { date: string },
  http: typeof fetch = fetch,
) {
  if (!user.training) throw new Error("Training provider not configured for this user");
  const timezone = user.timezone, userId = user.id;
  db.query("INSERT INTO training_accounts (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING").run(userId);
  const account = getAccount(db, userId)!;
  const today = localDateAt(Date.now(), timezone);
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
    // Allocate ordering in SQLite so it also works across server processes.
    const refresh = db.query<{ refresh_version: number }, [string]>(
      "UPDATE training_accounts SET refresh_version=refresh_version+1 WHERE user_id=? RETURNING refresh_version",
    ).get(userId);
    if (!refresh) throw new Error("Training cache could not be initialized");
    try {
      const { accountId, workouts } = await finalSurge.getWorkouts(user, account.accountId, fetchStart, fetchEnd, http);
      const owner = db.query<{ user_id: string }, [string, string]>(
        "SELECT user_id FROM training_accounts WHERE account_id=? AND user_id<>?",
      ).get(accountId, userId);
      if (owner) throw new finalSurge.AccountMismatchError("Final Surge account is already configured for another user");
      if (workouts.some(workout => workout.date < fetchStart || workout.date > fetchEnd)) throw new Error("Invalid provider range");
      workouts.sort((a, b) => a.date.localeCompare(b.date));
      db.query(`UPDATE training_accounts SET account_id=?, snapshot_json=?, start_date=?, end_date=?, synced_at=?
        WHERE user_id=? AND refresh_version=?`)
        .run(accountId, JSON.stringify(workouts), fetchStart, fetchEnd, new Date().toISOString(), userId, refresh.refresh_version);
    } catch (error) {
      if (error instanceof finalSurge.AccountMismatchError) throw error;
      failed = true;
    }
  }
  const latest = getAccount(db, userId)!;
  const stale = failed || !fresh(latest);
  return {
    provider: user.training.provider, timezone, start, end, stale,
    warning: stale ? "Training provider unavailable; cached data may be incomplete or outdated" : null,
    syncedAt: latest.syncedAt,
    workouts: (JSON.parse(latest.snapshot ?? "[]") as Workout[]).filter(workout => workout.date >= start && workout.date <= end),
  };
}
