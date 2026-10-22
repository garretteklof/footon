import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { FoodDataCentralClient } from "./food-data-central";
import type { Nutrients } from "./types";
import { utcRangeForLocalDay, validateDate } from "./time";

const columns = {
  caloriesKcal: "calories_kcal", proteinG: "protein_g", carbohydratesG: "carbohydrates_g",
  fatG: "fat_g", fiberG: "fiber_g", sodiumMg: "sodium_mg",
} as const;

const scale = (snapshot: Nutrients, grams: number): Nutrients => Object.fromEntries(
  Object.entries(snapshot).map(([key, value]) => [key, value === null ? null : value * grams / 100]),
) as Nutrients;
const invalid = (message: string) => ({ success: false as const, error: { code: "invalid_input" as const, message } });
const entryColumns = "id, user_id AS userId, fdc_id AS fdcId, food_name AS foodName, quantity_g AS quantityG, consumed_at AS consumedAt, nutrients_json AS nutrientsJson";
type StoredEntry = {
  id: string; userId: string; fdcId: number; foodName: string;
  quantityG: number; consumedAt: string; nutrientsJson: string;
};
function entryFromRow({ nutrientsJson, ...entry }: StoredEntry) {
  const nutrientsPer100g = JSON.parse(nutrientsJson) as Nutrients;
  return { ...entry, nutrientsPer100g, nutrients: scale(nutrientsPer100g, entry.quantityG) };
}
function ownedEntry(db: Database, userId: string, entryId: string) {
  const row = db.query<StoredEntry, [string]>(`SELECT ${entryColumns} FROM food_logs WHERE id=?`).get(entryId);
  if (!row) return { success: false as const, error: { code: "not_found" as const, message: "Food log entry not found" } };
  if (row.userId !== userId) return { success: false as const, error: { code: "forbidden" as const, message: "Food log entry belongs to another user" } };
  return { success: true as const, entry: entryFromRow(row) };
}
export async function logFood(db: Database, foods: FoodDataCentralClient, input: {
  userId: string; fdcId: number; quantityG: number; consumedAt?: string;
}) {
  if (!Number.isFinite(input.quantityG) || input.quantityG <= 0) throw new Error("quantityG must be greater than zero");
  const consumedAt = new Date(input.consumedAt ?? Date.now());
  if (Number.isNaN(consumedAt.getTime())) throw new Error("consumedAt must be a valid ISO date/time");
  const { food, nutrientsPer100g } = await foods.getFoodNutrients(input.fdcId);
  if (food.fdcId !== input.fdcId) throw new Error("USDA returned a different food than the explicitly selected FDC ID");
  const logId = randomUUID();
  db.query("INSERT INTO food_logs VALUES (?,?,?,?,?,?,?)")
    .run(logId, input.userId, food.fdcId, food.description, input.quantityG, consumedAt.toISOString(), JSON.stringify(nutrientsPer100g));
  return { logId, food, quantityG: input.quantityG, consumedAt: consumedAt.toISOString(), nutrientsPer100g };
}
export async function updateEntry(db: Database, foods: FoodDataCentralClient, input: {
  userId: string; entryId: string; quantityG?: number; fdcId?: number; consumedAt?: string;
}) {
  if (input.quantityG !== undefined && (!Number.isFinite(input.quantityG) || input.quantityG <= 0)) return invalid("quantityG must be greater than zero");
  if (input.fdcId !== undefined && (!Number.isInteger(input.fdcId) || input.fdcId <= 0)) return invalid("fdcId must be a positive integer");
  if (input.quantityG === undefined && input.fdcId === undefined && input.consumedAt === undefined) return invalid("Provide at least one field to update");
  const date = input.consumedAt === undefined ? undefined : new Date(input.consumedAt);
  if (date && Number.isNaN(date.getTime())) return invalid("consumedAt must be a valid ISO date/time");
  const current = ownedEntry(db, input.userId, input.entryId);
  if (!current.success) return current;
  let selected: Awaited<ReturnType<FoodDataCentralClient["getFoodNutrients"]>> | undefined;
  if (input.fdcId !== undefined && input.fdcId !== current.entry.fdcId) {
    try {
      selected = await foods.getFoodNutrients(input.fdcId);
      if (selected.food.fdcId !== input.fdcId) throw new Error();
    } catch {
      return { success: false as const, error: { code: "food_lookup_failed" as const,
        message: "Could not load nutrients for the explicitly selected USDA food; the entry was not changed" } };
    }
  }
  return db.transaction(() => {
    // Recheck after the HTTP request; ownership and the entry may have changed.
    const latest = ownedEntry(db, input.userId, input.entryId);
    if (!latest.success) return latest;
    const entry = { ...latest.entry,
      quantityG: input.quantityG ?? latest.entry.quantityG,
      consumedAt: date?.toISOString() ?? latest.entry.consumedAt,
    };
    if (selected) Object.assign(entry, {
      fdcId: selected.food.fdcId, foodName: selected.food.description, nutrientsPer100g: selected.nutrientsPer100g,
    });
    db.query("UPDATE food_logs SET fdc_id=?, food_name=?, quantity_g=?, consumed_at=?, nutrients_json=? WHERE id=? AND user_id=?")
      .run(entry.fdcId, entry.foodName, entry.quantityG, entry.consumedAt, JSON.stringify(entry.nutrientsPer100g), entry.id, input.userId);
    return { success: true as const, entry: { ...entry, nutrients: scale(entry.nutrientsPer100g, entry.quantityG) } };
  })();
}
export function deleteEntry(db: Database, userId: string, entryId: string) {
  return db.transaction(() => {
    const current = ownedEntry(db, userId, entryId);
    if (current.success) db.query("DELETE FROM food_logs WHERE id=? AND user_id=?").run(entryId, userId);
    return current;
  })();
}
export function dailySummary(db: Database, userId: string, timezone: string, date: string) {
  validateDate(date);
  const { start, end } = utcRangeForLocalDay(date, timezone);
  const rows = db.query<StoredEntry, [string, string, string]>(
    `SELECT ${entryColumns} FROM food_logs WHERE user_id=? AND consumed_at>=? AND consumed_at<? ORDER BY consumed_at`,
  ).all(userId, start, end).map(entryFromRow);
  const entries = rows.map(entry => ({
    id: entry.id, fdc_id: entry.fdcId, food_name: entry.foodName,
    quantity_g: entry.quantityG, consumed_at: entry.consumedAt,
    ...Object.fromEntries(Object.entries(columns).map(([key, column]) => [column, entry.nutrients[key as keyof Nutrients]])),
  }));
  const totals = { entry_count: entries.length, ...Object.fromEntries(Object.entries(columns).map(([key, column]) => {
    const values = rows.map(row => row.nutrients[key as keyof Nutrients]).filter((value): value is number => value !== null);
    return [column, values.length ? values.reduce((sum, value) => sum + value, 0) : null];
  })) };
  return { date, timezone, totals, entries };
}
