# @footon/fuel

Nutrition services for Footon. This package contains FoodData Central search and nutrient lookup, food logging, edits, deletion, and daily summaries. It owns the `food_logs` SQLite table.

The package is Bun-first. Import its public API with:

```ts
import { FoodDataCentralClient, logFood, dailySummary } from "@footon/fuel";
```

Install the monorepo dependencies from its root with `bun install`. The MCP application supplies the configured USDA API key and SQLite connection. This package does not depend on the training package or Garmin.
