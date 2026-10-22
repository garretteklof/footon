import type { Nutrients } from "./types";

const nutrientKey: Record<string, keyof Nutrients> = {
  "208": "caloriesKcal", "203": "proteinG", "205": "carbohydratesG",
  "204": "fatG", "291": "fiberG", "307": "sodiumMg",
};
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function summary(food: unknown) {
  if (!object(food) || !Number.isInteger(food.fdcId) || Number(food.fdcId) <= 0 || typeof food.description !== "string") {
    throw new Error("Invalid USDA food response");
  }
  return {
    fdcId: Number(food.fdcId),
    description: food.description,
    dataType: typeof food.dataType === "string" ? food.dataType : null,
    brandOwner: typeof food.brandOwner === "string" ? food.brandOwner : null,
  };
}
export class FoodDataCentralClient {
  constructor(
    private readonly apiKey: string,
    private readonly http: (
      input: Request | string | URL,
      init?: RequestInit
    ) => Promise<Response> = fetch,
  ) {}
  async searchFoods(query: string, pageSize = 10) {
    const body = await this.request("foods/search", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, pageSize }),
    });
    if (!object(body) || !Array.isArray(body.foods)) throw new Error("Invalid USDA search response");
    return body.foods.map(summary);
  }
  async getFoodNutrients(fdcId: number) {
    const food = await this.request(`food/${fdcId}`);
    if (!object(food)) throw new Error("Invalid USDA food response");
    const nutrientsPer100g: Nutrients = {
      caloriesKcal: null, proteinG: null, carbohydratesG: null, fatG: null, fiberG: null, sodiumMg: null,
    };
    const items = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
    for (const item of items) {
      if (!object(item)) continue;
      const nutrient = object(item.nutrient) ? item.nutrient : undefined;
      const key = nutrientKey[String(nutrient?.number ?? item.number)], amount = item.amount ?? nutrient?.amount;
      if (key && typeof amount === "number" && Number.isFinite(amount)) nutrientsPer100g[key] = amount;
    }
    return { food: summary(food), nutrientsPer100g,
      source: "USDA FoodData Central; nutrient amounts are treated as per 100 g" };
  }
  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const url = new URL(`https://api.nal.usda.gov/fdc/v1/${path}`);
    url.searchParams.set("api_key", this.apiKey);
    let response: Response;
    try { response = await this.http(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }); }
    // Fetch errors may include the API key in the URL.
    catch { throw new Error("USDA FoodData Central request failed (network or timeout)"); }
    if (!response.ok) throw new Error(`USDA FoodData Central returned HTTP ${response.status}`);
    return response.json();
  }
}
