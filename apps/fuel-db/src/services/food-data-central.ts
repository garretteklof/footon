export interface FdcFoodSummary {
  fdcId: number;
  description: string;
  dataType: string | null;
  brandOwner: string | null;
}

export interface FdcNutrients {
  caloriesKcal: number | null;
  proteinG: number | null;
  carbohydratesG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  [key: string]: number | null;
}

type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

const nutrientKey: Record<string, keyof FdcNutrients> = {
  "208": "caloriesKcal", "203": "proteinG", "205": "carbohydratesG",
  "204": "fatG", "291": "fiberG", "307": "sodiumMg",
};

export class FoodDataCentralClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: FetchLike = (input, init) => fetch(input, init),
    private readonly baseUrl = "https://api.nal.usda.gov/fdc/v1",
  ) {}

  async searchFoods(query: string, pageSize = 10): Promise<FdcFoodSummary[]> {
    const url = new URL(`${this.baseUrl}/foods/search`);
    url.searchParams.set("api_key", this.apiKey);
    const response = await this.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, pageSize }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await this.readJson(response);
    return (body.foods ?? []).map((food: any) => ({
      fdcId: food.fdcId,
      description: food.description,
      dataType: food.dataType ?? null,
      brandOwner: food.brandOwner ?? null,
    }));
  }

  async getFoodNutrients(fdcId: number): Promise<{ food: FdcFoodSummary; nutrientsPer100g: FdcNutrients; source: string }> {
    const url = new URL(`${this.baseUrl}/food/${fdcId}`);
    url.searchParams.set("api_key", this.apiKey);
    const response = await this.request(url, { signal: AbortSignal.timeout(15_000) });
    const food = await this.readJson(response);
    const nutrients: FdcNutrients = {
      caloriesKcal: null, proteinG: null, carbohydratesG: null,
      fatG: null, fiberG: null, sodiumMg: null,
    };
    for (const item of food.foodNutrients ?? []) {
      const key = nutrientKey[String(item.nutrient?.number ?? item.number)];
      const amount = item.amount ?? item.nutrient?.amount;
      if (key && typeof amount === "number") nutrients[key] = amount;
    }
    return {
      food: { fdcId: food.fdcId, description: food.description, dataType: food.dataType ?? null, brandOwner: food.brandOwner ?? null },
      nutrientsPer100g: nutrients,
      source: "USDA FoodData Central; nutrient amounts are treated as per 100 g",
    };
  }

  private async readJson(response: Response): Promise<any> {
    if (!response.ok) throw new Error(`USDA FoodData Central returned HTTP ${response.status}`);
    return await response.json();
  }

  private async request(url: URL, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch {
      // The USDA API key is sent in the URL. Never forward fetch errors that may include it.
      throw new Error("USDA FoodData Central request failed (network or timeout)");
    }
  }
}
