import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { logFood, updateEntry, deleteEntry, dailySummary } from "../src/nutrition";
import { FoodDataCentralClient } from "../src/food-data-central";
import { utcRangeForLocalDay } from "../src/time";
import { initializeSchema } from "../src/schema";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new Database(":memory:"); initializeSchema(db); databases.push(db);
  const users = [
    { id: "user-1", name: "Alice", phone: "+15551234567", timezone: "America/Los_Angeles", training: { provider: "final-surge", email: "a", password: "pw" } },
    { id: "user-2", name: "Bob", phone: "+15559876543", timezone: "UTC", training: { provider: "final-surge", email: "b", password: "pw" } },
  ];
  const alice = users[0].id, bob = users[1].id;
  const state = { calls: 0, calories: 100, fail: false, wrongId: false };
  const foods = new FoodDataCentralClient("test", async url => {
    state.calls++;
    if (state.fail) throw new Error("private URL");
    return Response.json({ fdcId: state.wrongId ? 999 : Number(new URL(String(url)).pathname.split("/").at(-1)), description: "Apple", foodNutrients: [
      { nutrient: { number: "208" }, amount: state.calories }, { nutrient: { number: "203" }, amount: 5 },
    ] });
  });
  const log = (userId = alice, quantityG = 100, consumedAt = "2026-01-02T12:00:00Z") => logFood(db, foods, { userId, fdcId: 9, quantityG, consumedAt });
  return { db, alice, bob, foods, state, log, users };
}
test("fresh schema contains only data tables and no calculated nutrient columns", () => {
  const x = fixture();
  expect(x.db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name))
    .toEqual(["food_logs"]);
  expect(x.db.query<{ name: string }, []>("PRAGMA table_info(food_logs)").all().map(row => row.name))
    .toEqual(["id", "user_id", "fdc_id", "food_name", "quantity_g", "consumed_at", "nutrients_json"]);
});
test("user data uses stable configured IDs without a users table", () => {
  const x = fixture();
  expect(x.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()).toBeNull();
});
test("logging scales snapshots and separates users and local days", async () => {
  const x = fixture(); await x.log(x.alice, 50, "2026-01-02T23:00:00-05:00");
  const summary = dailySummary(x.db, x.alice, x.users[0].timezone, "2026-01-02");
  expect(summary.totals).toMatchObject({ entry_count: 1, calories_kcal: 50, protein_g: 2.5, sodium_mg: null });
  expect(summary.entries[0]).toMatchObject({ quantity_g: 50, consumed_at: "2026-01-03T04:00:00.000Z", calories_kcal: 50 });
  expect(dailySummary(x.db, x.alice, x.users[0].timezone, "2026-01-03").totals.entry_count).toBe(0);
  expect(dailySummary(x.db, x.bob, x.users[1].timezone, "2026-01-03").totals.entry_count).toBe(0);
});
test("missing and empty nutrient values remain null; measured zero remains zero", async () => {
  const x = fixture();
  expect(dailySummary(x.db, x.alice, x.users[0].timezone, "2026-01-02").totals).toMatchObject({ entry_count: 0, calories_kcal: null, protein_g: null });
  x.state.calories = 0; await x.log();
  expect(dailySummary(x.db, x.alice, x.users[0].timezone, "2026-01-02").totals).toMatchObject({ calories_kcal: 0, sodium_mg: null });
  x.state.calories = 100; await x.log();
  expect(dailySummary(x.db, x.alice, x.users[0].timezone, "2026-01-02").totals).toMatchObject({ calories_kcal: 100, sodium_mg: null, protein_g: 10 });
});
test("quantity and time edits preserve the original snapshot without another USDA call", async () => {
  const x = fixture(), { logId } = await x.log(x.alice, 50); x.state.calories = 999;
  expect(await updateEntry(x.db, x.foods, { userId: x.alice, entryId: logId, quantityG: 125, consumedAt: "2026-01-02T13:30:00-05:00" }))
    .toMatchObject({ success: true, entry: { quantityG: 125, consumedAt: "2026-01-02T18:30:00.000Z", nutrients: { caloriesKcal: 125 }, nutrientsPer100g: { caloriesKcal: 100 } } });
  expect(x.state.calls).toBe(1);
});
test("explicit replacement stores the selected snapshot and lookup failures preserve the entry", async () => {
  const x = fixture(), { logId } = await x.log(x.alice, 50); x.state.calories = 240;
  expect(await updateEntry(x.db, x.foods, { userId: x.alice, entryId: logId, fdcId: 10 }))
    .toMatchObject({ success: true, entry: { fdcId: 10, nutrients: { caloriesKcal: 120 }, nutrientsPer100g: { caloriesKcal: 240 } } });
  for (const mode of ["fail", "wrongId"] as const) {
    x.state[mode] = true;
    expect(await updateEntry(x.db, x.foods, { userId: x.alice, entryId: logId, fdcId: 11 })).toMatchObject({ success: false, error: { code: "food_lookup_failed" } });
    x.state[mode] = false;
  }
  expect(dailySummary(x.db, x.alice, x.users[0].timezone, "2026-01-02").entries[0]).toMatchObject({ fdc_id: 10, calories_kcal: 120 });
});
test("edits and deletion reject other users and missing entries", async () => {
  const x = fixture(), { logId } = await x.log();
  expect(await updateEntry(x.db, x.foods, { userId: x.bob, entryId: logId, quantityG: 200 })).toMatchObject({ success: false, error: { code: "forbidden" } });
  expect(deleteEntry(x.db, x.bob, logId)).toMatchObject({ success: false, error: { code: "forbidden" } });
  expect(await updateEntry(x.db, x.foods, { userId: x.alice, entryId: "missing", quantityG: 20 })).toMatchObject({ success: false, error: { code: "not_found" } });
  expect(deleteEntry(x.db, x.alice, logId)).toMatchObject({ success: true, entry: { id: logId, nutrients: { caloriesKcal: 100 } } });
  expect(deleteEntry(x.db, x.alice, logId)).toMatchObject({ success: false, error: { code: "not_found" } });
  expect(x.state.calls).toBe(1);
});
test("entry ownership is rechecked after an asynchronous food lookup", async () => {
  const x = fixture(), { logId } = await x.log();
  const foods = new FoodDataCentralClient("test", async () => {
    deleteEntry(x.db, x.alice, logId);
    return Response.json({ fdcId: 10, description: "Replacement", foodNutrients: [] });
  });
  expect(await updateEntry(x.db, foods, { userId: x.alice, entryId: logId, fdcId: 10 })).toMatchObject({ success: false, error: { code: "not_found" } });
});
test("invalid edits, dates, and quantities leave data unchanged", async () => {
  const x = fixture(), { logId } = await x.log();
  for (const changes of [{}, { quantityG: 0 }, { quantityG: NaN }, { fdcId: -1 }, { consumedAt: "bad" }])
    expect(await updateEntry(x.db, x.foods, { userId: x.alice, entryId: logId, ...changes })).toMatchObject({ success: false, error: { code: "invalid_input" } });
  await expect(x.log(x.alice, -1)).rejects.toThrow("quantityG");
  await expect(x.log(x.alice, 10, "bad")).rejects.toThrow("consumedAt");
  expect(() => dailySummary(x.db, x.alice, x.users[0].timezone, "2026-02-30")).toThrow("YYYY-MM-DD");
  expect(dailySummary(x.db, "missing", "UTC", "2026-01-02").entries).toEqual([]);
  expect(dailySummary(x.db, x.alice, x.users[0].timezone, "2026-01-02").entries[0]).toMatchObject({ quantity_g: 100 });
});
test("summaries use independent timezones and DST-aware day boundaries", async () => {
  const x = fixture();
  await x.log(x.alice, 100, "2026-03-08T07:30:00Z"); await x.log(x.alice, 100, "2026-03-08T08:30:00Z");
  expect(dailySummary(x.db, x.alice, x.users[0].timezone, "2026-03-07").totals.entry_count).toBe(1);
  expect(dailySummary(x.db, x.alice, x.users[0].timezone, "2026-03-08").totals.entry_count).toBe(1);
  expect(utcRangeForLocalDay("2026-03-08", "America/Los_Angeles")).toEqual({ start: "2026-03-08T08:00:00.000Z", end: "2026-03-09T07:00:00.000Z" });
  expect(utcRangeForLocalDay("2026-11-01", "America/Los_Angeles")).toEqual({ start: "2026-11-01T07:00:00.000Z", end: "2026-11-02T08:00:00.000Z" });
});
