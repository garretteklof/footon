import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { FootonDb } from "@footon/storage";
import type { FoodDataCentralClient } from "./food-data-central";
import type { Nutrients } from "./types";
import { foodLogs, type FoodLog } from "./db/schema";
import { utcRangeForLocalDay, validateDate } from "./time";

const columns = {
  caloriesKcal: "calories_kcal", proteinG: "protein_g", carbohydratesG: "carbohydrates_g",
  fatG: "fat_g", fiberG: "fiber_g", sodiumMg: "sodium_mg",
} as const;

const scale = (snapshot: Nutrients, grams: number): Nutrients => Object.fromEntries(
  Object.entries(snapshot).map(([key, value]) => [key, value === null ? null : value * grams / 100]),
) as Nutrients;
const invalid = (message: string) => ({ success: false as const, error: { code: "invalid_input" as const, message } });
function entryFromRow(row: FoodLog) {
  if (typeof row.id !== "string") throw new Error("Stored food log entry has no ID");
  const { id, nutrientsJson, ...entry } = row;
  const nutrientsPer100g = JSON.parse(nutrientsJson) as Nutrients;
  return { id, ...entry, nutrientsPer100g, nutrients: scale(nutrientsPer100g, entry.quantityG) };
}
function ownedEntry(db: FootonDb, userId: string, entryId: string) {
  const row = db.select().from(foodLogs).where(eq(foodLogs.id, entryId)).get();
  if (!row || typeof row.id !== "string") return { success: false as const, error: { code: "not_found" as const, message: "Food log entry not found" } };
  if (row.userId !== userId) return { success: false as const, error: { code: "forbidden" as const, message: "Food log entry belongs to another user" } };
  return { success: true as const, entry: entryFromRow(row) };
}

export async function logFood(db: FootonDb, foods: FoodDataCentralClient, input: {
  userId: string; fdcId: number; quantityG: number; consumedAt?: string;
}) {
  if (!Number.isFinite(input.quantityG) || input.quantityG <= 0) throw new Error("quantityG must be greater than zero");
  const consumedAt = new Date(input.consumedAt ?? Date.now());
  if (Number.isNaN(consumedAt.getTime())) throw new Error("consumedAt must be a valid ISO date/time");
  const { food, nutrientsPer100g } = await foods.getFoodNutrients(input.fdcId);
  if (food.fdcId !== input.fdcId) throw new Error("USDA returned a different food than the explicitly selected FDC ID");
  const logId = randomUUID();
  db.insert(foodLogs).values({
    id: logId,
    userId: input.userId,
    fdcId: food.fdcId,
    foodName: food.description,
    quantityG: input.quantityG,
    consumedAt: consumedAt.toISOString(),
    nutrientsJson: JSON.stringify(nutrientsPer100g),
  }).run();
  return { logId, food, quantityG: input.quantityG, consumedAt: consumedAt.toISOString(), nutrientsPer100g };
}

export async function updateEntry(db: FootonDb, foods: FoodDataCentralClient, input: {
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
  return db.transaction(tx => {
    // Recheck after the HTTP request; ownership and the entry may have changed.
    const latest = ownedEntry(tx, input.userId, input.entryId);
    if (!latest.success) return latest;
    const entry = {
      ...latest.entry,
      quantityG: input.quantityG ?? latest.entry.quantityG,
      consumedAt: date?.toISOString() ?? latest.entry.consumedAt,
    };
    if (selected) Object.assign(entry, {
      fdcId: selected.food.fdcId, foodName: selected.food.description, nutrientsPer100g: selected.nutrientsPer100g,
    });
    tx.update(foodLogs).set({
      fdcId: entry.fdcId,
      foodName: entry.foodName,
      quantityG: entry.quantityG,
      consumedAt: entry.consumedAt,
      nutrientsJson: JSON.stringify(entry.nutrientsPer100g),
    }).where(and(eq(foodLogs.id, entry.id), eq(foodLogs.userId, input.userId))).run();
    return { success: true as const, entry: { ...entry, nutrients: scale(entry.nutrientsPer100g, entry.quantityG) } };
  });
}

export function deleteEntry(db: FootonDb, userId: string, entryId: string) {
  return db.transaction(tx => {
    const current = ownedEntry(tx, userId, entryId);
    if (current.success) tx.delete(foodLogs).where(and(eq(foodLogs.id, entryId), eq(foodLogs.userId, userId))).run();
    return current;
  });
}

export function dailySummary(db: FootonDb, userId: string, timezone: string, date: string) {
  validateDate(date);
  const { start, end } = utcRangeForLocalDay(date, timezone);
  const rows = db.select().from(foodLogs).where(and(
    eq(foodLogs.userId, userId),
    gte(foodLogs.consumedAt, start),
    lt(foodLogs.consumedAt, end),
  )).orderBy(asc(foodLogs.consumedAt)).all().map(entryFromRow);
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
