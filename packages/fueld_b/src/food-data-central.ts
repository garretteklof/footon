import type { Nutrients } from "./nutrition";

const nutrientKey: Record<string, keyof Nutrients> = {
  "208": "caloriesKcal", "203": "proteinG", "205": "carbohydratesG",
  "204": "fatG", "291": "fiberG", "307": "sodiumMg",
};
function summary(food: any) {
  if (!food || !Number.isInteger(food.fdcId) || food.fdcId <= 0 || typeof food.description !== "string") throw new Error("Invalid USDA food response");
  return { fdcId: food.fdcId as number, description: food.description as string,
    dataType: food.dataType ?? null, brandOwner: food.brandOwner ?? null };
}
export class FoodDataCentralClient {
  constructor(
    private readonly apiKey: string,
    private readonly http: (
      input: Request | string | URL,
      init?: RequestInit
    ) => Promise<Response> = fetch;
  ) {}
  async searchFoods(query: string, pageSize = 10) {
    const body = await this.request("foods/search", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, pageSize }),
    });
    if (!Array.isArray(body.foods)) throw new Error("Invalid USDA search response");
    return body.foods.map(summary);
  }
  async getFoodNutrients(fdcId: number) {
    const food = await this.request(`food/${fdcId}`);
    const nutrientsPer100g: Nutrients = {
      caloriesKcal: null, proteinG: null, carbohydratesG: null, fatG: null, fiberG: null, sodiumMg: null,
    };
    for (const item of food.foodNutrients ?? []) {
      const key = nutrientKey[String(item.nutrient?.number ?? item.number)], amount = item.amount ?? item.nutrient?.amount;
      if (key && typeof amount === "number" && Number.isFinite(amount)) nutrientsPer100g[key] = amount;
    }
    return { food: summary(food), nutrientsPer100g,
      source: "USDA FoodData Central; nutrient amounts are treated as per 100 g" };
  }
  private async request(path: string, init?: RequestInit): Promise<any> {
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
