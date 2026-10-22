import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FoodDataCentralClient } from "../src/food-data-central";

const fdcApiKey = (() => {
  try {
    const value: unknown = JSON.parse(readFileSync(new URL("../../fueld_b/config.local.json", import.meta.url), "utf8"));
    return typeof value === "object" && value !== null && "fdcApiKey" in value && typeof value.fdcApiKey === "string"
      ? value.fdcApiKey
      : "";
  }
  catch { return ""; }
})();

describe("FoodDataCentralClient", () => {
  test("searches and normalizes food results", async () => {
    const fetcher = async (input: Request | string | URL) => {
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

  test.skipIf(!fdcApiKey || process.env.FOOD_DATA_CENTRAL_LIVE_TEST !== "1")(
    "queries live USDA endpoints when explicitly enabled and config.local.json contains an API key",
    async () => {
      try {
        const client = new FoodDataCentralClient(fdcApiKey);
        const foods = await client.searchFoods("apple", 1);
        expect(foods.length).toBeGreaterThan(0);
        const details = await client.getFoodNutrients(foods[0].fdcId);
        expect(details.food.fdcId).toBe(foods[0].fdcId);
        expect(details.nutrientsPer100g.caloriesKcal).not.toBeNull();
      } catch {
        // Avoid surfacing fetch errors that could include request URLs or credentials.
        throw new Error("Live USDA integration failed; check connectivity and the fdcApiKey value in config.local.json.");
      }
    },
  );
});
