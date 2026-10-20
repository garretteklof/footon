import { validateDate } from "../utils/time";
import type { ConfiguredUser } from "../config";
import type { Workout } from "./plans";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : null;
type Credentials = { email: string; password: string };
const sessions = new Map<string, Promise<{ token: string; userKey: string }>>();
const retryAfter = new Map<string, number>();
const sessionKey = (user: ConfiguredUser) => `${user.id}:${user.training?.email ?? ""}`;
export class AccountMismatchError extends Error {}

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
async function session(user: ConfiguredUser, http: typeof fetch) {
  const credentials = user.training;
  if (!credentials) throw new Error("Training provider not configured for this user");
  const key = sessionKey(user);
  let pending = sessions.get(key);
  if (!pending) {
    pending = login(credentials, http);
    sessions.set(key, pending);
    void pending.catch(() => { if (sessions.get(key) === pending) sessions.delete(key); retryAfter.set(key, Date.now() + 60000); });
  }
  return pending;
}
export async function getWorkouts(user: ConfiguredUser, accountId: string | null, start: string, end: string, http: typeof fetch): Promise<{ accountId: string; workouts: Workout[] }> {
  const key = sessionKey(user);
  if ((retryAfter.get(key) ?? 0) > Date.now()) throw new Error("Final Surge temporarily unavailable; retry later");
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = sessions.get(key) ?? session(user, http);
    const current = await pending;
    if (accountId && current.userKey !== accountId) throw new AccountMismatchError("Final Surge account does not match configured user");
    const url = new URL("https://beta.finalsurge.com/api/WorkoutList");
    url.search = new URLSearchParams({ scope: "USER", scopekey: current.userKey, startdate: start, enddate: end, ishistory: "false", completedonly: "false" }).toString();
    const response = await request(url, { headers: { Authorization: `Bearer ${current.token}` } }, http);
    if (response.status === 401 || response.status === 403) {
      if (sessions.get(key) === pending) sessions.delete(key);
      if (attempt === 0) continue;
      retryAfter.set(key, Date.now() + 60000);
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      retryAfter.set(key, Date.now() + Math.min(3600000, Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000)));
    }
    if (!response.ok) throw new Error("Final Surge workout request failed");
    const body: unknown = await response.json().catch(() => null);
    if (!object(body) || body.success === false || !Array.isArray(body.data)) throw new Error("Invalid Final Surge workout response");
    return { accountId: current.userKey, workouts: body.data.map(normalize) };
  }
  throw new Error("Final Surge authentication failed");
}
