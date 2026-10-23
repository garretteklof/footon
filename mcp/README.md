# @footon/mcp

The local stdio MCP application used by Hermes. It composes `@footon/fuel` and `@footon/blocks`; neither domain package depends on this application or on the other domain. MCP owns transport, tool registration, request validation, and trusted-sender authorization. Shared SQLite and migration ownership belongs to `@footon/storage`.

Run it from the repository root with `bun run start:mcp`. The legacy `bun run start:fueld_b` command remains as an alias for existing Hermes configuration.

Configuration and SQLite locations are local to the monorepo:

- The server reads the root `config.local.json`; it must contain `fdcApiKey` and exactly two entries in `users`. Each user needs `name`, `phone`, and an IANA `timezone`; `training` credentials remain optional. The file contains credentials, is Git-ignored, and is set to owner-only permissions at startup. Domain packages receive only the settings they need.
- The server opens the shared `packages/storage/db/foot.sqlite` database. Set `FOOTON_DB_PATH` to override it. MCP does not create the database or run migrations at startup; initialize or migrate it explicitly with `bun run db:migrate`.
- Fuel owns the `food_logs` schema and persistence APIs. Blocks owns the training schemas, persistence, and Final Surge refresh behavior. `@footon/storage` provides the shared connection and migration infrastructure.

The server keeps its existing tool names, trusted BlueBubbles sender metadata key, owner checks, and stdio transport. Hermes supplies the sender in MCP `_meta`. Private tools accept direct messages only. The server maps the sender phone number to a configured user. Tool inputs do not accept user IDs. Unknown senders fail closed.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_foods` | Search USDA foods. |
| `get_food_nutrients` | Get nutrient values per 100 g. |
| `log_food` | Store food, quantity, time, and nutrient snapshot. |
| `update_entry` | Edit an owned food record. |
| `delete_entry` | Delete an owned food record. |
| `daily_nutrition_summary` | Return entries and totals for a local day. |
| `getWeeklyTrainingPlan` | Return the current Monday-to-Sunday plan. |
| `getUpcomingWorkouts` | Return workouts for up to 90 days. |
| `getWorkoutForDate` | Return workouts for a local date. |
| `refreshTrainingPlan` | Refresh the current and next training weeks. |

The tests use temporary databases and mocked USDA and Final Surge responses. The live USDA test is skipped by default. Set `FOOD_DATA_CENTRAL_LIVE_TEST=1` to enable it explicitly; do not set this variable during offline checks.
