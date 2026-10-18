import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

export interface Nutrients {
  caloriesKcal: number | null;
  proteinG: number | null;
  carbohydratesG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  [key: string]: number | null;
}

export interface FoodLogInput {
  userId: string;
  fdcId: number;
  foodName: string;
  quantityG: number;
  consumedAt: string;
  nutrientsPer100g: Nutrients;
}

export interface FoodLogEntry {
  id: string;
  userId: string;
  fdcId: number;
  foodName: string;
  quantityG: number;
  consumedAt: string;
  nutrients: Nutrients;
  nutrientsPer100g: Nutrients;
}

export type EntryMutationResult =
  | { success: true; entry: FoodLogEntry }
  | { success: false; error: { code: "not_found" | "forbidden" | "invalid_input" | "food_lookup_failed"; message: string } };

export interface FoodLogChanges {
  fdcId?: number;
  foodName?: string;
  quantityG?: number;
  consumedAt?: string;
  nutrientsPer100g?: Nutrients;
}

interface FoodLogRow {
  id: string;
  user_id: string;
  fdc_id: number;
  food_name: string;
  quantity_g: number;
  consumed_at: string;
  calories_kcal: number | null;
  protein_g: number | null;
  carbohydrates_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  nutrients_json: string;
}

const toFoodLogEntry = (row: FoodLogRow): FoodLogEntry => ({
  id: row.id,
  userId: row.user_id,
  fdcId: row.fdc_id,
  foodName: row.food_name,
  quantityG: row.quantity_g,
  consumedAt: row.consumed_at,
  nutrients: {
    caloriesKcal: row.calories_kcal,
    proteinG: row.protein_g,
    carbohydratesG: row.carbohydrates_g,
    fatG: row.fat_g,
    fiberG: row.fiber_g,
    sodiumMg: row.sodium_mg,
  },
  nutrientsPer100g: JSON.parse(row.nutrients_json) as Nutrients,
});

const scaleNutrients = (nutrientsPer100g: Nutrients, quantityG: number): Nutrients =>
  Object.fromEntries(Object.entries(nutrientsPer100g).map(([key, value]) => [
    key, value === null ? null : value * quantityG / 100,
  ])) as Nutrients;

const foodLogColumns = `id, user_id, fdc_id, food_name, quantity_g, consumed_at,
  calories_kcal, protein_g, carbohydrates_g, fat_g, fiber_g, sodium_mg, nutrients_json`;

export class NutritionRepository {
  constructor(private readonly db: Database) {}

  assertUserExists(userId: string): void {
    if (!this.db.query("SELECT 1 FROM users WHERE id = ?").get(userId)) {
      throw new Error("User not found; resolve a messaging identity first");
    }
  }

  getUserTimezone(userId: string): string {
    const user = this.db.query<{ timezone: string }, [string]>(
      "SELECT timezone FROM users WHERE id = ?",
    ).get(userId);
    if (!user) throw new Error("User not found; resolve a messaging identity first");
    return user.timezone;
  }

  setUserTimezone(userId: string, timezone: string): void {
    const result = this.db.query("UPDATE users SET timezone = ? WHERE id = ?").run(timezone, userId);
    if (result.changes === 0) throw new Error("User not found; resolve a messaging identity first");
  }

  resolveIdentity(platform: string, externalId: string): { userId: string; created: boolean; status: "created" | "existing" } {
    const existing = this.db.query<{ user_id: string }, [string, string]>(
      "SELECT user_id FROM identities WHERE platform = ? AND external_id = ?",
    ).get(platform, externalId);
    if (existing) return { userId: existing.user_id, created: false, status: "existing" };

    const userId = randomUUID();
    const now = new Date().toISOString();
    const create = this.db.transaction(() => {
      this.db.query("INSERT INTO users (id, created_at) VALUES (?, ?)").run(userId, now);
      this.db.query("INSERT INTO identities (user_id, platform, external_id, created_at) VALUES (?, ?, ?, ?)")
        .run(userId, platform, externalId, now);
    });
    try {
      create();
      return { userId, created: true, status: "created" };
    } catch (error) {
      const raced = this.db.query<{ user_id: string }, [string, string]>(
        "SELECT user_id FROM identities WHERE platform = ? AND external_id = ?",
      ).get(platform, externalId);
      if (raced) return { userId: raced.user_id, created: false, status: "existing" };
      throw error;
    }
  }

  linkIdentity(userId: string, platform: string, externalId: string): void {
    if (!this.db.query("SELECT 1 FROM users WHERE id = ?").get(userId)) throw new Error("User not found");
    const existing = this.db.query<{ user_id: string }, [string, string]>(
      "SELECT user_id FROM identities WHERE platform = ? AND external_id = ?",
    ).get(platform, externalId);
    if (existing) {
      if (existing.user_id !== userId) throw new Error("That messaging identity is already linked to another user");
      return;
    }
    this.db.query("INSERT INTO identities (user_id, platform, external_id, created_at) VALUES (?, ?, ?, ?)")
      .run(userId, platform, externalId, new Date().toISOString());
  }

  logFood(input: FoodLogInput): string {
    this.assertUserExists(input.userId);
    const id = randomUUID();
    const multiplier = input.quantityG / 100;
    const scaled = (value: number | null) => value === null ? null : value * multiplier;
    this.db.query(`INSERT INTO food_logs (
      id, user_id, fdc_id, food_name, quantity_g, consumed_at,
      calories_kcal, protein_g, carbohydrates_g, fat_g, fiber_g, sodium_mg,
      nutrients_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.userId, input.fdcId, input.foodName, input.quantityG, input.consumedAt,
        scaled(input.nutrientsPer100g.caloriesKcal), scaled(input.nutrientsPer100g.proteinG),
        scaled(input.nutrientsPer100g.carbohydratesG), scaled(input.nutrientsPer100g.fatG),
        scaled(input.nutrientsPer100g.fiberG), scaled(input.nutrientsPer100g.sodiumMg),
        JSON.stringify(input.nutrientsPer100g), new Date().toISOString());
    return id;
  }

  getFoodLogForUser(userId: string, entryId: string): EntryMutationResult {
    const row = this.db.query<FoodLogRow, [string]>(`SELECT ${foodLogColumns} FROM food_logs WHERE id = ?`).get(entryId);
    if (!row) return { success: false, error: { code: "not_found", message: "Food log entry not found" } };
    if (row.user_id !== userId) return { success: false, error: { code: "forbidden", message: "Food log entry belongs to another user" } };
    return { success: true, entry: toFoodLogEntry(row) };
  }

  updateFoodLog(userId: string, entryId: string, changes: FoodLogChanges): EntryMutationResult {
    const update = this.db.transaction((): EntryMutationResult => {
      const row = this.db.query<FoodLogRow, [string]>(`SELECT ${foodLogColumns} FROM food_logs WHERE id = ?`).get(entryId);
      if (!row) return { success: false, error: { code: "not_found", message: "Food log entry not found" } };
      if (row.user_id !== userId) return { success: false, error: { code: "forbidden", message: "Food log entry belongs to another user" } };

      const quantityG = changes.quantityG ?? row.quantity_g;
      const nutrientsPer100g = changes.nutrientsPer100g ?? JSON.parse(row.nutrients_json) as Nutrients;
      const nutrients = scaleNutrients(nutrientsPer100g, quantityG);
      this.db.query(`UPDATE food_logs SET fdc_id = ?, food_name = ?, quantity_g = ?, consumed_at = ?,
        calories_kcal = ?, protein_g = ?, carbohydrates_g = ?, fat_g = ?, fiber_g = ?, sodium_mg = ?, nutrients_json = ?
        WHERE id = ? AND user_id = ?`).run(
        changes.fdcId ?? row.fdc_id,
        changes.foodName ?? row.food_name,
        quantityG,
        changes.consumedAt ?? row.consumed_at,
        nutrients.caloriesKcal,
        nutrients.proteinG,
        nutrients.carbohydratesG,
        nutrients.fatG,
        nutrients.fiberG,
        nutrients.sodiumMg,
        JSON.stringify(nutrientsPer100g),
        entryId,
        userId,
      );
      const updated = this.db.query<FoodLogRow, [string, string]>(`SELECT ${foodLogColumns} FROM food_logs WHERE id = ? AND user_id = ?`).get(entryId, userId);
      if (!updated) return { success: false, error: { code: "not_found", message: "Food log entry not found" } };
      return { success: true, entry: toFoodLogEntry(updated) };
    });
    return update();
  }

  deleteFoodLog(userId: string, entryId: string): EntryMutationResult {
    const remove = this.db.transaction((): EntryMutationResult => {
      const row = this.db.query<FoodLogRow, [string]>(`SELECT ${foodLogColumns} FROM food_logs WHERE id = ?`).get(entryId);
      if (!row) return { success: false, error: { code: "not_found", message: "Food log entry not found" } };
      if (row.user_id !== userId) return { success: false, error: { code: "forbidden", message: "Food log entry belongs to another user" } };
      this.db.query("DELETE FROM food_logs WHERE id = ? AND user_id = ?").run(entryId, userId);
      return { success: true, entry: toFoodLogEntry(row) };
    });
    return remove();
  }

  dailySummary(userId: string, date: string, timezone: string, start: string, end: string) {
    this.assertUserExists(userId);
    const totals = this.db.query<{
      entry_count: number; calories_kcal: number | null; protein_g: number | null;
      carbohydrates_g: number | null; fat_g: number | null; fiber_g: number | null; sodium_mg: number | null;
    }, [string, string, string]>(`SELECT COUNT(*) AS entry_count,
      SUM(calories_kcal) AS calories_kcal, SUM(protein_g) AS protein_g,
      SUM(carbohydrates_g) AS carbohydrates_g, SUM(fat_g) AS fat_g,
      SUM(fiber_g) AS fiber_g, SUM(sodium_mg) AS sodium_mg
      FROM food_logs WHERE user_id = ? AND consumed_at >= ? AND consumed_at < ?`).get(userId, start, end)!;
    const entries = this.db.query<{
      id: string; fdc_id: number; food_name: string; quantity_g: number; consumed_at: string;
      calories_kcal: number | null; protein_g: number | null; carbohydrates_g: number | null;
      fat_g: number | null; fiber_g: number | null; sodium_mg: number | null;
    }, [string, string, string]>(`SELECT id, fdc_id, food_name, quantity_g, consumed_at,
      calories_kcal, protein_g, carbohydrates_g, fat_g, fiber_g, sodium_mg
      FROM food_logs WHERE user_id = ? AND consumed_at >= ? AND consumed_at < ? ORDER BY consumed_at`)
      .all(userId, start, end);
    return { date, timezone, totals, entries };
  }
}
