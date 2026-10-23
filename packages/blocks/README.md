# @footon/blocks

Training services for Footon. This package normalizes Final Surge workouts, applies local-date ranges, and stores snapshots in `training_accounts`. It owns the training Drizzle schemas, persistence, and provider refresh logic.

The package is Bun-first. Import its public API with:

```ts
import { openStorage, upsertUsers } from "@footon/storage";
import { trainingPlan } from "@footon/blocks";

const storage = openStorage();
const user = {
  id: "alex",
  timezone: "America/Chicago",
  training: { provider: "final-surge" as const, email: "…", password: "…" },
};
try {
  upsertUsers(storage.db, [{ id: user.id, name: "Alex", timezone: user.timezone }]);
  const plan = await trainingPlan(storage.db, user, "week");
} finally {
  storage.close();
}
```

Provider refresh occurs only when a caller invokes the package API. This package does not depend on MCP, Fuel, or Garmin.
