import { afterEach, expect, test } from "bun:test";
import { migrateDatabase, openStorage, upsertUsers, type StorageConnection } from "@footon/storage";
import {
  deleteManualObservation,
  getLatestObservation,
  getObservations,
  observationInputSchema,
  recordObservation,
  summarizeVitals,
  updateManualObservation,
} from "../src/index";

const connections: StorageConnection[] = [];
afterEach(() => { for (const connection of connections.splice(0)) connection.close(); });

function fixture() {
  const storage = openStorage(":memory:");
  migrateDatabase(storage.db);
  connections.push(storage);
  upsertUsers(storage.db, [
    { id: "alice", name: "Alice", timezone: "America/Los_Angeles" },
    { id: "bob", name: "Bob", timezone: "UTC" },
  ]);
  return { db: storage.db, sqlite: storage.sqlite };
}

test("observation validation enforces supported metrics, canonical units, and ranges", () => {
  expect(observationInputSchema.safeParse({ metric: "body_weight", value: 68, unit: "kg" }).success).toBe(true);
  expect(observationInputSchema.safeParse({ metric: "body_weight", value: 68, unit: "lb" }).success).toBe(false);
  expect(observationInputSchema.safeParse({ metric: "unsupported", value: 1, unit: "x" }).success).toBe(false);
  expect(observationInputSchema.safeParse({ metric: "fatigue", value: 0, unit: "score_0_10" }).success).toBe(true);
  expect(observationInputSchema.safeParse({ metric: "fatigue", value: 11, unit: "score_0_10" }).success).toBe(false);
  expect(observationInputSchema.safeParse({ metric: "body_weight", value: 0, unit: "kg" }).success).toBe(false);
});

test("recording normalizes UTC time, derives local date across DST, and deduplicates imported keys", () => {
  const { db, sqlite } = fixture();
  const before = recordObservation(db, "alice", "America/Los_Angeles", {
    metric: "body_weight", value: 68, unit: "kg", observedAt: "2026-03-08T07:30:00Z", source: "garmin", sourceKey: "weight-1",
  });
  const after = recordObservation(db, "alice", "America/Los_Angeles", {
    metric: "body_weight", value: 67.8, unit: "kg", observedAt: "2026-03-08T08:30:00Z", source: "garmin", sourceKey: "weight-2",
  });
  const duplicate = recordObservation(db, "alice", "America/Los_Angeles", {
    metric: "body_weight", value: 68, unit: "kg", observedAt: "2026-03-08T07:30:00Z", source: "garmin", sourceKey: "weight-1",
  });
  expect(before).toMatchObject({ observedAt: "2026-03-08T07:30:00.000Z", localDate: "2026-03-07", timezone: "America/Los_Angeles" });
  expect(after.localDate).toBe("2026-03-08");
  expect(duplicate.id).toBe(before.id);
  expect(sqlite.query("SELECT count(*) AS count FROM vitals_observations").get()).toEqual({ count: 2 });
});

test("zero remains a measurement while absent observations and other users stay separate", () => {
  const { db } = fixture();
  const zero = recordObservation(db, "alice", "America/Los_Angeles", { metric: "fatigue", value: 0, unit: "score_0_10" });
  expect(getLatestObservation(db, "alice", "fatigue")?.value).toBe(0);
  expect(getLatestObservation(db, "bob", "fatigue")).toBeUndefined();
  expect(getObservations(db, "bob", { startDate: zero.localDate, endDate: zero.localDate })).toEqual([]);
  expect(summarizeVitals(db, "alice", { startDate: zero.localDate, endDate: zero.localDate }).metrics.fatigue).toMatchObject({ sampleCount: 1, mean: 0, status: "insufficient_data" });
  expect(summarizeVitals(db, "bob", { startDate: zero.localDate, endDate: zero.localDate }).metrics.fatigue).toMatchObject({ sampleCount: 0, mean: null, status: "insufficient_data" });
});

test("only the owning user can update or delete manually entered observations", () => {
  const { db } = fixture();
  const manual = recordObservation(db, "alice", "America/Los_Angeles", { metric: "resting_heart_rate", value: 52, unit: "bpm" });
  const imported = recordObservation(db, "alice", "America/Los_Angeles", { metric: "resting_heart_rate", value: 50, unit: "bpm", source: "garmin", sourceKey: "rhr-1" });
  expect(updateManualObservation(db, "alice", manual.id, { value: 54 }).value).toBe(54);
  expect(() => updateManualObservation(db, "bob", manual.id, { value: 60 })).toThrow();
  expect(() => updateManualObservation(db, "alice", imported.id, { value: 49 })).toThrow();
  expect(deleteManualObservation(db, "bob", manual.id)).toBe(false);
  expect(deleteManualObservation(db, "alice", manual.id)).toBe(true);
  expect(getLatestObservation(db, "alice", "resting_heart_rate")?.value).toBe(50);
});

test("date-range reads and summaries report deterministic per-metric trends", () => {
  const { db } = fixture();
  recordObservation(db, "alice", "America/Los_Angeles", { metric: "body_weight", value: 70, unit: "kg", observedAt: "2026-10-01T15:00:00Z" });
  recordObservation(db, "alice", "America/Los_Angeles", { metric: "body_weight", value: 69, unit: "kg", observedAt: "2026-10-08T15:00:00Z" });
  recordObservation(db, "alice", "America/Los_Angeles", { metric: "sleep_duration", value: 420, unit: "minutes", observedAt: "2026-10-08T15:00:00Z" });
  const range = { startDate: "2026-10-02", endDate: "2026-10-08" };
  expect(getObservations(db, "alice", range).map(row => row.metric)).toEqual(["body_weight", "sleep_duration"]);
  const summary = summarizeVitals(db, "alice", range);
  expect(summary.metrics.body_weight).toMatchObject({ sampleCount: 1, mean: 69, first: 69, latest: 69, change: null, status: "insufficient_data" });
  expect(summary.metrics.sleep_duration).toMatchObject({ sampleCount: 1, mean: 420, status: "insufficient_data" });
  expect(summarizeVitals(db, "alice", { startDate: "2026-10-01", endDate: "2026-10-08" }).metrics.body_weight)
    .toMatchObject({ sampleCount: 2, mean: 69.5, first: 70, latest: 69, change: -1, status: "sufficient_data" });
});

test("invalid timezones and malformed observation timestamps are rejected without writing", () => {
  const { db, sqlite } = fixture();
  expect(() => recordObservation(db, "alice", "Not/A_Timezone", { metric: "fatigue", value: 3, unit: "score_0_10" })).toThrow();
  expect(() => recordObservation(db, "alice", "UTC", { metric: "fatigue", value: 3, unit: "score_0_10", observedAt: "yesterday" })).toThrow();
  expect(() => recordObservation(db, "alice", "UTC", { metric: "fatigue", value: 3, unit: "score_0_10", observedAt: "2026-10-20T15:00:00" })).toThrow();
  expect(sqlite.query("SELECT count(*) AS count FROM vitals_observations").get()).toEqual({ count: 0 });
});
