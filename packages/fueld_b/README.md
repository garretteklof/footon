# fueld_b

Nutrition and training-plan MCP tools for Hermes, built with Bun, SQLite, the MCP SDK, and Zod.

## Run

From the Hermarium root:

```sh
bun install
# Set FDC_API_KEY in your environment or packages/fueld_b/.env.
bun run start:fueld_b
```

From this package, use `bun run start`. Bun loads local `.env` files. An MCP host should launch the server with this package as its working directory and provide `FDC_API_KEY` in its process environment. Protocol messages go to stdout; diagnostics go to stderr.

Training alone requires no USDA key:

```sh
bun run training connect
bun run training upcoming
bun run start:training
```

The full and training-only MCP servers share `src/index.ts`; the latter uses its `--training-only` flag. Both commands work from the root or this package. See [TRAINING.md](TRAINING.md) for connection, credentials, and cache behavior.

## Configuration and storage

- `FDC_API_KEY` is the [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) API key, required only by the full nutrition server.
- `FUELD_B_PATH` optionally overrides the SQLite path. Relative paths resolve from this package; the default is `data/nutrition.sqlite`.
- SQLite initializes directly from `src/schema.sql`. There are no historical migrations or schema compatibility paths. Incompatible schema changes require an explicit reset.
- The four tables are `users`, `identities`, `food_logs`, and `training_accounts`. Foreign keys, WAL, a busy timeout, and owner-only database permissions are enabled.
- Food entries store quantities and historical per-100 g nutrient snapshots. Scaled nutrients and daily totals are calculated when read; missing values remain null.
- Each training connection stores one normalized schedule snapshot, its fetched dates, successful-sync timestamp, and refresh counter. Provider passwords remain in the native OS credential store.

## Identity and tools

Hermes resolves the actual sender with `resolve_identity(platform, externalId, name?)`, using a stable platform identifier such as `imessage` or `hermex`. The optional name is a display label. New senders receive independent profiles; a name never selects or merges another person's history.

The returned `userId` is reused for account-specific tools:

| Tool | Purpose |
|---|---|
| `link_identity(userId, platform, externalId)` | Link another verified identity before it has a separate profile; never move an identity owned by someone else |
| `set_user_timezone(userId, timezone)` | Set an IANA timezone for local nutrition and training dates |
| `search_foods(query, pageSize?)` | Search USDA |
| `get_food_nutrients(fdcId)` | Read selected nutrients per 100 g |
| `log_food(userId, fdcId, quantityG, consumedAt?)` | Record grams consumed, a UTC timestamp, and a nutrient snapshot |
| `update_entry(userId, entryId, quantityG?, fdcId?, consumedAt?)` | Correct an owned entry; quantity/time changes retain its snapshot, while explicit food replacement retrieves a new one |
| `delete_entry(userId, entryId)` | Delete an owned entry and return it, or a structured missing/forbidden error |
| `daily_nutrition_summary(userId, date)` | Entries and totals for a local calendar date, with DST-aware boundaries |
| `getWeeklyTrainingPlan(userId)` | Current Monday–Sunday |
| `getUpcomingWorkouts(userId, days?)` | Today onward, default 14 days, maximum 90 |
| `getWorkoutForDate(userId, date)` | Workouts on a local date |
| `refreshTrainingPlan(userId)` | Force a fetch of the current and following training weeks |

The training-only server exposes identity resolution and the four training tools.

This is a trusted-local-host interface. The Hermes stdio bridge supplies no authenticated sender metadata; Hermes must bind tool calls to the real sender and enforce access. User IDs in tool arguments are not independent proof of identity. Never expose this server directly to untrusted clients, infer ownership from a name, or let a message choose another person's ID.

The companion Hermes skill is installed separately, using the command in the root README. USDA data can be incomplete or approximate.

## Development

```sh
FDC_API_KEY='' bun run test
bun run typecheck
```

Tests cover fresh/reopened databases, identity and ownership, nutrient snapshots and nulls, DST, connection failures and secret rotation, snapshot replacement and stale fallback, concurrent SQLite writers, MCP stdio, and visible/hidden CLI prompts. HTTP and native credential storage are mocked; no live Final Surge login is performed.
