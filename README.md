# Hermarium

**A terrarium of Hermes tools.**

Small, independently usable tools and skills for Hermes. The Bun workspace currently contains `fueld_b`: a nutrition MCP server, training-plan integration, and companion Hermes skill.

## Run

```sh
bun install
# Set FDC_API_KEY in your environment or packages/fueld_b/.env.
bun run start:fueld_b
```

For training without a USDA key:

```sh
bun run training connect
bun run training upcoming
bun run start:training
```

Connection selects or creates a named profile, authenticates Final Surge, saves the login in the native OS credential store, and fetches the schedule. Repeating connection reuses the saved login. No manual user UUIDs, provider account keys, sender IDs, or credential prefixes are required.

Both MCP commands use the same server entry point and database. See [fueld_b setup and tools](packages/fueld_b/README.md) and [training usage](packages/fueld_b/TRAINING.md).

## Layout

```text
packages/fueld_b/
  src/
    index.ts              MCP tools and server startup
    config.ts             USDA key and optional database path
    database.ts           SQLite opening and schema initialization
    schema.sql            One canonical schema
    users.ts              Profiles, identities, names, and timezones
    nutrition.ts          Food logging, corrections, and summaries
    food-data-central.ts  USDA HTTP client
    time.ts               Calendar dates and local-day boundaries
    training/
      cli.ts              Interactive connection and read commands
      plans.ts            Account connection and schedule snapshots
      final-surge.ts      Authentication, fetching, and normalization
      secrets.ts          Native credential-store operations
  tests/
  skill/SKILL.md
```

## Develop

```sh
FDC_API_KEY='' bun run test
bun run typecheck
```

The test suite mocks provider HTTP and credential storage. It also exercises real stdio MCP exchanges and terminal prompts. The empty USDA key skips the optional live USDA test.

Install the Hermes skill separately:

```sh
mkdir -p ~/.hermes/skills/nutrition
cp packages/fueld_b/skill/SKILL.md ~/.hermes/skills/nutrition/SKILL.md
```

SQLite data, local environment files, and dependencies are Git-ignored.
