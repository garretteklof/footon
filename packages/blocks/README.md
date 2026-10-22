# @footon/blocks

Training services for Footon. This package normalizes Final Surge workouts, applies local-date ranges, and stores per-user training snapshots in the `training_accounts` SQLite table.

The package is Bun-first. Import its public API with:

```ts
import { trainingPlan } from "@footon/blocks";
```

Install the monorepo dependencies from its root with `bun install`. The MCP application supplies configured user credentials and a SQLite connection. This package does not depend on nutrition or Garmin.
