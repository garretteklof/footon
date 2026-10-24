# Footon

Bun monorepo for reusable nutrition, training, and physiology services, composed by a local Hermes MCP application.

## Packages and skills

- [Garmin client](packages/garmin/README.md) — independent Garmin Connect API client.
- [Storage](packages/storage/README.md) — shared SQLite connection and Drizzle migrations.
- [Fuel](packages/fuel/README.md) — nutrition, FoodData Central, and food logs.
- [Blocks](packages/blocks/README.md) — training plans and Final Surge.
- [Vitals](packages/vitals/README.md) — physiological observations and simple trend summaries.
- [MCP application](mcp/README.md) — trusted local composition for Hermes.
- [Nutrition skill](.agents/skills/nutrition/SKILL.md)
- [Training skill](.agents/skills/training/SKILL.md)

Fuel, Blocks, and Vitals use Storage for the shared Drizzle client. Blocks owns athletic profiles, goals, records, and completed activities. Vitals owns physiological measurements. MCP composes the domain packages and keeps trusted-sender access. Garmin remains independent.

## Compose domain data

A higher-level application can read each domain and combine the results. It can use the same `FootonDb` connection without a shared context package or a copied timeline.

```ts
import { openStorage } from "@footon/storage";
import { dailySummary } from "@footon/fuel";
import { getAthleteProfile, getCompletedActivities } from "@footon/blocks";
import { getObservations, summarizeVitals } from "@footon/vitals";

const storage = openStorage();
const userId = "alex";
const timezone = "America/Chicago";
const range = { startDate: "2026-10-01", endDate: "2026-10-20" };
try {
  const athleteContext = {
    profile: getAthleteProfile(storage.db, userId),
    activities: getCompletedActivities(storage.db, userId, range),
    nutrition: dailySummary(storage.db, userId, timezone, "2026-10-20"),
    observations: getObservations(storage.db, userId, range),
    vitals: summarizeVitals(storage.db, userId, range),
  };
  console.log(athleteContext);
} finally {
  storage.close();
}
```

## Quick start

Install dependencies with `bun install`. Store application settings in the Git-ignored root `config.local.json`. MCP applies owner-only permissions when it loads the file. The default database is `packages/storage/db/foot.sqlite`. Run `bun run db:migrate` explicitly before starting a fresh database or after adding migrations. For the existing pre-Drizzle database, first run `bun run db:baseline` once, then `bun run db:migrate`.

Start Hermes MCP with `bun run start:mcp`. The legacy `bun run start:fueld_b` command remains available for existing Hermes settings. MCP does not create the database or run migrations at startup. Set `FOOTON_DB_PATH` to use another database file.

Run `bun run typecheck` and `bun run test` for workspace checks. Run a package's `check` script, where available, to run its local checks. Live external API tests remain disabled unless explicitly enabled.
