# @footon/vitals

`@footon/vitals` stores physiological measurements and subjective check-ins. It owns observation records and simple summaries. It does not own identity, food logs, training plans, athletic goals, or completed activities.

The package uses `@footon/storage` for the shared SQLite connection. It does not depend on MCP, Blocks, Fuel, or Garmin.

## Supported observations

| Metric | Unit | Accepted values |
| --- | --- | --- |
| `body_weight` | `kg` | Greater than 0 and no more than 500 |
| `resting_heart_rate` | `bpm` | Greater than 0 and no more than 250 |
| `hrv_rmssd` | `ms` | Greater than 0 and no more than 500 |
| `sleep_duration` | `minutes` | 0 to 1440 |
| `fatigue` | `score_0_10` | 0 to 10 |
| `soreness` | `score_0_10` | 0 to 10 |
| `recovery` | `score_0_10` | 0 to 10 |

Values use one canonical unit. Vitals does not convert units. A missing observation is not a zero value.

## Record an observation

Create the user row before you write an observation. Pass the user's IANA timezone. The package stores timestamps in UTC and derives `localDate` from that timezone.

```ts
import { openStorage, upsertUsers } from "@footon/storage";
import { recordObservation } from "@footon/vitals";

const storage = openStorage();
try {
  upsertUsers(storage.db, [{ id: "alex", name: "Alex", timezone: "America/Chicago" }]);
  const observation = recordObservation(storage.db, "alex", "America/Chicago", {
    metric: "body_weight",
    value: 68,
    unit: "kg",
    observedAt: "2026-10-20T10:00:00-05:00",
    note: "Morning measurement",
  });
  console.log(observation.localDate);
} finally {
  storage.close();
}
```

`observedAt` accepts an RFC 3339 timestamp with an offset. If you omit it, Vitals uses the current time. The local date can differ from the UTC date.

Set `source` to `manual` for a user-entered value. Imported values use a provider name. Set `sourceKey` when the provider gives a stable record ID. A repeated `(user, source, sourceKey)` returns the existing observation instead of adding a duplicate.

Use `updateManualObservation` and `deleteManualObservation` only for manual records. These functions do not edit or delete imported records.

## Retrieval and summaries

- `getObservations(db, userId, { startDate, endDate, metric? })` returns observations for an inclusive local-date range.
- `getLatestObservation(db, userId, metric)` returns the newest record for one metric.
- `summarizeVitals(db, userId, { startDate, endDate })` returns a sample count, mean, first value, latest value, and first-to-latest change for each metric.

A summary marks a metric `sufficient_data` only when it has at least two observations in the selected range. It marks other results `insufficient_data`. It does not calculate a readiness score or diagnose a condition. A short-term weight change does not represent body-fat change.

## Storage and provider imports

The Vitals table is `vitals_observations`. Its schema lives in `src/db/schema.ts`. The shared migration configuration reads this schema. Run `bun run db:generate` to create a migration. Run `bun run db:migrate` to apply pending migrations.

A future importer can normalize Garmin or another provider's records, then call `recordObservation`. Vitals does not make provider requests or start a background sync job. Provider imports can also call this API without MCP.

The Garmin client already exposes daily heart-rate, HRV, sleep, blood-pressure, respiration, SpO₂, and body-battery methods. It also exposes weight, body-composition, and activity methods. These methods return provider data. They do not write Vitals records.

Some Garmin response types remain open or partial, including HRV, sleep, and body composition. The weight client documents gram values. Future import code needs fixture-backed field mapping, unit conversion, timezone handling, and stable source keys. No Garmin API or sync code changed in this phase.

## Checks

Run `bun run --filter @footon/vitals check` from the repository root. Tests use isolated databases and do not call external services.
