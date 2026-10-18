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
