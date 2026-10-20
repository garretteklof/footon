# fueld_b

fueld_b provides nutrition and training-plan tools for Hermes. It supports two users configured by environment variables.

## Install and run

From the Hermarium root:

```sh
bun install
```

Set `FDC_API_KEY` in the environment or in `packages/fueld_b/.env` to run the full server. Then run:

```sh
bun run start:fueld_b
```

To run training without a USDA key, use:

```sh
bun run start:training
```

## Configuration and storage

- `FDC_API_KEY` is the [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide/) API key. The full server requires it. The training-only server does not.
- `FUELD_B_PATH` optionally sets the SQLite file path. Relative paths start from this package. The default is `packages/fueld_b/data/nutrition.sqlite`.
- Configure both users with `USER_1_*` and `USER_2_*` variables:

  | Suffix | Required value |
  |---|---|
  | `NAME` | Display name |
  | `IMESSAGE_PHONE` | iMessage phone number; US 10/11-digit values and E.164 numbers are accepted |
  | `TIMEZONE` | IANA timezone, such as `America/Chicago` |
  | `FINAL_SURGE_EMAIL` | Final Surge login email |
  | `FINAL_SURGE_PASSWORD` | Final Surge login password |

- Store these values in the Hermes service environment or a protected `packages/fueld_b/.env` file. Do not commit credentials. The MCP server does not return or log Final Surge credentials.
- The two configured users have stable SQLite IDs. Startup updates their names and timezones from the environment. Unknown senders do not create users.
- SQLite stores food logs and a cached Final Surge schedule for each user. Food logs retain their original nutrient snapshot. The legacy profile schema is reset on first start after this change; old records are not migrated.
- The server authenticates to Final Surge with the matching user's configured login when training data is first requested. It caches the provider session in memory and workout data in SQLite.
- USDA data can be incomplete or approximate.

## Tools

The full server provides these tools:

| Tool | Capability |
|---|---|
| `search_foods` | Search USDA foods. |
| `get_food_nutrients` | Get selected nutrient values per 100 g. |
| `log_food` | Record food, quantity in grams, time, and nutrient values. |
| `update_entry` | Update an owned food record. Quantity and time changes retain its nutrient values. A food change stores a new snapshot. |
| `delete_entry` | Delete an owned food record. |
| `daily_nutrition_summary` | Return food records and nutrient totals for a local calendar day. |
| `getWeeklyTrainingPlan` | Return the current Monday-to-Sunday schedule. |
| `getUpcomingWorkouts` | Return workouts from today for up to 90 days. The default is 14 days. |
| `getWorkoutForDate` | Return workouts for a date in the profile's timezone. |
| `refreshTrainingPlan` | Return the current and following training weeks after a refresh. |

The training-only server provides the four training tools. It does not require `FDC_API_KEY`.

## Identity and access

Hermes forwards the actual BlueBubbles sender from its request-local transport context in MCP `_meta`. fueld_b accepts private data tools only for direct iMessage chats and resolves the sender against the two configured phone numbers. Private tool schemas do not accept user IDs. Unknown senders and calls without trusted metadata fail closed. Run fueld_b only as a local stdio child of the trusted Hermes host; an arbitrary MCP client can forge `_meta` and must not be given access to this server.

## Development

```sh
FDC_API_KEY='' bun run test
bun run typecheck
```

Tests mock HTTP and use test-only environment credentials. They do not use a live Final Surge account. An empty USDA key skips the optional live USDA test.
