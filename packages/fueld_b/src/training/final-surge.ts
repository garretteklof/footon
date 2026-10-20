import { validateDate } from "../time";
import type { Workout, Account } from "./plans";
import { readCredentials, type Credentials, type Secrets } from "./secrets";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : null;
const sessions = new Map<string, Promise<{ token: string; userKey: string }>>();
const retryAfter = new Map<string, number>();

function normalize(raw: unknown): Workout {
  if (!object(raw) || typeof raw.workout_date !== "string") throw new Error("Invalid Final Surge workout");
  const status = text(raw.workout_status_text)?.trim().toLowerCase();
  return {
    date: validateDate(raw.workout_date.slice(0, 10)),
    name: text(raw.name), description: text(raw.description),
    status: status === "planned" || status === "completed" ? status : "unknown",
    isRace: typeof raw.is_race === "boolean" ? raw.is_race : null,
    activities: Array.isArray(raw.Activities) ? raw.Activities.filter(object).map(activity => ({
      activityType: text(activity.activity_type_name),
      plannedAmount: typeof activity.planned_amount === "number" && Number.isFinite(activity.planned_amount) ? activity.planned_amount : null,
      plannedAmountUnit: text(activity.planned_amount_type),
    })) : [],
  };
}
async function request(url: string | URL, init: RequestInit, http: typeof fetch) {
  try { return await http(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error("Final Surge network request failed"); }
}
async function login(credentials: Credentials, http: typeof fetch) {
  const response = await request("https://www.finalsurge.com/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...credentials, rememberMe: 0 }),
  }, http);
  if (!response.ok) throw new Error("Final Surge authentication failed; check your login and try again");
  const body: unknown = await response.json().catch(() => null);
  if (!object(body) || body.success !== true || !object(body.data)
    || typeof body.data.token !== "string" || !body.data.token || typeof body.data.user_key !== "string" || !body.data.user_key)
    throw new Error("Invalid Final Surge authentication response");
  return { token: body.data.token, userKey: body.data.user_key };
}
export async function connect(reference: string, credentials: Credentials, http: typeof fetch): Promise<string> {
  const session = await login(credentials, http);
  sessions.set(reference, Promise.resolve(session));
  return session.userKey;
}
async function session(account: Account, secrets: Secrets, http: typeof fetch) {
  const reference = account.credentialRef;
  if (!sessions.has(reference)) {
    const pending = (async () => {
      const value = await login(await readCredentials(reference, secrets), http);
      if (value.userKey !== account.accountId) throw new Error("Final Surge account does not match configured profile");
      return value;
    })();
    sessions.set(reference, pending);
    void pending.catch(() => { sessions.delete(reference); retryAfter.set(reference, Date.now() + 60000); });
  }
  return sessions.get(reference)!;
}
export async function getWorkouts(account: Account, start: string, end: string, secrets: Secrets, http: typeof fetch): Promise<Workout[]> {
  const reference = account.credentialRef;
  if ((retryAfter.get(reference) ?? 0) > Date.now()) throw new Error("Final Surge temporarily unavailable; retry later");
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await session(account, secrets, http);
    const url = new URL("https://beta.finalsurge.com/api/WorkoutList");
    url.search = new URLSearchParams({ scope: "USER", scopekey: current.userKey, startdate: start, enddate: end, ishistory: "false", completedonly: "false" }).toString();
    const response = await request(url, { headers: { Authorization: `Bearer ${current.token}` } }, http);
    if (response.status === 401 || response.status === 403) {
      if (await sessions.get(reference) === current) sessions.delete(reference);
      if (attempt === 0) continue;
      retryAfter.set(reference, Date.now() + 60000);
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      retryAfter.set(reference, Date.now() + Math.min(3600000, Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000)));
    }
    if (!response.ok) throw new Error("Final Surge workout request failed");
    const body: unknown = await response.json().catch(() => null);
    if (!object(body) || body.success === false || !Array.isArray(body.data)) throw new Error("Invalid Final Surge workout response");
    return body.data.map(normalize);
  }
  throw new Error("Final Surge authentication failed");
}
