# fueld_b

A nutrition tracking MCP server built with TypeScript, Bun, SQLite, and USDA FoodData Central. It uses the official MCP TypeScript server SDK over stdio and can run as its own package or through the Hermarium workspace.

## Requirements

- Bun (current stable)
- USDA FoodData Central API key (`FDC_API_KEY`)

## Setup and run

From the Hermarium root:

```sh
bun install
cp packages/fueld_b/.env.example packages/fueld_b/.env
# Set FDC_API_KEY in packages/fueld_b/.env for local development.
bun run start:fueld_b
```

To run directly from this package directory:

```sh
cd packages/fueld_b
bun install
cp .env.example .env
# Set FDC_API_KEY in .env.
bun run start
```

Bun loads `.env` files for local development. MCP hosts should provide `FDC_API_KEY` in the server process environment. Configure the host to launch `bun run start` with this package as its working directory, or use the package's absolute path in the command. The server writes protocol messages to stdout and diagnostics to stderr. Configure the MCP server and install the skill separately; the skill becomes available in new Hermes sessions after it is copied into the active profile's skills directory. See the Hermes [skills guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md) for profile-specific skill paths.

## Configuration and data

- `FDC_API_KEY` is required. Obtain a key from [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/). Keep it in a local `.env` file or secret environment variable; never commit it.
- `FUELD_B_PATH` optionally overrides the database file. Absolute paths are used as-is; relative paths resolve from this package root.
- The default database is `packages/fueld_b/data/nutrition.sqlite`, resolved from the source package location rather than the process working directory. Its parent directory is created automatically.
- SQLite data, WAL/SHM files, `.env` files, and dependencies are Git-ignored.

The database enables foreign keys, a busy timeout, and WAL mode. File-backed databases are created with owner-only permissions. Versioned migrations live in `src/db/migrations/` and run transactionally at startup.

## MCP tools

- `resolve_identity(platform, externalId, name?)`: Resolve a stable sender ID to its nutrition user. A new platform/sender pair creates a separate user and returns `created: true`; repeated calls return the same user. Use `imessage` or `hermex` for these interfaces and pass their stable sender identifier, not a display name.
- `link_identity(userId, platform, externalId)`: Link an additional identity to a user so both platforms share the same history. Verify that both identities belong to the same person first; this local server does not implement authentication. Link an identity before it is first resolved. If it already belongs to another profile, the tool returns an error and does not merge or move nutrition history.
- `set_user_timezone(userId, timezone)`: Set a user's IANA timezone, such as `America/Chicago`.
- `search_foods(query, pageSize?)`: Search USDA FoodData Central.
- `get_food_nutrients(fdcId)`: Retrieve selected nutrient values per 100 g.
- `log_food(userId, fdcId, quantityG, consumedAt?)`: Fetch USDA nutrients, scale them to the entered grams, and save a nutrient snapshot. Timestamps are normalized to UTC.
- `update_entry(userId, entryId, quantityG?, fdcId?, consumedAt?)`: Correct an existing entry owned by that user. Quantity and consumption-time edits preserve its stored nutrient snapshot; changing `fdcId` requires an explicit selection and stores that selected record's nutrient snapshot. Quantities are grams; `consumedAt` is the only meal-related metadata currently supported by the schema.
- `delete_entry(userId, entryId)`: Delete an owned entry and return the deleted record. Missing and cross-user IDs return structured errors.
- `daily_nutrition_summary(userId, date)`: Summarize entries for `YYYY-MM-DD` in that user's timezone, including DST-aware day boundaries.

Each messaging identity is unique and maps to one user; a user can have multiple identities. Food history and timezone preferences are scoped to the user. FoodData Central values vary by source and can be approximate; this tool is intended for tracking, not medical advice.

Identity mappings are stored in SQLite and survive restarts. Migration `003_identities.sql` copies mappings from the previous `messaging_identities` schema into `identities` without changing users or food logs. Unknown senders receive a new independent user rather than being attached to an existing profile; the resolver reports that creation explicitly. An optional `name` labels that same profile for local selection; it never determines identity or authorization.

## Development

From this package directory, run `bun test` and `bun run typecheck`. From the Hermarium root, use `bun run test` and `bun run typecheck` to run workspace checks. The USDA unit tests use a fake fetch; a live USDA integration test runs when `FDC_API_KEY` is available and sanitizes errors so credentials are not printed.

## Training context

Run `bun run training connect`, select an existing person (or enter your name on first use) and Final Surge, then enter the login credentials. Connection discovers the account identifier and syncs automatically; credentials go into the native OS credential store. No training-specific environment variables or manual user/account IDs are needed. Existing unnamed users can receive a friendly label on their same profile during connection.

Generic training tools are registered alongside nutrition and reuse the same `resolve_identity` result. The standalone training MCP is also available with `bun run start:training` and requires no USDA key. See [TRAINING.md](TRAINING.md) for CLI usage, host identity expectations, caching, compatibility, and unofficial API limitations.
