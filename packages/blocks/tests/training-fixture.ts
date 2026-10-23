import { getAccount, trainingPlan } from "../src/plans";
import { migrateDatabase, migrateStorage, openStorage, upsertUsers, type StorageConnection } from "@footon/storage";
import type { TrainingUser } from "../src/types";

const databases: StorageConnection[] = [];
let fixtureId = 0;
export function closeFixtures() { for (const storage of databases.splice(0)) storage.close(); }
export function openDatabase(path = ":memory:") {
  if (path !== ":memory:") migrateStorage(path);
  const storage = openStorage(path);
  migrateDatabase(storage.db);
  return storage;
}
export function fixture(path = ":memory:") {
  const storage = openDatabase(path); databases.push(storage);
  const id = ++fixtureId;
  const alice: TrainingUser = { id: "user-1", timezone: "America/Chicago", training: { provider: "final-surge", email: `alice-${id}`, password: "private-password" } };
  const bob: TrainingUser = { id: "user-2", timezone: "UTC", training: { provider: "final-surge", email: `bob-${id}`, password: "private-password-2" } };
  upsertUsers(storage.db, [
    { id: alice.id, name: "Alice", timezone: alice.timezone },
    { id: bob.id, name: "Bob", timezone: bob.timezone },
  ]);
  const state = { logins: [] as string[], tokens: [] as string[], ranges: [] as string[][], reject: false, unavailable: false,
    status: [] as number[], items: undefined as unknown[] | undefined };
  const http = (async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("/login")) {
      const body = JSON.parse(init!.body as string); state.logins.push(body.email);
      return state.reject ? new Response(null, { status: 401 }) : Response.json({ success: true, data: { token: "token-" + body.email, user_key: "external-" + body.email } });
    }
    const u = new URL(String(url));
    state.tokens.push((init!.headers as Record<string, string>).Authorization);
    state.ranges.push([u.searchParams.get("startdate")!, u.searchParams.get("enddate")!]);
    const status = state.status.shift() ?? (state.unavailable ? 503 : 200);
    if (status !== 200) return new Response(null, { status, headers: { "Retry-After": "120" } });
    return Response.json({ data: state.items ?? [{ key: "same-id", workout_date: u.searchParams.get("startdate"), name: "Workout", workout_status_text: "Planned", is_race: false,
      Activities: [{ activity_type_name: "Run", planned_amount: 8, planned_amount_type: "mi", unused: "discard" }], private_field: "discard" }] });
  }) as typeof fetch;
  return { db: storage.db, sqlite: storage.sqlite, alice: alice.id, bob: bob.id, aliceUser: alice, bobUser: bob, state, http, storage,
    plan: (user: TrainingUser = alice, query: "week" | "refresh" | { days: number } | { date: string } = "refresh") => trainingPlan(storage.db, user, query, http),
    account: (userId = alice.id) => getAccount(storage.db, userId) };
}
