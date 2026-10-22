# Garmints

Garmints is an ESM-only TypeScript client for unofficial Garmin Connect endpoints. Use Bun for development. The package supports Node.js 24 and later.

Garmin does not document these Connect endpoints as a stable public API. Endpoints and the sign-in flow can change without notice. Garmints is independent and is not affiliated with Garmin.

## Install

Install `@footon/garmin` with Bun or npm:

```sh
bun add @footon/garmin
# or
npm install @footon/garmin
```

From the workspace root, install dependencies and check the Garmin package:

```sh
bun install
bun run --filter @footon/garmin check
```

The package exposes ESM entry points only. CommonJS `require()` is not supported.

## Authenticate and read data

Set `GARMIN_EMAIL` and `GARMIN_PASSWORD` in your environment. The example below loads saved tokens or signs in. It prompts for an MFA code when Garmin requests one.

```ts
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Garmin } from "@footon/garmin";

const email = process.env.GARMIN_EMAIL;
const password = process.env.GARMIN_PASSWORD;
if (!email || !password) throw new Error("Set GARMIN_EMAIL and GARMIN_PASSWORD");

const garmin = new Garmin();
if (!(await garmin.loadTokens())) {
  const result = await garmin.login(email, password);
  if (result.status === "mfa_required") {
    const prompt = createInterface({ input: stdin, output: stdout });
    const code = await prompt.question(`Enter the ${result.challenge.method} code from Garmin: `);
    prompt.close();
    await garmin.resumeLogin(code);
  }
}

const date = new Date().toISOString().slice(0, 10);
await Promise.all([
  garmin.wellness.sleep(date),
  garmin.activities.list({ limit: 20 }),
]);
```

The client saves tokens after a successful sign-in. After MFA, `resumeLogin()` saves the tokens on the same `Garmin` instance. The client refreshes expiring access tokens before protected requests and saves rotated tokens.

## Tokens and security

`Garmin` uses `FileTokenStore` by default. It stores tokens in `~/.garmints/garmin_tokens.json`. On POSIX, `FileTokenStore` sets owner-only permissions for the file and directory. The store rejects symbolic links.

Set `tokenPath` to use another file or directory. Pass a custom `TokenStore` for other storage. Use `MemoryTokenStore` when you do not need persistent tokens. `logout()` clears the configured store.

Use Garmints only in server-side Bun or Node.js code. Do not expose credentials, tokens, or session state to browser code or client-visible storage.

## API namespaces

`Garmin` groups methods under domain namespaces such as `wellness`, `activities`, `training`, and `workouts`. For example:

```ts
await garmin.activities.get(activityId);
await garmin.training.readiness(date);
await garmin.workouts.list();
await garmin.nutrition.dailyLog(date);
```

Use `garmin.request<T>(path, options)` for an authenticated request to a relative Connect API path without a named method. It returns `T | null` because some responses have no body.

## Build a workout

`buildWorkout()` creates a workout payload. It assigns global step order and supports repeat groups, targets, swim fields, exercises, and multi-sport legs.

After you authenticate the client, build and upload a workout:

```ts
import { buildWorkout } from "@footon/garmin";
import { exercise } from "@footon/garmin/exercises";

const workout = buildWorkout("Strength", { sport: "strength_training" })
  .interval({ reps: 8, exercise: exercise("SQUAT", "BARBELL_BACK_SQUAT") })
  .build();

await garmin.workouts.upload(workout);
```

## Testing

Unit tests assert generated workout payloads directly. The suite uses mocked HTTP responses and does not contact Garmin. It does not show how current endpoints behave or whether Garmin accepts a workout.
