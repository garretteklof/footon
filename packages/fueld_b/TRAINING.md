# Training plans

Connect your training account from the Hermarium root:

```sh
bun run training connect
```

1. Select an existing fueld_b user, or enter your name on first use.
2. If training is not connected yet, select **Final Surge** and enter your Final Surge email and password once. Password input is hidden.
3. If the selected person already has a connected account, the CLI uses the saved login and refreshes workouts without asking for details again.

The CLI logs in, discovers the external account ID, connects it to that person, and synchronizes the current and following training weeks. No environment variables, internal UUIDs, external account IDs, messaging sender IDs, or credential prefixes need to be entered.

Existing profiles with names appear by name, alongside their linked identities to distinguish duplicates. Older profiles have no name field populated: the first connection shows their existing linked identities and asks for a friendly name on the same profile. Existing profiles are reused. On an empty database, connection asks for your name, creates the first local profile through fueld_b's existing `resolveIdentity` mechanism using the current OS login, and sets its timezone from the local system. This happens after all prompts are completed, so cancelling or leaving a blank name does not create a profile. If login subsequently fails, that unconnected profile remains available for retry. No messaging account is inferred or linked by name. A verified messaging identity can later be linked to this same person using the existing `link_identity` workflow. Names are labels, never authorization.

After connecting:

```sh
bun run training upcoming
bun run training refresh
```

With one existing profile these commands select it automatically. With multiple profiles they ask which person to inspect. These local CLI commands are for the trusted machine operator; they are not exposed as account-selection tools to the model. `training connect` is safe to repeat: choosing a connected person reuses the saved login. The profile menu shows whether each person has a training connection. A fueld_b profile identifies the person; it does not itself contain a Final Surge login until the first connection succeeds. Names already saved on profiles are reused.

To explicitly replace a saved login, run `bun run training connect --reauth`. A rejected login preserves the previous connection. If authentication succeeds but initial sync fails, the connection is retained and the CLI tells you to retry `refresh`.

The same commands work from `packages/fueld_b`. `FUELD_B_PATH` is optional, only when your existing nutrition database uses a custom path; otherwise the shared default is `packages/fueld_b/data/nutrition.sqlite`. No `FDC_API_KEY` is needed for the training-only CLI or server.

## Credentials

fueld_b previously used environment variables and had no appropriate persistent credential store. Training connection uses Bun's native `Bun.secrets` API: macOS Keychain, Linux Secret Service, or Windows Credential Manager. The OS may ask to unlock/allow access. Use a Bun version that supports this API. Linux requires a running Secret Service daemon. If the credential store is unavailable, connection fails with instructions; there is no plaintext fallback or custom encryption system.

Both the login email and password go into one OS secret entry. SQLite stores only an automatically generated reference alongside the provider/account association. Passwords and bearer tokens never enter tool responses, command arguments, or workout storage. Tokens stay in memory and are separate per user/account. Reconnection replaces the reference and removes the previous credential entry. Run the server as the same OS user who connected the account.

Previously configured environment-backed accounts remain readable for compatibility. Use `training connect --reauth` once to move an existing account to native secret storage; the old environment variables can then be removed. Global `TRAINING_SENDER_ID` and `TRAINING_SENDER_PLATFORM` are no longer used.

## Agent use

Training tools are included in the existing fueld_b MCP server, alongside nutrition and `resolve_identity`. An existing fueld_b MCP registration needs no additional sender/account configuration after connection. Restart the server to discover the new tools. The full nutrition server still requires its existing `FDC_API_KEY`.

For a standalone training-only MCP server:

```sh
bun run start:training
```

Both servers use the same identity resolver and database. Hermes supplies the current stable sender identity to `resolve_identity(platform, externalId, name?)`, as it already does for nutrition. The agent reuses the returned `userId` for `getWeeklyTrainingPlan(userId)`, `getUpcomingWorkouts(userId, days?)`, `getWorkoutForDate(userId, date)`, and `refreshTrainingPlan(userId)`. It should never ask a person for internal IDs or account settings. An optional name labels the profile without changing its identity. Existing linked identities resolve to the same person and provider automatically.

This deliberately reuses fueld_b's trusted-local-host contract, as selected for this integration. The current Hermes stdio MCP bridge does not supply authenticated sender metadata. Tool arguments are not independent proof of identity: Hermes must resolve the actual sender, enforce authorization, and avoid allowing a message to select another user's ID. The server scopes data by the supplied existing user but does not add transport authentication. Do not expose this stdio server directly to untrusted clients. If the host has no stable sender identity, the agent must ask for identity context rather than guess from a name or select the sole connected account.

## Provider architecture and cache

The generic `TrainingPlanService` resolves the configured provider from the existing person, handles local date ranges, caching, and reconciliation, and exposes normalized workouts. Only Final Surge is implemented; there is no registry. Nutrition and agent tools do not depend on Final Surge payloads.

The agent-facing workout shape contains only `date`, `name`, `description`, `status`, `isRace`, and activities with `activityType`, `plannedAmount`, and `plannedAmountUnit`. Missing values stay null; names and values are not invented. Provider/account/source IDs remain internal to cache identity and reconciliation. The raw cache keeps only `workout_date`, `name`, `description`, `workout_status_text`, `is_race`, and each activity's `activity_type_name`, `planned_amount`, and `planned_amount_type`. Users without a connected provider get connection instructions.

Default fetch ranges cover the current and following Monday–Sunday weeks in the existing user's timezone, expanded to cover queries when needed. Freshness is 30 minutes. Forced refresh bypasses freshness, equivalent concurrent refreshes share a request, and each account has independent sync state. Successful fetched ranges are reconciled atomically, removing deleted workouts and upserting changed/moved IDs. Failures preserve cached workouts and successful sync timestamps and return `stale: true`. Out-of-range moved workouts are rediscovered when the destination range is fetched. There is no background service.

## Unofficial API limitations

Live WorkoutList responses place activity type, planned amount, and amount unit in `Activities[].activity_type_name`, `planned_amount`, and `planned_amount_type`. The adapter passes those through as readable activity fields without summing or converting them. It maps `workout_status_text` values `Planned` and `Completed` to normalized statuses; missing or unrecognized values remain `unknown`. Live race examples set `is_race: true`, so that provider flag is exposed as `isRace`. For October 11, 2026, the API returned `Chicago` with `is_race: true` and status `Completed`; for December 13, it returned `Marathon` with `is_race: true` and null status text, which remains `unknown`.

The inspected workout objects contained no `updated_at`, modified timestamp, or version field. The HTTP responses had no `ETag` or `Last-Modified` header. Device sync timestamps describe external integrations, not workout edits, so they are not used as change markers. The service continues to refresh cached workout ranges after 30 minutes.

Other provider fields are discarded when caching. A database migration compacts existing Final Surge cache rows to the same selected fields. The automated suite mocks HTTP and does not log in to your live account. Requests have timeouts, reject redirects, retry authentication once on 401/403, and apply cooldowns for login failures and rate limiting.

## Tests

```sh
bun run typecheck
FDC_API_KEY='' bun run test
```

Training tests mock HTTP and credential storage. They exercise fresh-database onboarding, cancellation, interactive connection, account discovery, hidden password prompts, login/store failures, reconnect cleanup, initial sync failures, names and linked identities, user/account isolation, stale-cache recovery, reconciliation, and independent sessions. They never access your real Keychain or Final Surge account. The empty USDA key disables the existing optional live USDA test.
