# @footon/mcp

The local stdio MCP application used by Hermes. It composes `@footon/fuel` and `@footon/blocks`; neither domain package depends on this application or on the other domain.

Run it from the repository root with `bun run start:mcp`. The legacy `bun run start:fueld_b` command remains as an alias for existing Hermes configuration.

Configuration and SQLite locations are local to the monorepo:

- The server reads `packages/fuel/config.local.json`; it must contain `fdcApiKey` and exactly two entries in `users`. Each user needs `name`, `phone`, and an IANA `timezone`; `training` credentials remain optional. The file contains credentials and must not be committed. The server sets it to owner-only permissions at startup. The duplicate `packages/blocks/config.local.json` is not read by the server.
- The server stores SQLite at `mcp/data/herm.sqlite` and creates the directory/file on startup. Fuel owns `food_logs`; Blocks owns `training_accounts`. Both tables use the same database file.

The server keeps its existing tool names, trusted BlueBubbles sender metadata key, owner checks, and stdio transport. Run it only as a local child of the trusted Hermes host.

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

Hermes supplies the BlueBubbles sender in MCP `_meta`. Private tools accept direct messages only. The server maps the sender phone number to a configured user. Tool inputs do not accept user IDs. Unknown senders fail closed.

The server creates the SQLite directory and file when it starts. It sets owner-only permissions and keeps WAL files in the same directory. Fuel owns `food_logs`. Blocks owns `training_accounts`. The two tables use the same database file.

The tests use temporary databases and mocked USDA and Final Surge responses. The live USDA test is skipped by default. Set `FOOD_DATA_CENTRAL_LIVE_TEST=1` to enable it explicitly; do not set this variable during offline checks.
