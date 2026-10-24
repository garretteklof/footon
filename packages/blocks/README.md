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

## Athlete data and completed activities

`getAthleteProfile` and `setAthleteProfile` provide one validated profile per user. The profile stores running background, training preferences, goals, personal records, and target races. A personal record stores an event, a time in seconds, and an optional date. A goal stores a description and an optional target date. A target race stores its name, event, date, and an optional goal time.

`recordCompletedActivity` and `getCompletedActivities` provide a small, provider-neutral activity history. Each activity stores its type, start time, local date, timezone, duration, and optional distance, elevation, name, and note. Imported records can include a provider name and stable source key. The source key prevents duplicate imports for the same user and provider.

Completed activities remain separate from scheduled workouts and profile goals. This package does not calculate weekly mileage, readiness, or other derived training statistics.

The profile and activity schemas live in `src/db/athlete-schema.ts`. The package uses the shared `@footon/storage` connection. It does not call Garmin or Final Surge while it records or reads this data.
