import { describe, expect, test } from "bun:test";
import { FoodDataCentralClient } from "../src/services/food-data-central";

const fdcApiKey = process.env.FDC_API_KEY;

describe("FoodDataCentralClient", () => {
  test("searches and normalizes food results", async () => {
    const fetcher = async (input: URL | RequestInfo) => {
      expect(String(input)).toContain("api_key=test-key");
      return Response.json({ foods: [{ fdcId: 123, description: "Apple", dataType: "Foundation" }] });
    };
    const client = new FoodDataCentralClient("test-key", fetcher);
    expect(await client.searchFoods("apple")).toEqual([{ fdcId: 123, description: "Apple", dataType: "Foundation", brandOwner: null }]);
  });

  test("maps USDA nutrient numbers and reports API errors", async () => {
    const fetcher = async () => Response.json({
      fdcId: 123, description: "Apple", foodNutrients: [
        { nutrient: { number: "208" }, amount: 52 }, { nutrient: { number: "203" }, amount: 0.3 },
      ],
    });
    const result = await new FoodDataCentralClient("key", fetcher).getFoodNutrients(123);
    expect(result.nutrientsPer100g.caloriesKcal).toBe(52);
    expect(result.nutrientsPer100g.proteinG).toBe(0.3);
    await expect(new FoodDataCentralClient("key", async () => new Response("", { status: 503 })).searchFoods("apple"))
      .rejects.toThrow("HTTP 503");
  });

  test("redacts request details from network errors", async () => {
    const secret = "secret-test-key";
    const fetcher = async () => { throw new Error(`request failed for api_key=${secret}`); };
    await expect(new FoodDataCentralClient(secret, fetcher).searchFoods("apple"))
      .rejects.toThrow("USDA FoodData Central request failed (network or timeout)");
    await expect(new FoodDataCentralClient(secret, fetcher).searchFoods("apple"))
      .rejects.not.toThrow(secret);
  });

  test.skipIf(!fdcApiKey)("queries live USDA search and nutrient endpoints when FDC_API_KEY is set", async () => {
    try {
      const client = new FoodDataCentralClient(fdcApiKey!);
      const foods = await client.searchFoods("apple", 1);
      expect(foods.length).toBeGreaterThan(0);
      const details = await client.getFoodNutrients(foods[0].fdcId);
      expect(details.food.fdcId).toBe(foods[0].fdcId);
      expect(details.nutrientsPer100g.caloriesKcal).not.toBeNull();
    } catch {
      // Avoid surfacing fetch errors that could include request URLs or credentials.
      throw new Error("Live USDA integration failed; check connectivity and FDC_API_KEY configuration.");
    }
  });
});
