# @footon/storage

Shared SQLite and Drizzle infrastructure for Footon. Fuel and Blocks own their Drizzle schemas and persistence operations. This package owns the connection, shared identity tables, migration tools, and database path settings. Its runtime client does not import Fuel, Blocks, MCP, or Garmin. Drizzle Kit reads Fuel and Blocks schema files when it generates shared migrations.

## Database file

The default file is `packages/storage/db/foot.sqlite`, resolved from this package rather than the current working directory. Set `FOOTON_DB_PATH` to use another absolute or working-directory-relative path.

`openStorage()` opens an existing database and fails if the file is missing. It does not create a blank database at application startup. It applies `foreign_keys=ON`, a 5-second busy timeout, and WAL mode. Close the returned connection with `storage.close()`.

```ts
import { openStorage } from "@footon/storage";
import { dailySummary } from "@footon/fuel";

const storage = openStorage();
try {
  const summary = dailySummary(storage.db, "user-id", "UTC", "2026-10-22");
  console.log(summary.totals);
} finally {
  storage.close();
}
```

Applications that use Fuel or Blocks must ensure their user records exist with `upsertUsers(storage.db, users)` before writing domain rows. MCP does this from the root configuration. The domain packages do not depend on MCP.

## Migrations

Run commands from the monorepo root:

- `bun run db:generate` creates a versioned migration from the domain schemas.
- `bun run db:migrate` applies pending migrations. This explicit command may create the database file when it is missing.
- `bun run db:baseline` is a one-time operation for an existing database with the inspected Footon schema and no Drizzle history. It validates the expected tables, columns, indexes, foreign keys, and quantity constraint before stamping the first migration. Then run `bun run db:migrate` to apply later migrations.

Do not run the baseline command on a new or empty database. Do not run schema changes automatically when MCP starts.

The initial migration matches the existing shared schema. The follow-up migration adds the Blocks refresh-ordering table without changing existing records.

## Data protection

SQLite files, backups, and sidecars under `packages/storage/db/` are ignored by Git and excluded from the package file list. Automated tests use only in-memory or temporary databases.
