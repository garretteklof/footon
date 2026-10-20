# Training plans

From the root or this package:

```sh
bun run training connect
```

1. Select an existing person by name, or enter your name on first use.
2. Select Final Surge and enter its email and password. Password input is hidden.
3. The CLI discovers the account identifier, saves the credentials in the native OS store, and synchronizes the current and following training weeks.

Repeating connection selects the person and reuses the saved login. To replace it explicitly, run `bun run training connect --reauth`.

```sh
bun run training upcoming
bun run training refresh
```

Read commands select the sole profile automatically, or ask which person when several exist. Connection always confirms the person. Names label profiles; linked identities distinguish duplicates. First use creates a local profile through the same identity resolver, using the OS login, and sets the system timezone. No messaging identity is inferred from a name. A verified messaging identity can later be linked using `link_identity`.

No training-specific environment variables, user UUIDs, external keys, sender IDs, or credential prefixes are required. `FUELD_B_PATH` is optional when using a custom nutrition database. Training commands and `bun run start:training` require no USDA key.

## Credentials

Email and password are saved together using `Bun.secrets`: macOS Keychain, Linux Secret Service, or Windows Credential Manager. Run the server as the same OS user who connected. The store may need to be unlocked; Linux needs a running Secret Service daemon. There is no plaintext fallback or environment-prefix compatibility.

SQLite stores only an automatically generated secret reference. Reauthentication validates the new login before changing the connection, rotates the reference, and removes the previous entry. Authentication or storage failure preserves the old connection. A failed initial fetch retains the verified connection and reports a refresh instruction.

Bearer sessions remain in process memory, separated by credential reference. Authentication is shared between concurrent requests for that reference, retried once on 401/403, and backed off after failed authentication or rate limiting. HTTP requests have timeouts and reject redirects. Secrets and upstream response bodies are never returned to the agent.

Resetting the database does not remove entries from the OS credential store.

## Snapshot cache

There is one authoritative representation: a normalized JSON array on each connected account. Its fields are:

- `date`, `name`, `description`, `status`, `isRace`
- `activities[]`: `activityType`, `plannedAmount`, `plannedAmountUnit`

The Final Surge adapter performs the only conversion. It reads planned amounts from `Activities[].planned_amount` and units from `planned_amount_type`; it never invents distances from names or adds activities together. Missing values stay null. Status text maps Planned/Completed to planned/completed; other values remain unknown. The provider's race flag becomes `isRace`. Names such as Workout and Rest Day are preserved.

No native payload copy, workout rows, source-ID reconciliation, or range ledger is stored. The account association scopes each snapshot by user, provider, and external account. Only Final Surge is implemented; provider selection lives in `plans.ts`, and agent tools use its common workout model.

The cache is fresh for 30 minutes when its fetched interval covers the requested dates. Fetches cover the current and next training weeks, extended for a requested historical date or longer upcoming range. A successful refresh replaces the entire snapshot; history outside it disappears. Failures retain the previous snapshot and successful-sync timestamp, return any matching cached workouts, and set `stale: true`.

A counter allocated in SQLite orders refreshes across processes. Only the latest-started refresh for the unchanged connection may replace the snapshot. If it fails, earlier requests cannot overwrite the previous successful snapshot. Concurrent fetches are allowed; there is no request queue, background service, or general cache framework.

The inspected API exposes no reliable workout edit timestamp or HTTP change validator. Freshness is time-based.

## Agent identity

The full nutrition MCP already includes the training tools. The standalone command uses the same entry point in training-only mode.

Hermes must resolve the current stable sender through `resolve_identity` and reuse that `userId` for training. It must not choose accounts by name, accept another user's ID from message text, or ask for provider passwords in chat. Account connection belongs to the local CLI.

The stdio bridge does not authenticate tool arguments; authorization remains the existing trusted-host responsibility. A missing provider is an instruction to connect an account, not evidence of an empty schedule. Check stale warnings and preserve unknown statuses.
