import { afterEach, expect, test } from "bun:test";
import { openDatabase } from "../src/db/database";
import { NutritionRepository } from "../src/db/repositories";
import { TrainingRepository } from "../src/training/repository";
import { FinalSurgeProvider } from "../src/training/providers/final-surge";
import { connectTrainingAccount } from "../src/training/connect";
import { runTrainingCommand, type TrainingUI } from "../src/training/cli";
import { createTrainingService } from "../src/training/runtime";
import { credentialReader, SystemCredentialStore, type Credentials, type CredentialStore } from "../src/training/credentials";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
class MemorySecrets implements CredentialStore {
    values = new Map<string, Credentials>();
    async get(ref: string) { const c = this.values.get(ref); if (!c) throw new Error("Missing test credentials"); return c; }
    async set(ref: string, c: Credentials) { this.values.set(ref, c); }
    async delete(ref: string) { this.values.delete(ref); }
}
function fixture() {
    const db = openDatabase(":memory:"); databases.push(db);
    const users = new NutritionRepository(db), repo = new TrainingRepository(db), store = new MemorySecrets();
    const alice = users.resolveIdentity("imessage", "alice-sender", "Alice").userId;
    const bob = users.resolveIdentity("hermex", "bob-sender", "Bob").userId;
    const state = { logins: [] as string[], tokens: [] as string[], reject: false, unavailable: false };
    const http = (async (url: unknown, init?: RequestInit) => {
        if (String(url).endsWith("/login")) {
            const body = JSON.parse(init!.body as string); state.logins.push(body.email);
            if (state.reject) return new Response(null, { status: 401 });
            return Response.json({ success: true, data: { token: "token-" + body.email, user_key: "external-" + body.email } });
        }
        const u = new URL(String(url));
        const token = (init!.headers as Record<string, string>).Authorization; state.tokens.push(token);
        if (state.unavailable) return new Response(null, { status: 503 });
        return Response.json({ data: [{ key: "shared-workout-id", workout_date: u.searchParams.get("startdate"), name: "Run", workout_completion: "planned" }] });
    }) as typeof fetch;
    return { db, users, repo, store, alice, bob, state, http,
        provider: () => new FinalSurgeProvider(credentialReader(store), http) };
}
function scriptedUI(answers: string[]) {
    const output: string[] = [], prompts: { label: string; secret?: boolean }[] = [];
    const ui: TrainingUI = {
        log: message => output.push(message),
        async ask(label, secret) { prompts.push({ label, secret }); const value = answers.shift(); if (value === undefined) throw new Error("Unexpected prompt: " + label); return value; },
    };
    return { ui, output, prompts };
}
test("connect selects an existing name, discovers account, syncs once, and keeps secrets out of SQLite and output", async () => {
    const x = fixture(), ui = scriptedUI(["1", "1", "alice@example.test", "private-password"]);
    await runTrainingCommand(["connect"], x.db, ui.ui, x.store, x.http);
    const a = x.repo.accountForUser(x.alice);
    expect(a.accountId).toBe("external-alice@example.test"); expect(a.credentialsEnv).toBeUndefined(); expect(a.credentialRef).toBeTruthy();
    expect(x.store.values.get(a.credentialRef!)?.password).toBe("private-password");
    expect(x.state.logins).toEqual(["alice@example.test"]); expect(x.state.tokens).toEqual(["Bearer token-alice@example.test"]);
    expect(ui.output.join("\n")).toContain("Alice"); expect(ui.output.join("\n")).toContain("Synced 1 workouts");
    expect(ui.prompts.find(p => p.label === "Final Surge password")?.secret).toBe(true);
    const saved = JSON.stringify(x.db.query("SELECT * FROM training_plan_accounts").all()) + JSON.stringify(x.db.query("SELECT * FROM training_workouts").all());
    for (const secret of ["private-password", "token-alice@example.test"]) {
        expect(saved).not.toContain(secret); expect(ui.output.join("\n")).not.toContain(secret);
    }
    expect(x.users.listUsers()).toHaveLength(2);
});
test("unnamed profiles use linked identities for selection and save a friendly name on the same user", async () => {
    const x = fixture(); x.db.query("UPDATE users SET display_name=NULL WHERE id=?").run(x.alice);
    const ui = scriptedUI(["1", "Alice", "1", "alice@example.test", "pw"]);
    await runTrainingCommand(["connect"], x.db, ui.ui, x.store, x.http);
    expect(ui.output.join("\n")).toContain("imessage: alice-sender");
    expect(x.users.listUsers().find(u => u.userId === x.alice)?.name).toBe("Alice");
    expect(x.users.findIdentity("imessage", "alice-sender")).toBe(x.alice);
});
test("rejected login preserves previous connection and writes no credentials", async () => {
    const x = fixture(); await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"old"}, x.store, x.provider());
    const previous = x.repo.accountForUser(x.alice); x.state.reject = true;
    await expect(connectTrainingAccount(x.db, x.alice, {email:"alice",password:"bad"}, x.store, x.provider())).rejects.toThrow("authentication failed");
    expect(x.repo.accountForUser(x.alice)).toEqual(previous); expect(x.store.values.size).toBe(1);
});
test("secret-store failure leaves existing profile association intact", async () => {
    const x = fixture(); const failing = { ...x.store, get: x.store.get.bind(x.store), delete: x.store.delete.bind(x.store), async set() { throw new Error("Store locked"); } };
    await expect(connectTrainingAccount(x.db, x.alice, {email:"alice",password:"pw"}, failing, x.provider())).rejects.toThrow("Store locked");
    expect(() => x.repo.accountForUser(x.alice)).toThrow("No training-plan provider"); expect(x.store.values.size).toBe(0);
});
test("separate users and linked identities read only their associated provider/account after restart", async () => {
    const x = fixture(); x.users.linkIdentity(x.alice, "hermex", "also-alice");
    await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"a-secret"}, x.store, x.provider());
    await connectTrainingAccount(x.db, x.bob, {email:"bob",password:"b-secret"}, x.store, x.provider());
    const service = createTrainingService(x.db, {}, x.store, x.http);
    const a = await service.getWeeklyTrainingPlan(x.alice), b = await service.getWeeklyTrainingPlan(x.bob);
    expect(x.repo.accountForUser(x.alice).accountId).toBe("external-alice"); expect(x.repo.accountForUser(x.bob).accountId).toBe("external-bob");
    expect(a.workouts).toEqual(b.workouts);
    expect((await service.getWeeklyTrainingPlan({platform:"hermex",externalId:"also-alice"})).workouts).toEqual(a.workouts);
    await service.refreshTrainingPlan(x.bob);
    expect(x.state.logins).toEqual(["alice", "bob", "bob"]); expect(x.state.tokens.at(-1)).toBe("Bearer token-bob");
});
test("cannot connect an account already owned by another existing user", async () => {
    const x = fixture(); await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"pw"}, x.store, x.provider());
    await expect(connectTrainingAccount(x.db, x.bob, {email:"alice",password:"pw"}, x.store, x.provider())).rejects.toThrow("another user");
    expect(x.store.values.size).toBe(1); expect(() => x.repo.accountForUser(x.bob)).toThrow();
});
test("reconnecting replaces credentials and removes the old secret reference", async () => {
    const x = fixture(); await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"old"}, x.store, x.provider());
    const old = x.repo.accountForUser(x.alice).credentialRef!;
    await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"new"}, x.store, x.provider());
    expect(x.store.values.has(old)).toBe(false); expect(x.store.values.size).toBe(1);
    expect((await x.store.get(x.repo.accountForUser(x.alice).credentialRef!)).password).toBe("new");
});
test("initial sync failure retains the verified connection and CLI reports retry instructions", async () => {
    const x = fixture(); x.state.unavailable = true; const ui = scriptedUI(["1", "1", "alice", "pw"]);
    await expect(runTrainingCommand(["connect"], x.db, ui.ui, x.store, x.http)).rejects.toThrow("Account connected, but initial synchronization failed");
    expect(x.repo.accountForUser(x.alice).accountId).toBe("external-alice"); expect(x.store.values.size).toBe(1);
});
test("connect handles cancellation and invalid choices without creating additional identities", async () => {
    const x = fixture(), invalid = scriptedUI(["99", "no", "2", "1", "bob", "pw"]);
    await runTrainingCommand(["connect"], x.db, invalid.ui, x.store, x.http);
    expect(x.repo.accountForUser(x.bob).accountId).toBe("external-bob"); expect(x.users.listUsers()).toHaveLength(2);
    const cancelled: TrainingUI = { log() {}, async ask() { throw new Error("Cancelled"); } };
    await expect(runTrainingCommand(["connect"], x.db, cancelled, x.store, x.http)).rejects.toThrow("Cancelled");
    expect(x.store.values.size).toBe(1);
});
test("one-profile read commands do not prompt or require sender environment variables", async () => {
    const x = fixture(); x.db.query("DELETE FROM users WHERE id=?").run(x.bob);
    await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"pw"}, x.store, x.provider());
    const ui = scriptedUI([]); await runTrainingCommand(["refresh"], x.db, ui.ui, x.store, x.http);
    expect(ui.prompts).toEqual([]); expect(ui.output.join("")).toContain('"stale": false');
});
test("native credential-store errors are redacted and never fall back to plaintext", async () => {
    const store = new SystemCredentialStore({
        async get() { throw new Error("private OS detail"); },
        async set() { throw new Error("private password"); },
        async delete() { throw new Error("private token"); },
    });
    await expect(store.get("ref")).rejects.toThrow("Cannot read training credentials");
    await expect(store.set("ref", {email:"x",password:"s"})).rejects.toThrow("Cannot save credentials");
    await expect(store.delete("ref")).rejects.toThrow("Cannot remove previous credentials");
});

test("fresh database onboarding asks for a name and connects without an identity prerequisite", async () => {
    const x = fixture(); x.db.query("DELETE FROM users").run();
    const ui = scriptedUI(["Garrett", "1", "alice", "pw"]);
    await runTrainingCommand(["connect"], x.db, ui.ui, x.store, x.http);
    const profiles = x.users.listUsers();
    expect(profiles).toHaveLength(1); expect(profiles[0].name).toBe("Garrett");
    expect(profiles[0].identities[0].platform).toBe("local");
    expect(profiles[0].timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(x.repo.accountForUser(profiles[0].userId).accountId).toBe("external-alice");
    expect(ui.prompts.map(p => p.label)).toEqual(["Your name", "Choose a number", "Final Surge email", "Final Surge password"]);
    expect(ui.output.join("\n")).toContain("Synced 1 workouts");
    // The next connection reuses the same existing profile and does not ask for its name.
    const reconnect = scriptedUI(["1"]);
    await runTrainingCommand(["connect"], x.db, reconnect.ui, x.store, x.http);
    expect(reconnect.prompts.map(p => p.label)).toEqual(["Choose a number"]);
    expect(reconnect.output.join("\n")).toContain("Using the saved login");
    expect(x.users.listUsers()).toHaveLength(1);
    expect(x.users.listUsers()[0].userId).toBe(profiles[0].userId);
    expect(x.store.values.size).toBe(1);
});
test("empty database read commands provide a direct connect instruction without creating users", async () => {
    const x = fixture(); x.db.query("DELETE FROM users").run();
    for (const command of ["upcoming", "refresh"]) {
        await expect(runTrainingCommand([command], x.db, scriptedUI([]).ui, x.store, x.http)).rejects.toThrow("Run bun run training connect");
    }
    expect(x.users.listUsers()).toEqual([]); expect(x.store.values.size).toBe(0);
});
test("first-run cancellation or blank name creates no profile or credentials", async () => {
    const x = fixture(); x.db.query("DELETE FROM users").run();
    await expect(runTrainingCommand(["connect"], x.db, scriptedUI([" "]).ui, x.store, x.http)).rejects.toThrow("Name must contain");
    await expect(runTrainingCommand(["connect"], x.db, scriptedUI(["Garrett", "1"]).ui, x.store, x.http)).rejects.toThrow("Unexpected prompt");
    expect(x.users.listUsers()).toEqual([]); expect(x.store.values.size).toBe(0); expect(x.state.logins).toEqual([]);
});

test("connect reuses only the selected person's saved credentials without asking for profile, provider or login details", async () => {
    const x = fixture();
    await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"alice-password"}, x.store, x.provider());
    await connectTrainingAccount(x.db, x.bob, {email:"bob",password:"bob-password"}, x.store, x.provider());
    const old = x.repo.accountForUser(x.bob).credentialRef, ui = scriptedUI(["2"]);
    await runTrainingCommand(["connect"], x.db, ui.ui, x.store, x.http);
    expect(ui.prompts.map(p => p.label)).toEqual(["Choose a number"]);
    expect(x.state.logins.at(-1)).toBe("bob"); expect(x.state.tokens.at(-1)).toBe("Bearer token-bob");
    expect(x.repo.accountForUser(x.bob).credentialRef).toBe(old); expect(x.store.values.size).toBe(2);
    expect(ui.output.join("\n")).toContain("Final Surge connected");
});
test("updating saved credentials requires explicit connect --reauth", async () => {
    const x = fixture(); await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"old"}, x.store, x.provider());
    const previous = x.repo.accountForUser(x.alice).credentialRef, ui = scriptedUI(["1", "1", "alice", "new"]);
    await runTrainingCommand(["connect", "--reauth"], x.db, ui.ui, x.store, x.http);
    const account = x.repo.accountForUser(x.alice);
    expect(account.credentialRef).not.toBe(previous); expect(x.store.values.has(previous!)).toBe(false);
    expect((await x.store.get(account.credentialRef!)).password).toBe("new");
    expect(ui.prompts.some(p => p.label === "Name for this existing profile")).toBe(false);
});
test("failed saved connection preserves it and gives explicit update instructions without asking for secrets", async () => {
    const x = fixture(); await connectTrainingAccount(x.db, x.alice, {email:"alice",password:"pw"}, x.store, x.provider());
    const previous = x.repo.accountForUser(x.alice); x.state.reject = true;
    const ui = scriptedUI(["1"]);
    await expect(runTrainingCommand(["connect"], x.db, ui.ui, x.store, x.http)).rejects.toThrow("connect --reauth");
    expect(ui.prompts.map(p => p.label)).toEqual(["Choose a number"]);
    expect(x.repo.accountForUser(x.alice)).toEqual(previous); expect(x.store.values.size).toBe(1);
});
