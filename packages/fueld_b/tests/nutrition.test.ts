import { describe, expect, test } from "bun:test";
import { migrate, openDatabase } from "../src/db/database";
import { NutritionRepository } from "../src/db/repositories";
import { NutritionService } from "../src/services/nutrition";
import type { FoodDataCentralClient } from "../src/services/food-data-central";
import { utcRangeForLocalDay } from "../src/time";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const nutrients = { caloriesKcal: 100, proteinG: 5, carbohydratesG: 20, fatG: 2, fiberG: 3, sodiumMg: 10 };

describe("nutrition persistence", () => {
  test("migrates schema and supports many identities for one user", () => {
    const db = openDatabase(":memory:");
    const repo = new NutritionRepository(db);
    const first = repo.resolveIdentity("telegram", "abc");
    const second = repo.resolveIdentity("discord", "xyz");
    repo.linkIdentity(first.userId, "signal", "def");
    expect(repo.resolveIdentity("telegram", "abc").userId).toBe(first.userId);
    expect(repo.resolveIdentity("signal", "def").userId).toBe(first.userId);
    expect(second.userId).not.toBe(first.userId);
    expect(() => repo.linkIdentity(first.userId, "signal", "def")).not.toThrow();
    expect(() => repo.linkIdentity(second.userId, "telegram", "abc")).toThrow("already linked");
    db.close();
  });

  test("adds timezone defaults when upgrading an existing database", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
    db.exec(readFileSync(new URL("../src/db/migrations/001_initial.sql", import.meta.url), "utf8"));
    db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run("001_initial.sql", "2026-01-01T00:00:00.000Z");
    db.query("INSERT INTO users (id, created_at) VALUES (?, ?)").run("existing-user", "2026-01-01T00:00:00.000Z");

    migrate(db);
    expect(db.query<{ timezone: string }, [string]>("SELECT timezone FROM users WHERE id = ?").get("existing-user")?.timezone).toBe("UTC");
    expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM schema_migrations").get()?.count).toBe(2);
    db.close();
  });

  test("scales nutrients by grams and isolates summaries per user and UTC day", () => {
    const migrated = openDatabase(":memory:");
    const repo = new NutritionRepository(migrated);
    const user = repo.resolveIdentity("test", "user-1");
    const other = repo.resolveIdentity("test", "user-2");
    const fakeFoods = {
      getFoodNutrients: async () => ({ food: { fdcId: 9, description: "Example", dataType: "Foundation", brandOwner: null }, nutrientsPer100g: nutrients, source: "test" }),
      searchFoods: async () => [],
    } as unknown as FoodDataCentralClient;
    const service = new NutritionService(repo, fakeFoods);
    return service.logFood({ userId: user.userId, fdcId: 9, quantityG: 50, consumedAt: "2026-01-02T23:00:00-05:00" })
      .then(() => {
        const summary = service.dailySummary(user.userId, "2026-01-03");
        expect(summary.totals.entry_count).toBe(1);
        expect(summary.totals.calories_kcal).toBe(50);
        expect(summary.totals.protein_g).toBe(2.5);
        expect(service.dailySummary(other.userId, "2026-01-03").totals.entry_count).toBe(0);
        expect(service.dailySummary(user.userId, "2026-01-02").totals.entry_count).toBe(0);
        migrated.close();
      });
  });

  test("rejects impossible calendar dates", () => {
    const db = openDatabase(":memory:");
    const repo = new NutritionRepository(db);
    const { userId } = repo.resolveIdentity("test", "date-user");
    const service = new NutritionService(repo, {} as FoodDataCentralClient);
    expect(() => service.dailySummary(userId, "2026-02-30")).toThrow("YYYY-MM-DD");
    expect(() => service.dailySummary("00000000-0000-0000-0000-000000000000", "2026-02-28")).toThrow("User not found");
    db.close();
  });

  test("uses each user's timezone for summaries while storing timestamps in UTC", async () => {
    const db = openDatabase(":memory:");
    const repo = new NutritionRepository(db);
    const first = repo.resolveIdentity("test", "timezone-user-1");
    const second = repo.resolveIdentity("test", "timezone-user-2");
    const fakeFoods = {
      getFoodNutrients: async () => ({ food: { fdcId: 9, description: "Example", dataType: "Foundation", brandOwner: null }, nutrientsPer100g: nutrients, source: "test" }),
      searchFoods: async () => [],
    } as unknown as FoodDataCentralClient;
    const service = new NutritionService(repo, fakeFoods);

    service.setUserTimezone(first.userId, "America/Los_Angeles");
    expect(repo.getUserTimezone(second.userId)).toBe("UTC");
    expect(() => service.setUserTimezone(second.userId, "Mars/Olympus_Mons")).toThrow("IANA timezone");
    expect(() => service.setUserTimezone(second.userId, "+02:00")).toThrow("IANA timezone");

    await service.logFood({ userId: first.userId, fdcId: 9, quantityG: 100, consumedAt: "2026-03-08T07:30:00Z" });
    await service.logFood({ userId: first.userId, fdcId: 9, quantityG: 100, consumedAt: "2026-03-08T08:30:00Z" });
    await service.logFood({ userId: second.userId, fdcId: 9, quantityG: 100, consumedAt: "2026-03-08T07:30:00Z" });

    const firstUserPriorDay = service.dailySummary(first.userId, "2026-03-07");
    const firstUserSpringDay = service.dailySummary(first.userId, "2026-03-08");
    expect(firstUserPriorDay.timezone).toBe("America/Los_Angeles");
    expect(firstUserPriorDay.totals.entry_count).toBe(1);
    expect(firstUserPriorDay.entries[0].consumed_at).toBe("2026-03-08T07:30:00.000Z");
    expect(firstUserSpringDay.totals.entry_count).toBe(1);
    expect(service.dailySummary(second.userId, "2026-03-08").totals.entry_count).toBe(1);
    expect(service.dailySummary(second.userId, "2026-03-07").totals.entry_count).toBe(0);

    db.close();
  });

  test("computes DST-aware local-day ranges", () => {
    expect(utcRangeForLocalDay("2026-03-08", "America/Los_Angeles")).toEqual({
      start: "2026-03-08T08:00:00.000Z", end: "2026-03-09T07:00:00.000Z",
    });
    expect(utcRangeForLocalDay("2026-11-01", "America/Los_Angeles")).toEqual({
      start: "2026-11-01T07:00:00.000Z", end: "2026-11-02T08:00:00.000Z",
    });
  });

  test("updates quantity and consumption time from the stored nutrient snapshot", async () => {
    const db = openDatabase(":memory:");
    const repo = new NutritionRepository(db);
    const { userId } = repo.resolveIdentity("test", "update-owner");
    const entryId = repo.logFood({
      userId, fdcId: 9, foodName: "Original food", quantityG: 50,
      consumedAt: "2026-01-02T12:00:00.000Z", nutrientsPer100g: nutrients,
    });
    let lookups = 0;
    const foods = {
      getFoodNutrients: async () => {
        lookups++;
        return { food: { fdcId: 9, description: "USDA value changed", dataType: "Foundation", brandOwner: null }, nutrientsPer100g: { ...nutrients, caloriesKcal: 999 }, source: "test" };
      },
      searchFoods: async () => [],
    } as unknown as FoodDataCentralClient;
    const service = new NutritionService(repo, foods);

    const updated = await service.updateEntry({ userId, entryId, quantityG: 125, consumedAt: "2026-01-02T13:30:00-05:00" });
    expect(updated.success).toBe(true);
    if (!updated.success) throw new Error(updated.error.message);
    expect(updated.entry).toMatchObject({
      id: entryId, fdcId: 9, foodName: "Original food", quantityG: 125,
      consumedAt: "2026-01-02T18:30:00.000Z",
      nutrients: { caloriesKcal: 125, proteinG: 6.25 },
      nutrientsPer100g: { caloriesKcal: 100, proteinG: 5 },
    });
    expect(lookups).toBe(0);
    db.close();
  });

  test("changes food only for an explicit FDC selection and stores its nutrient snapshot", async () => {
    const db = openDatabase(":memory:");
    const repo = new NutritionRepository(db);
    const { userId } = repo.resolveIdentity("test", "food-correction-owner");
    const entryId = repo.logFood({
      userId, fdcId: 9, foodName: "Original food", quantityG: 50,
      consumedAt: "2026-01-02T12:00:00.000Z", nutrientsPer100g: nutrients,
    });
    const selectedNutrients = { ...nutrients, caloriesKcal: 240, proteinG: 12 };
    let selectedId = 0;
    const foods = {
      getFoodNutrients: async (fdcId: number) => {
        selectedId = fdcId;
        return { food: { fdcId, description: "Explicitly selected food", dataType: "Foundation", brandOwner: null }, nutrientsPer100g: selectedNutrients, source: "test" };
      },
      searchFoods: async () => [],
    } as unknown as FoodDataCentralClient;
    const service = new NutritionService(repo, foods);

    const updated = await service.updateEntry({ userId, entryId, fdcId: 10 });
    expect(updated.success).toBe(true);
    if (!updated.success) throw new Error(updated.error.message);
    expect(selectedId).toBe(10);
    expect(updated.entry).toMatchObject({
      fdcId: 10, foodName: "Explicitly selected food", quantityG: 50,
      nutrients: { caloriesKcal: 120, proteinG: 6 },
      nutrientsPer100g: { caloriesKcal: 240, proteinG: 12 },
    });
    db.close();
  });

  test("deletes an owned entry and returns the deleted record", () => {
    const db = openDatabase(":memory:");
    const repo = new NutritionRepository(db);
    const { userId } = repo.resolveIdentity("test", "delete-owner");
    const entryId = repo.logFood({
      userId, fdcId: 9, foodName: "Food to delete", quantityG: 75,
      consumedAt: "2026-01-02T12:00:00.000Z", nutrientsPer100g: nutrients,
    });
    const service = new NutritionService(repo, {} as FoodDataCentralClient);

    const deleted = service.deleteEntry(userId, entryId);
    expect(deleted).toMatchObject({ success: true, entry: { id: entryId, userId, foodName: "Food to delete", quantityG: 75 } });
    expect(repo.getFoodLogForUser(userId, entryId)).toMatchObject({ success: false, error: { code: "not_found" } });
    db.close();
  });

  test("reports missing entries and prevents cross-user updates or deletion", async () => {
    const db = openDatabase(":memory:");
    const repo = new NutritionRepository(db);
    const owner = repo.resolveIdentity("test", "entry-owner");
    const other = repo.resolveIdentity("test", "entry-other");
    const entryId = repo.logFood({
      userId: owner.userId, fdcId: 9, foodName: "Private food", quantityG: 60,
      consumedAt: "2026-01-02T12:00:00.000Z", nutrientsPer100g: nutrients,
    });
    const service = new NutritionService(repo, {} as FoodDataCentralClient);

    expect(await service.updateEntry({ userId: other.userId, entryId, quantityG: 200 }))
      .toMatchObject({ success: false, error: { code: "forbidden" } });
    expect(service.deleteEntry(other.userId, entryId))
      .toMatchObject({ success: false, error: { code: "forbidden" } });
    expect(repo.getFoodLogForUser(owner.userId, entryId)).toMatchObject({
      success: true, entry: { userId: owner.userId, foodName: "Private food", quantityG: 60 },
    });
    expect(await service.updateEntry({ userId: owner.userId, entryId: "missing-entry", quantityG: 20 }))
      .toMatchObject({ success: false, error: { code: "not_found" } });
    expect(service.deleteEntry(owner.userId, "missing-entry"))
      .toMatchObject({ success: false, error: { code: "not_found" } });
    db.close();
  });

  test("rejects empty and invalid entry corrections without changing the entry", async () => {
    const db = openDatabase(":memory:");
    const repo = new NutritionRepository(db);
    const { userId } = repo.resolveIdentity("test", "invalid-update-owner");
    const entryId = repo.logFood({
      userId, fdcId: 9, foodName: "Stable food", quantityG: 60,
      consumedAt: "2026-01-02T12:00:00.000Z", nutrientsPer100g: nutrients,
    });
    const service = new NutritionService(repo, {} as FoodDataCentralClient);

    for (const input of [
      { userId, entryId },
      { userId, entryId, quantityG: 0 },
      { userId, entryId, quantityG: Number.NaN },
      { userId, entryId, fdcId: -1 },
      { userId, entryId, consumedAt: "not-a-date" },
    ]) {
      expect(await service.updateEntry(input)).toMatchObject({ success: false, error: { code: "invalid_input" } });
    }
    expect(repo.getFoodLogForUser(userId, entryId)).toMatchObject({
      success: true, entry: { foodName: "Stable food", quantityG: 60, consumedAt: "2026-01-02T12:00:00.000Z" },
    });
    db.close();
  });
});
