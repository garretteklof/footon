import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture, closeFixtures } from "./training-fixture";
import { getWorkouts } from "../src/training/final-surge";
import { getAccount, trainingPlan } from "../src/training/plans";
import { openDatabase } from "../src/db/database";

beforeEach(() => setSystemTime(new Date("2026-10-20T12:00:00Z")));
afterEach(() => { closeFixtures(); setSystemTime(); });

test("configured credentials authenticate once and only normalized workouts enter SQLite", async () => {
  const x = fixture();
  x.state.items = [
    { workout_date: "2026-10-20", name: "Workout", workout_status_text: "Planned", is_race: true, private_field: "discard",
      Activities: [{ activity_type_name: "Run", planned_amount: 8, planned_amount_type: "mi", amount: 9 }] },
    { workout_date: "2026-10-21", name: "Rest Day", workout_status_text: null, Activities: [] },
  ];
  const result = await x.plan();
  expect(result.workouts).toEqual([
    { date: "2026-10-20", name: "Workout", description: null, status: "planned", isRace: true, activities: [{ activityType: "Run", plannedAmount: 8, plannedAmountUnit: "mi" }] },
    { date: "2026-10-21", name: "Rest Day", description: null, status: "unknown", isRace: null, activities: [] },
  ]);
  const cached = getAccount(x.db, x.alice)!.snapshot!;
  expect(JSON.parse(cached)).toEqual(result.workouts);
  expect(cached).not.toContain("workout_date"); expect(cached).not.toContain("private_field");
  expect(JSON.stringify(result)).not.toContain("private-password");
  expect(x.state.logins).toEqual([x.aliceUser.training!.email]);
});

test("cache TTL, explicit refresh, and stale fallback preserve the last successful timestamp", async () => {
  const x = fixture(); await x.plan();
  expect(x.state.ranges[0]).toEqual(["2026-10-19", "2026-11-01"]);
  await x.plan(x.aliceUser, "week"); expect(x.state.ranges).toHaveLength(1);
  x.db.query("UPDATE training_accounts SET synced_at=? WHERE user_id=?").run("2026-10-20T11:00:00Z", x.alice);
  await x.plan(x.aliceUser, "week"); expect(x.state.ranges).toHaveLength(2);
  const syncedAt = getAccount(x.db, x.alice)!.syncedAt; x.state.unavailable = true;
  const stale = await x.plan(x.aliceUser, "refresh");
  expect(stale.stale).toBe(true); expect(stale.workouts).toHaveLength(1); expect(stale.syncedAt).toBe(syncedAt);
});

test("invalid provider data preserves the old cache, while a successful refresh replaces it", async () => {
  const x = fixture(); await x.plan(); const old = getAccount(x.db, x.alice)!.snapshot;
  x.state.items = [{ workout_date: "2026-02-30" }];
  expect((await x.plan(x.aliceUser, "refresh")).stale).toBe(true);
  expect(getAccount(x.db, x.alice)!.snapshot).toBe(old);
  x.state.items = [{ workout_date: "2026-10-22", name: "Moved" }];
  expect((await x.plan(x.aliceUser, "refresh")).workouts[0].name).toBe("Moved");
});

test("one user's cache and Final Surge session cannot be read by the other user", async () => {
  const x = fixture();
  x.state.items = [{ workout_date: "2026-10-20", name: "Alice plan" }];
  await x.plan(x.aliceUser, "refresh");
  x.state.items = [{ workout_date: "2026-10-20", name: "Bob plan" }];
  await x.plan(x.bobUser, "refresh");
  expect(x.state.tokens.slice(-2)).toEqual(["Bearer token-" + x.aliceUser.training!.email, "Bearer token-" + x.bobUser.training!.email]);
  expect(getAccount(x.db, x.alice)!.accountId).not.toBe(getAccount(x.db, x.bob)!.accountId);
  expect((await x.plan(x.aliceUser, "week")).workouts[0].name).toBe("Alice plan");
  expect((await x.plan(x.bobUser, "week")).workouts[0].name).toBe("Bob plan");
});

test("account changes fail closed instead of serving the prior account's snapshot", async () => {
  const x = fixture(); await x.plan();
  const changed = { ...x.aliceUser, training: { ...x.aliceUser.training!, email: "different-account" } };
  x.state.unavailable = true;
  await expect(x.plan(changed, "refresh")).rejects.toThrow("does not match");
});

test("the same Final Surge account cannot be assigned to both users", async () => {
  const x = fixture(); await x.plan();
  const duplicate = { ...x.bobUser, training: x.aliceUser.training! };
  await expect(x.plan(duplicate, "refresh")).rejects.toThrow("another user");
  expect(getAccount(x.db, x.bob)!.snapshot).toBeNull();
});

test("Final Surge retries expired sessions once and applies rate-limit cooldowns", async () => {
  const x = fixture();
  await getWorkouts(x.aliceUser, null, "2026-10-19", "2026-11-01", x.http);
  expect(x.state.logins).toEqual([x.aliceUser.training!.email]);
  x.state.status = [401];
  await getWorkouts(x.aliceUser, null, "2026-10-19", "2026-11-01", x.http);
  expect(x.state.logins).toEqual([x.aliceUser.training!.email, x.aliceUser.training!.email]);
  const y = fixture(); y.state.status = [429];
  await expect(y.plan()).resolves.toMatchObject({ stale: true });
  await expect(y.plan()).resolves.toMatchObject({ stale: true });
  expect(y.state.ranges).toHaveLength(1);
});

test("local timezone controls week and date bounds are validated", async () => {
  const x = fixture();
  setSystemTime(new Date("2026-10-19T02:00:00Z"));
  const result = await x.plan(x.aliceUser, "refresh");
  expect(result.start).toBe("2026-10-12"); expect(result.end).toBe("2026-10-25");
  for (const days of [0, 91, 1.5]) await expect(x.plan(x.aliceUser, { days })).rejects.toThrow("days");
  await expect(x.plan(x.aliceUser, { date: "2026-02-30" })).rejects.toThrow("YYYY-MM-DD");
});

test("SQLite refresh ordering prevents older responses replacing newer snapshots", async () => {
  const directory = mkdtempSync(join(tmpdir(), "training-concurrency-"));
  const x = fixture(join(directory, "cache.sqlite")), other = openDatabase(join(directory, "cache.sqlite"));
  try {
    await x.plan();
    const releases: ((response: Response) => void)[] = [];
    const http = (async (_url: unknown) => new Promise<Response>(resolve => releases.push(resolve))) as typeof fetch;
    const older = trainingPlan(x.db, x.aliceUser, "refresh", http);
    while (releases.length < 1) await Bun.sleep(1);
    const newer = trainingPlan(other, x.aliceUser, "refresh", http);
    while (releases.length < 2) await Bun.sleep(1);
    releases[1](Response.json({ data: [{ workout_date: "2026-10-21", name: "New" }] }));
    await newer;
    releases[0](Response.json({ data: [{ workout_date: "2026-10-21", name: "Old" }] }));
    expect((await older).workouts[0].name).toBe("New");
    expect(JSON.parse(getAccount(other, x.alice)!.snapshot!)[0].name).toBe("New");
  } finally { other.close(); closeFixtures(); rmSync(directory, { recursive: true, force: true }); }
});

test("users without a training provider get a clear error and no cache row", async () => {
  const x = fixture();
  const user = { ...x.aliceUser, training: undefined };
  await expect(x.plan(user, "week")).rejects.toThrow("Training provider not configured");
  expect(getAccount(x.db, user.id)).toBeNull();
});
