# fueld_b

fueld_b provides nutrition and training tools to Hermes. It supports two statically configured users. Hermes must provide trusted sender metadata for private tools.

## Install and start

From the Hermarium root, install dependencies:

```sh
bun install
```

Create the local configuration file and replace its placeholder values:

```sh
cp packages/fueld_b/config.example.json packages/fueld_b/config.local.json
chmod 600 packages/fueld_b/config.local.json
```

Start the server from the root:

```sh
bun run start:fueld_b
```

The package also supports `bun run dev` for watch mode. The server always exposes nutrition and training tools.

## Configuration and storage

`config.local.json` is the only application configuration file. It must define exactly two users under `users`. Each object key is the user's stable ID. Each user needs a name, phone number, and IANA time zone. fueld_b normalizes phone numbers to E.164 and rejects duplicate numbers.

Set `fdcApiKey` to a USDA FoodData Central API key to use nutrition tools. The server requires this key. See the [USDA API guide](https://fdc.nal.usda.gov/api-guide/).

A user can have an optional `training` object with `provider`, `email`, and `password`. Set `provider` to `final-surge` to enable Final Surge. A user without training configuration can still use all nutrition tools. A training request for that user returns a clear configuration error.

fueld_b reads configuration at startup. Do not commit `config.local.json`. It contains account credentials. The server does not return or log passwords.

SQLite data lives in `packages/fueld_b/data/herm.sqlite`. fueld_b creates the directory and database as needed. The directory uses owner-only permissions. The database file uses owner read/write permissions. SQLite WAL files stay in the same ignored data directory. Food logs and training caches use the configured user IDs. You can delete existing development data. The schema does not support migrations.

fueld_b caches Final Surge sessions in memory. It caches each user’s training schedule in SQLite. fueld_b retries expired sessions and retains a previous schedule if a refresh fails.

## Tools

The server provides these tools:

| Tool | Capability |
|---|---|
| `search_foods` | Search USDA foods. |
| `get_food_nutrients` | Get selected nutrient values per 100 g. |
| `log_food` | Record food, quantity in grams, time, and nutrient values. |
| `update_entry` | Update an owned food record. Quantity and time changes retain nutrient values. A food change stores a new snapshot. |
| `delete_entry` | Delete an owned food record. |
| `daily_nutrition_summary` | Return food records and nutrient totals for a local calendar day. |
| `getWeeklyTrainingPlan` | Return the current Monday-to-Sunday schedule. |
| `getUpcomingWorkouts` | Return workouts from today for up to 90 days. The default is 14 days. |
| `getWorkoutForDate` | Return workouts for a date in the user's time zone. |
| `refreshTrainingPlan` | Refresh the current and following training weeks. |

## Identity and access

Hermes forwards the BlueBubbles sender from its request-local transport context in MCP `_meta`. Private tools accept direct iMessage chats only. fueld_b resolves the sender against the configured phone numbers. Tool inputs do not accept user IDs. Unknown senders and missing metadata fail closed.

Run fueld_b only as a local stdio child of the trusted Hermes host. An arbitrary MCP client can forge `_meta` and must not have access to the server.

## Development and tests

From the package directory, run:

```sh
bun run test
bun run typecheck
```

Tests use isolated temporary databases and mock USDA and Final Surge requests. The optional live USDA test runs only when `config.local.json` contains an API key.
