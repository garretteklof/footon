import type { Credentials } from "../credentials";
import type { TrainingAccount, TrainingPlanProvider, ProviderWorkout } from "../model";
import { validateDate } from "../model";
const obj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown) => typeof x === "string" ? x : null;
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function normalizeFinalSurge(raw: Record<string, unknown>, a: TrainingAccount): ProviderWorkout {
    if ((typeof raw.key !== "string" && typeof raw.key !== "number") || !String(raw.key) || typeof raw.workout_date !== "string")
        throw new Error("Invalid Final Surge workout");
    const activities = Array.isArray(raw.Activities) ? raw.Activities.filter(obj).map(activity => ({
        activityType: str(activity.activity_type_name),
        plannedAmount: finite(activity.planned_amount) ? activity.planned_amount : null,
        plannedAmountUnit: str(activity.planned_amount_type),
    })) : [];
    const cachedRaw = {
        workout_date: raw.workout_date,
        name: str(raw.name),
        description: str(raw.description),
        workout_status_text: str(raw.workout_status_text),
        is_race: typeof raw.is_race === "boolean" ? raw.is_race : null,
        Activities: Array.isArray(raw.Activities) ? raw.Activities.filter(obj).map(activity => ({
            activity_type_name: str(activity.activity_type_name),
            planned_amount: finite(activity.planned_amount) ? activity.planned_amount : null,
            planned_amount_type: str(activity.planned_amount_type),
        })) : [],
    };
    const statusText = str(raw.workout_status_text)?.trim().toLowerCase();
    const status = statusText === "planned" || statusText === "completed" ? statusText : "unknown";
    return {
        sourceId: String(raw.key),
        provider: a.provider,
        accountId: a.accountId,
        raw: cachedRaw,
        workout: {
            date: validateDate(raw.workout_date.slice(0, 10)),
            name: str(raw.name),
            description: str(raw.description),
            status,
            isRace: typeof raw.is_race === "boolean" ? raw.is_race : null,
            activities,
        },
    };
}
interface Session {
    token: string;
    userKey: string;
}
export class FinalSurgeProvider implements TrainingPlanProvider {
    private sessions = new Map<string, Promise<Session>>();
    private retryAfter = new Map<string, number>();
    constructor(private readonly credentials: NodeJS.ProcessEnv | ((a: TrainingAccount) => Promise<Credentials>) = process.env,
        private readonly http: typeof fetch = fetch) { }
    private key(a: TrainingAccount): string {
        return JSON.stringify([a.userId, a.provider, a.accountId, a.credentialRef ?? a.credentialsEnv]);
    }
    private async login(credentials: Credentials): Promise<Session> {
        const r = await this.request("https://www.finalsurge.com/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...credentials, rememberMe: 0 }) });
        if (!r.ok) throw new Error("Final Surge authentication failed; check your login and try again");
        const b: unknown = await r.json().catch(() => null);
        if (!obj(b) || b.success !== true || !obj(b.data) || typeof b.data.token !== "string" || !b.data.token
            || typeof b.data.user_key !== "string" || !b.data.user_key) throw new Error("Invalid Final Surge authentication response");
        return { token: b.data.token, userKey: b.data.user_key };
    }
    /** Local onboarding only. Discover the external ID and reuse the login for initial sync. */
    async connect(userId: string, timezone: string, credentialRef: string, credentials: Credentials): Promise<TrainingAccount> {
        const session = await this.login(credentials);
        const account: TrainingAccount = { userId, timezone, credentialRef, provider: "final-surge", accountId: session.userKey };
        this.sessions.set(this.key(account), Promise.resolve(session));
        return account;
    }
    private async request(url: string | URL, init: RequestInit) {
        try {
            return await this.http(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20000) });
        }
        catch {
            throw new Error("Final Surge network request failed");
        }
    }
    private session(a: TrainingAccount, key: string): Promise<Session> {
        const existing = this.sessions.get(key);
        if (existing)
            return existing;
        const pending = (async () => {
            let credentials: Credentials;
            if (typeof this.credentials === "function") credentials = await this.credentials(a);
            else {
                const email = a.credentialsEnv && this.credentials[`${a.credentialsEnv}_EMAIL`];
                const password = a.credentialsEnv && this.credentials[`${a.credentialsEnv}_PASSWORD`];
                if (!email || !password) throw new Error("Final Surge credentials not configured; run training connect");
                credentials = { email, password };
            }
            const session = await this.login(credentials);
            if (session.userKey !== a.accountId) throw new Error("Final Surge account does not match configured profile");
            return session;
        })();
        this.sessions.set(key, pending);
        void pending.catch(() => { this.sessions.delete(key); this.retryAfter.set(key, Date.now() + 60000); });
        return pending;
    }
    async getWorkouts(a: TrainingAccount, start: string, end: string): Promise<ProviderWorkout[]> {
        const key = this.key(a);
        if ((this.retryAfter.get(key) ?? 0) > Date.now())
            throw new Error("Final Surge temporarily unavailable; retry later");
        for (let attempt = 0; attempt < 2; attempt++) {
            const session = await this.session(a, key);
            const url = new URL("https://beta.finalsurge.com/api/WorkoutList");
            url.search = new URLSearchParams({ scope: "USER", scopekey: session.userKey, startdate: start, enddate: end, ishistory: "false", completedonly: "false" }).toString();
            const r = await this.request(url, { headers: { Authorization: `Bearer ${session.token}` } });
            if (r.status === 401 || r.status === 403) {
                // Do not discard a newer session established by another in-flight request.
                if (await this.sessions.get(key) === session)
                    this.sessions.delete(key);
                if (attempt === 0)
                    continue;
                this.retryAfter.set(key, Date.now() + 60000);
            }
            if (r.status === 429) {
                const seconds = Number(r.headers.get("Retry-After"));
                this.retryAfter.set(key, Date.now() + Math.min(3600000, Math.max(60000, Number.isFinite(seconds) ? seconds * 1000 : 60000)));
            }
            if (!r.ok)
                throw new Error("Final Surge workout request failed");
            const b: unknown = await r.json().catch(() => null);
            if (!obj(b) || b.success === false || !Array.isArray(b.data))
                throw new Error("Invalid Final Surge workout response");
            return b.data.map(raw => { if (!obj(raw))
                throw new Error("Invalid Final Surge workout"); return normalizeFinalSurge(raw, a); });
        }
        throw new Error("Final Surge authentication failed");
    }
}
