import { afterEach, expect, test } from "bun:test";
import { openDatabase } from "../src/db/database";
import { NutritionRepository } from "../src/db/repositories";
import { TrainingRepository } from "../src/training/repository";
import { TrainingPlanService } from "../src/training/service";
import { FinalSurgeProvider, normalizeFinalSurge } from "../src/training/providers/final-surge";
import { createTrainingService } from "../src/training/runtime";
import type { TrainingAccount } from "../src/training/model";
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0))
    db.close(); });
function setup() {
    const db = openDatabase(":memory:");
    databases.push(db);
    const users = new NutritionRepository(db), repo = new TrainingRepository(db);
    const alice = { platform: "imessage", externalId: "alice" }, bob = { platform: "imessage", externalId: "bob" };
    const a = users.resolveIdentity(alice.platform, alice.externalId).userId, b = users.resolveIdentity(bob.platform, bob.externalId).userId;
    repo.configure(a, "final-surge", "account-a", "ALICE");
    repo.configure(b, "final-surge", "account-b", "BOB");
    const state = { now: new Date("2026-10-20T12:00:00Z"), calls: [] as string[], fail: false, items: [{ key: "same", workout_date: "2026-10-21", description: "Intervals", workout_completion: 0, Activities: [{ laps: [1, 2] }] }] };
    const service = new TrainingPlanService(repo, () => ({ async getWorkouts(account, start, end) { state.calls.push(account.accountId + ":" + start + ":" + end); if (state.fail)
            throw new Error("secret"); return state.items.map(r => normalizeFinalSurge(r, account)); } }), () => state.now);
    return { db, users, repo, alice, bob, a, b, service, state };
}
test("linked identities and same source ID remain isolated by account", async () => {
    const x = setup();
    x.users.linkIdentity(x.a, "hermex", "also-alice");
    const a = await x.service.getUpcomingWorkouts(x.alice), b = await x.service.getUpcomingWorkouts(x.bob);
    expect((await x.service.getUpcomingWorkouts({ platform: "hermex", externalId: "also-alice" })).workouts).toEqual(a.workouts);
    expect(x.db.query("SELECT 1 FROM training_workouts WHERE user_id=? AND account_id='account-a'").get(x.a)).toBeTruthy();
    expect(x.db.query("SELECT 1 FROM training_workouts WHERE user_id=? AND account_id='account-b'").get(x.b)).toBeTruthy();
    expect(x.state.calls.length).toBe(2);
    expect(a.workouts[0].status).toBe("unknown");
    expect(x.db.query<{
        raw_json: string;
    }, [
    ]>("SELECT raw_json FROM training_workouts LIMIT 1").get()!.raw_json).toContain('"Activities"');
    expect(() => x.service.getUpcomingWorkouts({ platform: "imessage", externalId: "unknown" })).toThrow("No training-plan provider");
});
test("two week sync, TTL, and independent refresh", async () => {
    const x = setup();
    await x.service.getWeeklyTrainingPlan(x.alice);
    await x.service.getWeeklyTrainingPlan(x.bob);
    expect(x.state.calls[0]).toBe("account-a:2026-10-19:2026-11-01");
    await x.service.refreshTrainingPlan(x.alice);
    await x.service.getWeeklyTrainingPlan(x.bob);
    expect(x.state.calls.length).toBe(3);
    x.state.now = new Date("2026-10-20T12:31:00Z");
    await x.service.getWeeklyTrainingPlan(x.bob);
    expect(x.state.calls.length).toBe(4);
});
test("timezone determines local week", async () => {
    const x = setup();
    x.users.setUserTimezone(x.a, "America/Chicago");
    x.state.now = new Date("2026-10-19T02:00:00Z");
    x.state.items = [];
    const r = await x.service.refreshTrainingPlan(x.alice);
    expect(r.start).toBe("2026-10-12");
    expect(r.end).toBe("2026-10-25");
});
test("stale cache survives failures with sanitized warning", async () => {
    const x = setup();
    await x.service.refreshTrainingPlan(x.alice);
    x.state.fail = true;
    const r = await x.service.refreshTrainingPlan(x.alice);
    expect(r.stale).toBe(true);
    expect(r.workouts.length).toBe(1);
    expect(JSON.stringify(r)).not.toContain("secret");
});
test("reconciles moved/deleted workouts and rejects invalid ranges atomically", async () => {
    const x = setup();
    await x.service.refreshTrainingPlan(x.alice);
    x.state.items[0].workout_date = "2026-10-22";
    await x.service.refreshTrainingPlan(x.alice);
    expect((await x.service.getWorkoutForDate(x.alice, "2026-10-21")).workouts).toEqual([]);
    x.state.items[0].workout_date = "2026-12-01";
    expect((await x.service.refreshTrainingPlan(x.alice)).stale).toBe(true);
    expect((await x.service.getWorkoutForDate(x.alice, "2026-10-22")).workouts.length).toBe(1);
    x.state.items = [];
    await x.service.refreshTrainingPlan(x.alice);
    expect((await x.service.getUpcomingWorkouts(x.alice)).workouts).toEqual([]);
});
test("account and provider changes never return previous account cache", async () => {
    const x = setup();
    await x.service.refreshTrainingPlan(x.alice);
    x.repo.configure(x.a, "future", "account-a", "ALICE");
    await expect(createTrainingService(x.db).getUpcomingWorkouts(x.alice)).rejects.toThrow("Unsupported");
    x.repo.configure(x.a, "final-surge", "new-account", "ALICE");
    x.state.fail = true;
    expect((await x.service.refreshTrainingPlan(x.alice)).workouts).toEqual([]);
});
test("coalesces refreshes, preserves multiple workouts and validates input", async () => {
    const x = setup();
    x.state.items.push({ ...x.state.items[0], key: "two" });
    const r = await Promise.all([x.service.refreshTrainingPlan(x.alice), x.service.refreshTrainingPlan(x.alice)]);
    expect(r[0].workouts.length).toBe(2);
    expect(x.state.calls.length).toBe(1);
    expect(() => x.service.getUpcomingWorkouts(x.alice, 0)).toThrow();
    expect(() => x.service.getWorkoutForDate(x.alice, "2026-02-30")).toThrow();
    expect((await x.service.getWeeklyTrainingPlan(x.a)).workouts).toEqual((await x.service.getWeeklyTrainingPlan(x.alice)).workouts);
});
const account = (id: string): TrainingAccount => ({ userId: id, provider: "final-surge", accountId: id, credentialsEnv: id.toUpperCase(), timezone: "UTC" });
const fake = (fn: (url: string, init?: RequestInit) => Response) => ((url: unknown, init?: RequestInit) => Promise.resolve(fn(String(url), init))) as typeof fetch;
test("independent sessions, coalesced logins, bearer auth without cookies", async () => {
    let logins = 0;
    const headers: string[] = [];
    const client = new FinalSurgeProvider({ A_EMAIL: "a", A_PASSWORD: "p", B_EMAIL: "b", B_PASSWORD: "q" }, fake((url, init) => {
        if (url.endsWith("/login")) {
            logins++;
            const email = JSON.parse(init!.body as string).email;
            return Response.json({ success: true, data: { token: "token-" + email, user_key: email } });
        }
        headers.push((init!.headers as Record<string, string>).Authorization);
        expect((init!.headers as Record<string, string>).Cookie).toBeUndefined();
        expect(url).toContain("completedonly=false");
        return Response.json({ data: [] });
    }));
    await Promise.all([client.getWorkouts(account("a"), "2026-10-19", "2026-11-01"), client.getWorkouts(account("a"), "2026-10-19", "2026-11-01"), client.getWorkouts(account("b"), "2026-10-19", "2026-11-01")]);
    expect(logins).toBe(2);
    expect(headers.sort()).toEqual(["Bearer token-a", "Bearer token-a", "Bearer token-b"]);
});
test("reauthenticates once on 401", async () => {
    let logins = 0, requests = 0;
    const client = new FinalSurgeProvider({ A_EMAIL: "a", A_PASSWORD: "p" }, fake(url => {
        if (url.endsWith("/login")) {
            logins++;
            return Response.json({ success: true, data: { token: "t" + logins, user_key: "a" } });
        }
        requests++;
        return requests === 1 ? new Response(null, { status: 401 }) : Response.json({ data: [] });
    }));
    await client.getWorkouts(account("a"), "2026-10-19", "2026-11-01");
    expect(logins).toBe(2);
    expect(requests).toBe(2);
});
test("rejects mismatched account and backs off", async () => {
    let calls = 0;
    const client = new FinalSurgeProvider({ A_EMAIL: "private", A_PASSWORD: "secret" }, fake(() => { calls++; return Response.json({ success: true, data: { token: "secret-token", user_key: "someone-else" } }); }));
    await expect(client.getWorkouts(account("a"), "2026-10-19", "2026-11-01")).rejects.toThrow("does not match");
    await expect(client.getWorkouts(account("a"), "2026-10-19", "2026-11-01")).rejects.toThrow("retry later");
    expect(calls).toBe(1);
});
test("rate limiting cooldown avoids repeat requests", async () => {
    let calls = 0;
    const client = new FinalSurgeProvider({ A_EMAIL: "a", A_PASSWORD: "p" }, fake(url => { calls++; return url.endsWith("/login") ? Response.json({ success: true, data: { token: "t", user_key: "a" } }) : new Response(null, { status: 429, headers: { "Retry-After": "120" } }); }));
    await expect(client.getWorkouts(account("a"), "2026-10-19", "2026-11-01")).rejects.toThrow("request failed");
    await expect(client.getWorkouts(account("a"), "2026-10-19", "2026-11-01")).rejects.toThrow("retry later");
    expect(calls).toBe(2);
});
test("exposes compact normalized output and caches only selected provider fields", () => {
    const raw = { key: "w", workout_date: "2026-10-21T00:00:00", workout_status_text: "Planned", workout_completion: 0, is_race: true, name: null, description: "Warmup", planned_distance: 10, planned_distance_unit: "km", planned_duration_seconds: 3600, intensity: "easy", interval_details: "6 x 1 min", Activities: [{ activity_type_name: "Run", planned_amount: 2, planned_amount_type: "mi", amount: 4 }], unrecognized: { laps: [1, 2] } };
    const row = normalizeFinalSurge(raw, account("a"));
    expect(row.raw).toEqual({ workout_date: raw.workout_date, name: null, description: "Warmup", workout_status_text: "Planned", is_race: true, Activities: [{ activity_type_name: "Run", planned_amount: 2, planned_amount_type: "mi" }] });
    expect(row.workout).toEqual({ date: "2026-10-21", name: null, description: "Warmup", status: "planned", isRace: true, activities: [{ activityType: "Run", plannedAmount: 2, plannedAmountUnit: "mi" }] });
    expect(() => normalizeFinalSurge({ ...raw, workout_date: "2026-02-30" }, account("a"))).toThrow();
});
test("generic service can use another adapter without changing its interfaces", async () => {
    const x = setup();
    x.repo.configure(x.a, "example-test-only", "example-account", "ALICE");
    const service = new TrainingPlanService(x.repo, a => ({ async getWorkouts() {
            return [{ provider: a.provider, accountId: a.accountId, sourceId: "w", workout: { date: "2026-10-21", name: "Run", description: null, status: "planned", isRace: false, activities: [] }, raw: { source: "test" } }];
        } }), () => new Date("2026-10-20T12:00:00Z"));
    const r = await service.getUpcomingWorkouts(x.alice);
    expect(r.provider).toBe("example-test-only");
    expect(r.workouts[0].name).toBe("Run");
});

test("maps observed WorkoutList activity and race fields to compact output", () => {
    // Minimal anonymized shape from a real cached response; no source IDs or personal fields.
    const raw = {
        key: "planned-run", workout_date: "2026-10-21", name: "Run", workout_completion: 0, is_race: false,
        workout_status_text: "Planned", Activities: [{
            activity_type_name: "Run", planned_amount: 8, planned_amount_type: "mi",
            planned_amount_normalized: 12874.7767, planned_duration: null,
            amount: null, amount_type: null, duration: null,
        }],
    };
    const result = normalizeFinalSurge(raw, account("a"));
    expect(result.workout.activities[0]).toEqual({ activityType: "Run", plannedAmount: 8, plannedAmountUnit: "mi" });
    expect(result.workout.status).toBe("planned"); expect(result.workout.isRace).toBe(false);
    expect(result.raw).toEqual({ workout_date: "2026-10-21", name: "Run", description: null, workout_status_text: "Planned", is_race: false, Activities: [{ activity_type_name: "Run", planned_amount: 8, planned_amount_type: "mi" }] });
});
test("cache stores compact normalized output beside the original raw response", () => {
    const x=setup(),a=x.repo.accountForSender(x.alice);
    const raw={key:"run",workout_date:"2026-10-21",name:"Run",workout_status_text:"Planned",is_race:true,Activities:[{activity_type_name:"Run",planned_amount:8,planned_amount_type:"mi"}]};
    x.repo.replaceRange(a,"2026-10-19","2026-11-01",[normalizeFinalSurge(raw,a)],"2026-10-20T12:00:00Z");
    expect(x.repo.read(a,"2026-10-21","2026-10-21")[0]).toEqual({date:"2026-10-21",name:"Run",description:null,status:"planned",isRace:true,activities:[{activityType:"Run",plannedAmount:8,plannedAmountUnit:"mi"}]});
    expect(JSON.parse(x.db.query<{raw_json:string},[]>("SELECT raw_json FROM training_workouts").get()!.raw_json)).toEqual({ workout_date: "2026-10-21", name: "Run", description: null, workout_status_text: "Planned", is_race: true, Activities: [{ activity_type_name: "Run", planned_amount: 8, planned_amount_type: "mi" }] });
});
