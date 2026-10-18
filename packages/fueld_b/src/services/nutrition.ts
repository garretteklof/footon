import type { NutritionRepository } from "../db/repositories";
import type { FoodDataCentralClient } from "./food-data-central";
import { isValidTimeZone, utcRangeForLocalDay } from "../time";

export class NutritionService {
  constructor(private readonly repository: NutritionRepository, private readonly foods: FoodDataCentralClient) {}

  resolveIdentity(provider: string, externalId: string) {
    return this.repository.resolveIdentity(provider, externalId);
  }

  linkIdentity(userId: string, provider: string, externalId: string) {
    return this.repository.linkIdentity(userId, provider, externalId);
  }

  async updateEntry(input: {
    userId: string;
    entryId: string;
    quantityG?: number;
    fdcId?: number;
    consumedAt?: string;
  }) {
    if (input.quantityG !== undefined && (!Number.isFinite(input.quantityG) || input.quantityG <= 0)) {
      return { success: false as const, error: { code: "invalid_input" as const, message: "quantityG must be greater than zero" } };
    }
    if (input.fdcId !== undefined && (!Number.isInteger(input.fdcId) || input.fdcId <= 0)) {
      return { success: false as const, error: { code: "invalid_input" as const, message: "fdcId must be a positive integer" } };
    }
    if (input.quantityG === undefined && input.fdcId === undefined && input.consumedAt === undefined) {
      return { success: false as const, error: { code: "invalid_input" as const, message: "Provide at least one field to update" } };
    }
    let consumedAt: string | undefined;
    if (input.consumedAt !== undefined) {
      const parsed = new Date(input.consumedAt);
      if (Number.isNaN(parsed.getTime())) {
        return { success: false as const, error: { code: "invalid_input" as const, message: "consumedAt must be a valid ISO date/time" } };
      }
      consumedAt = parsed.toISOString();
    }

    const current = this.repository.getFoodLogForUser(input.userId, input.entryId);
    if (!current.success) return current;

    if (input.fdcId !== undefined && input.fdcId !== current.entry.fdcId) {
      let selected: Awaited<ReturnType<FoodDataCentralClient["getFoodNutrients"]>>;
      try {
        selected = await this.foods.getFoodNutrients(input.fdcId);
      } catch {
        return { success: false as const, error: { code: "food_lookup_failed" as const, message: "Could not load nutrients for the explicitly selected USDA food; the entry was not changed" } };
      }
      if (selected.food.fdcId !== input.fdcId) {
        return { success: false as const, error: { code: "food_lookup_failed" as const, message: "USDA returned a different food than the explicitly selected FDC ID" } };
      }
      return this.repository.updateFoodLog(input.userId, input.entryId, {
        fdcId: selected.food.fdcId,
        foodName: selected.food.description,
        quantityG: input.quantityG,
        consumedAt,
        nutrientsPer100g: selected.nutrientsPer100g,
      });
    }

    return this.repository.updateFoodLog(input.userId, input.entryId, {
      quantityG: input.quantityG,
      consumedAt,
    });
  }

  deleteEntry(userId: string, entryId: string) {
    return this.repository.deleteFoodLog(userId, entryId);
  }

  setUserTimezone(userId: string, timezone: string) {
    if (!isValidTimeZone(timezone)) throw new Error("timezone must be a valid IANA timezone, such as America/Chicago");
    this.repository.setUserTimezone(userId, timezone);
    return { userId, timezone };
  }

  searchFoods(query: string, pageSize: number) { return this.foods.searchFoods(query, pageSize); }
  getFoodNutrients(fdcId: number) { return this.foods.getFoodNutrients(fdcId); }

  async logFood(input: { userId: string; fdcId: number; quantityG: number; consumedAt?: string }) {
    if (!Number.isFinite(input.quantityG) || input.quantityG <= 0) throw new Error("quantityG must be greater than zero");
    this.repository.assertUserExists(input.userId);
    const consumedAt = input.consumedAt ? new Date(input.consumedAt) : new Date();
    if (Number.isNaN(consumedAt.getTime())) throw new Error("consumedAt must be a valid ISO date/time");
    const { food, nutrientsPer100g } = await this.foods.getFoodNutrients(input.fdcId);
    const logId = this.repository.logFood({
      userId: input.userId, fdcId: food.fdcId, foodName: food.description,
      quantityG: input.quantityG, consumedAt: consumedAt.toISOString(), nutrientsPer100g,
    });
    return { logId, food, quantityG: input.quantityG, consumedAt: consumedAt.toISOString(), nutrientsPer100g };
  }

  dailySummary(userId: string, date: string) {
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error("date must use YYYY-MM-DD format");
    }
    const timezone = this.repository.getUserTimezone(userId);
    const { start, end } = utcRangeForLocalDay(date, timezone);
    return this.repository.dailySummary(userId, date, timezone, start, end);
  }
}
