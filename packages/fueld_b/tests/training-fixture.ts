import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database";
import { resolveIdentity } from "../src/users";
import { connectAccount, getAccount } from "../src/training/plans";
import type { Secrets } from "../src/training/secrets";

const databases: ReturnType<typeof openDatabase>[] = [];
export function closeFixtures() { for (const db of databases.splice(0)) db.close(); }
export function fixture(path = ":memory:") {
  const db = openDatabase(path); databases.push(db);
  const alice = resolveIdentity(db, "imessage", "alice-sender", "Alice").userId;
  const bob = resolveIdentity(db, "hermex", "bob-sender", "Bob").userId;
  const values = new Map<string, string>();
  const secrets: Secrets = {
    async get({ name }) { return values.get(name) ?? null; },
    async set({ name, value }) { values.set(name, value); },
    async delete({ name }) { return values.delete(name); },
  };
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
  const connect = (userId = alice, email = "alice", password = "private-password") => connectAccount(db, userId, "final-surge", { email, password }, secrets, http);
  const seed = async (userId = alice, email = "alice") => {
    const reference = randomUUID();
    await secrets.set({ service: "hermarium.training", name: reference, value: JSON.stringify({ email, password: "pw" }) });
    db.query("INSERT INTO training_accounts (user_id,provider,account_id,credential_ref) VALUES (?,?,?,?)").run(userId, "final-surge", "external-" + email, reference);
    return getAccount(db, userId)!;
  };
  return { db, alice, bob, values, secrets, state, http, connect, seed };
}
export function scriptedUI(answers: string[]) {
  const output: string[] = [], prompts: { label: string; secret?: boolean }[] = [];
  return { output, prompts, ui: {
    log(message: string) { output.push(message); },
    async ask(label: string, secret?: boolean) { prompts.push({ label, secret }); const value = answers.shift(); if (value === undefined) throw new Error("Cancelled"); return value; },
  } };
}
