import { and, eq, lt, ne, sql } from "drizzle-orm";
import type { FootonDb } from "@footon/storage";
import { addDays, localDateAt, validateDate } from "./time";
import * as finalSurge from "./final-surge";
import { trainingAccounts } from "./db/schema";
import { trainingRefreshState } from "./db/refresh-schema";
import type { TrainingUser, Workout } from "./types";

export type Account = {
  userId: string;
  accountId: string;
  provider: string;
  credentialRef: string;
  snapshot: string | null;
  start: string | null;
  end: string | null;
  syncedAt: string | null;
  refreshVersion: number;
};

export function getAccount(db: FootonDb, userId: string) {
  const row = db.select().from(trainingAccounts).where(eq(trainingAccounts.userId, userId)).get();
  if (!row || typeof row.userId !== "string") return undefined;
  return {
    userId: row.userId,
    accountId: row.accountId,
    provider: row.provider,
    credentialRef: row.credentialRef,
    snapshot: row.snapshotJson,
    start: row.startDate,
    end: row.endDate,
    syncedAt: row.syncedAt,
    refreshVersion: row.refreshVersion,
  } satisfies Account;
}

export async function trainingPlan(
  db: FootonDb, user: TrainingUser, query: "week" | "refresh" | { days: number } | { date: string },
  http: typeof fetch = fetch,
) {
  if (!user.training) throw new Error("Training provider not configured for this user");
  const timezone = user.timezone, userId = user.id;
  let account = getAccount(db, userId);
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
  const fresh = (value: Account | undefined) => !!value?.syncedAt && !!value.start && !!value.end
    && value.start <= start && value.end >= end && Date.now() - Date.parse(value.syncedAt) < 30 * 60000;
  let failed = false;
  if (query === "refresh" || !fresh(account)) {
    const fetchStart = start < monday ? start : monday, fetchEnd = end > nextSunday ? end : nextSunday;
    db.insert(trainingRefreshState).values({ userId, refreshVersion: account?.refreshVersion ?? 0 }).onConflictDoNothing().run();
    const refresh = db.update(trainingRefreshState).set({
      refreshVersion: sql`${trainingRefreshState.refreshVersion} + 1`,
    }).where(eq(trainingRefreshState.userId, userId)).returning({ refreshVersion: trainingRefreshState.refreshVersion }).get();
    if (!refresh) throw new Error("Training cache could not be initialized");
    try {
      const { accountId, workouts } = await finalSurge.getWorkouts(user, account?.accountId ?? null, fetchStart, fetchEnd, http);
      const owner = db.select({ userId: trainingAccounts.userId }).from(trainingAccounts).where(and(
        eq(trainingAccounts.provider, user.training.provider),
        eq(trainingAccounts.accountId, accountId),
        ne(trainingAccounts.userId, userId),
      )).get();
      if (owner) throw new finalSurge.AccountMismatchError("Final Surge account is already configured for another user");
      if (workouts.some(workout => workout.date < fetchStart || workout.date > fetchEnd)) throw new Error("Invalid provider range");
      workouts.sort((a, b) => a.date.localeCompare(b.date));
      const syncedAt = new Date().toISOString();
      db.insert(trainingAccounts).values({
        userId,
        provider: user.training.provider,
        accountId,
        credentialRef: userId,
        snapshotJson: JSON.stringify(workouts),
        startDate: fetchStart,
        endDate: fetchEnd,
        syncedAt,
        refreshVersion: refresh.refreshVersion,
      }).onConflictDoUpdate({
        target: trainingAccounts.userId,
        set: {
          provider: user.training.provider,
          accountId,
          credentialRef: userId,
          snapshotJson: JSON.stringify(workouts),
          startDate: fetchStart,
          endDate: fetchEnd,
          syncedAt,
          refreshVersion: refresh.refreshVersion,
        },
        setWhere: lt(trainingAccounts.refreshVersion, refresh.refreshVersion),
      }).run();
      account = getAccount(db, userId);
    } catch (error) {
      if (error instanceof finalSurge.AccountMismatchError) throw error;
      failed = true;
    }
  }
  const latest = getAccount(db, userId);
  const stale = failed || !fresh(latest);
  return {
    provider: user.training.provider, timezone, start, end, stale,
    warning: stale ? "Training provider unavailable; cached data may be incomplete or outdated" : null,
    syncedAt: latest?.syncedAt ?? null,
    workouts: (JSON.parse(latest?.snapshot ?? "[]") as Workout[]).filter(workout => workout.date >= start && workout.date <= end),
  };
}
