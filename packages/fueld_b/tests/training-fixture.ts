import { openDatabase } from "../src/db/database";
import { getAccount, trainingPlan } from "../src/training/plans";
import type { ConfiguredUser } from "../src/config";

const databases: ReturnType<typeof openDatabase>[] = [];
let fixtureId = 0;
export function closeFixtures() { for (const db of databases.splice(0)) db.close(); }
export function fixture(path = ":memory:") {
  const db = openDatabase(path); databases.push(db);
  const id = ++fixtureId;
  const alice: ConfiguredUser = { id: "user-1", name: "Alice", phone: "+15551234567", timezone: "America/Chicago", training: { provider: "final-surge", email: `alice-${id}`, password: "private-password" } };
  const bob: ConfiguredUser = { id: "user-2", name: "Bob", phone: "+15559876543", timezone: "UTC", training: { provider: "final-surge", email: `bob-${id}`, password: "private-password-2" } };
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
  return { db, alice: alice.id, bob: bob.id, aliceUser: alice, bobUser: bob, state, http,
    plan: (user: ConfiguredUser = alice, query: "week" | "refresh" | { days: number } | { date: string } = "refresh") => trainingPlan(db, user, query, http),
    account: (userId = alice.id) => getAccount(db, userId)! };
}
