# @footon/mcp

`@footon/mcp` is the local stdio application for Hermes. It composes `@footon/fuel`, `@footon/blocks`, and `@footon/vitals`. None of these domain packages depends on MCP or another domain. MCP owns transport, tool registration, input validation, and trusted-sender authorization. `@footon/storage` owns the shared SQLite connection and migrations.

Run it from the repository root with `bun run start:mcp`. The legacy `bun run start:fueld_b` command remains as an alias for existing Hermes configuration.

Configuration and SQLite locations are local to the monorepo:

- The server reads the root configuration from `config.local.json`. The file must contain `fdcApiKey` and exactly two entries in `users`. Each user needs `name`, `phone`, and an IANA `timezone`. Training credentials are optional. The file contains credentials and is Git-ignored. MCP sets its permissions to owner-only at startup. Domain packages receive only the settings they need.
- The server opens the shared `packages/storage/db/foot.sqlite` database. Set `FOOTON_DB_PATH` to override it. MCP does not create the database or run migrations at startup. Run `bun run db:migrate` before startup when you add migrations.
- Fuel owns the `food_logs` schema and persistence APIs. Blocks owns training, athletic profiles, performance records, goals, and completed activities. Vitals owns physiological observations. `@footon/storage` provides the shared connection and migration infrastructure.

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
| `record_observation` | Record a manual Vitals observation for the trusted sender. |
| `get_observations` | Return Vitals observations for a local-date range. |
| `get_vitals_summary` | Return Vitals means, changes, sample counts, and data sufficiency. |

The Vitals tools resolve the user from the trusted sender. They do not accept user IDs, source names, or source keys. Provider imports use the Vitals package directly, outside MCP.

The tests use temporary databases and mocked USDA and Final Surge responses. The live USDA test is skipped by default. Set `FOOD_DATA_CENTRAL_LIVE_TEST=1` to enable it explicitly. Do not set this variable during offline checks.
