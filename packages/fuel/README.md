# @footon/fuel

Nutrition services for Footon. This package contains FoodData Central search and nutrient lookup, food logging, edits, deletion, and daily summaries. It owns the Drizzle schema and persistence operations for `food_logs`.

The package is Bun-first. Import its public API with:

```ts
import { FoodDataCentralClient, logFood, dailySummary } from "@footon/fuel";
import { openStorage, upsertUsers } from "@footon/storage";

const storage = openStorage();
try {
  upsertUsers(storage.db, [{ id: "alex", name: "Alex", timezone: "America/Chicago" }]);
  const foods = new FoodDataCentralClient(process.env.FDC_API_KEY ?? "");
  const summary = dailySummary(storage.db, "alex", "America/Chicago", "2026-10-22");
} finally {
  storage.close();
}
```

Food search and nutrient lookup call USDA only when invoked. Logging accepts a database client and a FoodData Central client. This package does not depend on MCP, Blocks, or Garmin.
