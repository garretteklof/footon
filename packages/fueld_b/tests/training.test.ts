import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixture, closeFixtures } from "./training-fixture";
import { trainingPlan, getAccount } from "../src/training/plans";
import { getWorkouts } from "../src/training/final-surge";
import { resolveIdentity, linkIdentity, setUserTimezone } from "../src/users";
import { openDatabase } from "../src/database";

beforeEach(() => setSystemTime(new Date("2026-10-20T12:00:00Z")));
afterEach(() => { closeFixtures(); setSystemTime(); });

test("one normalized snapshot preserves genuine names, planned metrics, races, and unknown values", async () => {
  const x = fixture();
  x.state.items = [
    { workout_date: "2026-10-20", name: "Workout", workout_status_text: "Planned", is_race: true, private_field: "discard",
      Activities: [{ activity_type_name: "Run", planned_amount: 8, planned_amount_type: "mi", amount: 9 }] },
    { workout_date: "2026-10-21", name: "Rest Day", workout_status_text: null, Activities: [] },
  ];
  const result = await x.connect();
  expect(result.sync.workouts).toEqual([
    { date: "2026-10-20", name: "Workout", description: null, status: "planned", isRace: true, activities: [{ activityType: "Run", plannedAmount: 8, plannedAmountUnit: "mi" }] },
    { date: "2026-10-21", name: "Rest Day", description: null, status: "unknown", isRace: null, activities: [] },
  ]);
  const stored = getAccount(x.db, x.alice)!.snapshot!;
  expect(JSON.parse(stored)).toEqual(result.sync.workouts);
  expect(stored).not.toContain("workout_date"); expect(stored).not.toContain("private_field"); expect(stored).not.toContain("amount_type");
});
test("cached reads, TTL, forced refresh, and failure fallback retain the last successful timestamp", async () => {
  const x = fixture(); await x.connect();
  expect(x.state.ranges[0]).toEqual(["2026-10-19", "2026-11-01"]);
  await trainingPlan(x.db, x.alice, "week", x.secrets, x.http); expect(x.state.ranges).toHaveLength(1);
  x.db.query("UPDATE training_accounts SET synced_at=? WHERE user_id=?").run("2026-10-20T11:00:00Z", x.alice);
  await trainingPlan(x.db, x.alice, "week", x.secrets, x.http); expect(x.state.ranges).toHaveLength(2);
  const syncedAt = getAccount(x.db, x.alice)!.syncedAt; x.state.unavailable = true;
  const stale = await trainingPlan(x.db, x.alice, "refresh", x.secrets, x.http);
  expect(stale.stale).toBe(true); expect(stale.workouts).toHaveLength(1); expect(stale.syncedAt).toBe(syncedAt);
  expect(JSON.stringify(stale)).not.toContain("503");
});
test("successful refresh replaces deleted/moved workouts and invalid payloads preserve the snapshot", async () => {
  const x = fixture(); await x.connect(); const old = getAccount(x.db, x.alice)!.snapshot;
  x.state.items = [{ workout_date: "2026-02-30" }];
  expect((await trainingPlan(x.db, x.alice, "refresh", x.secrets, x.http)).stale).toBe(true);
  expect(getAccount(x.db, x.alice)!.snapshot).toBe(old);
  x.state.items = [{ workout_date: "2026-10-22", name: "Moved" }];
  expect((await trainingPlan(x.db, x.alice, "refresh", x.secrets, x.http)).workouts[0].date).toBe("2026-10-22");
  x.state.items = [];
  expect((await trainingPlan(x.db, x.alice, "refresh", x.secrets, x.http)).workouts).toEqual([]);
});
test("replacement snapshots intentionally discard older history", async () => {
  const x = fixture(); await x.connect();
  x.state.items = [{ workout_date: "2026-10-11", name: "Chicago", is_race: true, workout_status_text: "Completed" }];
  expect((await trainingPlan(x.db, x.alice, { date: "2026-10-11" }, x.secrets, x.http)).workouts[0].isRace).toBe(true);
  x.state.items = [{ workout_date: "2026-12-13", name: "Marathon", is_race: true }];
  expect((await trainingPlan(x.db, x.alice, { date: "2026-12-13" }, x.secrets, x.http)).workouts[0].status).toBe("unknown");
  x.state.unavailable = true;
  const past = await trainingPlan(x.db, x.alice, { date: "2026-10-11" }, x.secrets, x.http);
  expect(past.stale).toBe(true); expect(past.workouts).toEqual([]);
});
test("linked identities reuse the resolved user; accounts and provider selection remain isolated", async () => {
  const x = fixture(); await x.connect(); await x.connect(x.bob, "bob");
  linkIdentity(x.db, x.alice, "hermex", "also-alice");
  const linked = resolveIdentity(x.db, "hermex", "also-alice").userId;
  await trainingPlan(x.db, linked, "refresh", x.secrets, x.http);
  await trainingPlan(x.db, x.bob, "refresh", x.secrets, x.http);
  expect(x.state.tokens.slice(-2)).toEqual(["Bearer token-alice", "Bearer token-bob"]);
  x.db.query("UPDATE training_accounts SET provider='unsupported' WHERE user_id=?").run(x.alice);
  await expect(trainingPlan(x.db, x.alice, "week", x.secrets, x.http)).rejects.toThrow("Unsupported");
});
test("switching external accounts never exposes the previous account snapshot", async () => {
  const x = fixture(); await x.connect(); x.state.unavailable = true;
  const changed = await x.connect(x.alice, "different");
  expect(changed.sync.stale).toBe(true); expect(changed.sync.workouts).toEqual([]);
  expect(getAccount(x.db, x.alice)!.accountId).toBe("external-different");
});
test("local timezone determines the week and request bounds are validated", async () => {
  const x = fixture(); await x.connect();
  setUserTimezone(x.db, x.alice, "America/Chicago"); setSystemTime(new Date("2026-10-19T02:00:00Z"));
  const result = await trainingPlan(x.db, x.alice, "refresh", x.secrets, x.http);
  expect(result.start).toBe("2026-10-12"); expect(result.end).toBe("2026-10-25");
  for (const days of [0, 91, 1.5]) await expect(trainingPlan(x.db, x.alice, { days }, x.secrets, x.http)).rejects.toThrow("days");
  await expect(trainingPlan(x.db, x.alice, { date: "2026-02-30" }, x.secrets, x.http)).rejects.toThrow("YYYY-MM-DD");
});
test("native-secret login is shared per connection and retries authentication once", async () => {
  const x = fixture(), account = await x.seed();
  await Promise.all([getWorkouts(account, "2026-10-19", "2026-11-01", x.secrets, x.http), getWorkouts(account, "2026-10-19", "2026-11-01", x.secrets, x.http)]);
  expect(x.state.logins).toEqual(["alice"]);
  x.state.status = [401];
  await getWorkouts(account, "2026-10-19", "2026-11-01", x.secrets, x.http);
  expect(x.state.logins).toEqual(["alice", "alice"]);
});
test("mismatched login accounts and rate limiting fail safely with cooldowns", async () => {
  const x = fixture(), a = await x.seed();
  x.values.set(a.credentialRef, JSON.stringify({ email: "different", password: "pw" }));
  await expect(getWorkouts(a, "2026-10-19", "2026-11-01", x.secrets, x.http)).rejects.toThrow("does not match");
  await expect(getWorkouts(a, "2026-10-19", "2026-11-01", x.secrets, x.http)).rejects.toThrow("retry later");
  const y = fixture(), b = await y.seed(); y.state.status = [429];
  await expect(getWorkouts(b, "2026-10-19", "2026-11-01", y.secrets, y.http)).rejects.toThrow("request failed");
  await expect(getWorkouts(b, "2026-10-19", "2026-11-01", y.secrets, y.http)).rejects.toThrow("retry later");
  expect(y.state.ranges).toHaveLength(1);
});
test("SQLite ordering prevents an older response overwriting newer results across connections", async () => {
  const directory = mkdtempSync(join(tmpdir(), "training-concurrency-"));
  const path = join(directory, "cache.sqlite"), x = fixture(path);
  const other = openDatabase(path);
  try {
    await x.connect();
    const releases: ((response: Response) => void)[] = [];
    const http = (async (_url: unknown) => new Promise<Response>(resolve => releases.push(resolve))) as typeof fetch;
    const older = trainingPlan(x.db, x.alice, "refresh", x.secrets, http);
    while (releases.length < 1) await Bun.sleep(1);
    const newer = trainingPlan(other, x.alice, "refresh", x.secrets, http);
    while (releases.length < 2) await Bun.sleep(1);
    releases[1](Response.json({ data: [{ workout_date: "2026-10-21", name: "New" }] }));
    await newer;
    releases[0](Response.json({ data: [{ workout_date: "2026-10-21", name: "Old" }] }));
    const result = await older;
    expect(result.workouts[0].name).toBe("New");
    expect(JSON.parse(getAccount(other, x.alice)!.snapshot!)[0].name).toBe("New");
  } finally { other.close(); closeFixtures(); rmSync(directory, { recursive: true, force: true }); }
});
test("a failed newest refresh keeps the last snapshot and blocks an older in-flight replacement", async () => {
  const x = fixture(); await x.connect(); const previous = getAccount(x.db, x.alice)!.snapshot;
  const releases: ((response: Response) => void)[] = [];
  const http = (async (_url: unknown) => new Promise<Response>(resolve => releases.push(resolve))) as typeof fetch;
  const older = trainingPlan(x.db, x.alice, "refresh", x.secrets, http);
  while (releases.length < 1) await Bun.sleep(1);
  const newer = trainingPlan(x.db, x.alice, "refresh", x.secrets, http);
  while (releases.length < 2) await Bun.sleep(1);
  releases[1](new Response(null, { status: 503 }));
  expect((await newer).stale).toBe(true);
  releases[0](Response.json({ data: [{ workout_date: "2026-10-21", name: "Obsolete" }] }));
  await older;
  expect(getAccount(x.db, x.alice)!.snapshot).toBe(previous);
});
