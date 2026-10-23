# Footon

Bun monorepo for reusable nutrition and training services, composed by a local Hermes MCP application.

## Packages and skills

- [Garmin client](packages/garmin/README.md) — independent Garmin Connect API client.
- [Storage](packages/storage/README.md) — shared SQLite connection and Drizzle migrations.
- [Fuel](packages/fuel/README.md) — nutrition, FoodData Central, and food logs.
- [Blocks](packages/blocks/README.md) — training plans and Final Surge.
- [MCP application](mcp/README.md) — trusted local composition for Hermes.
- [Nutrition skill](.agents/skills/nutrition/SKILL.md)
- [Training skill](.agents/skills/training/SKILL.md)

Fuel and Blocks depend on Storage for a shared Drizzle client. MCP depends on the domain packages and Storage; the database package does not depend on either domain. Garmin remains independent.

## Quick start

Install dependencies with `bun install`. Store application settings in the Git-ignored root `config.local.json`; MCP applies owner-only permissions when it loads the file. The default database is `packages/storage/db/foot.sqlite`. Run `bun run db:migrate` explicitly before starting a fresh database or after adding migrations. For the existing pre-Drizzle database, first run `bun run db:baseline` once, then `bun run db:migrate`.

Start Hermes MCP with `bun run start:mcp`. The legacy `bun run start:fueld_b` command remains available for existing Hermes settings. MCP does not create the database or run migrations at startup. Set `FOOTON_DB_PATH` to use another database file.

Run workspace checks with `bun run typecheck` and `bun run test`. Fuel and Blocks checks also run lint and build. External API tests remain disabled unless explicitly enabled.
