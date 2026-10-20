import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { userInfo } from "node:os";
import type { Database } from "bun:sqlite";
import { loadConfig } from "../config";
import { openDatabase } from "../database";
import { listUsers, resolveIdentity, setUserName, setUserTimezone } from "../users";
import { getAccount, connectAccount, trainingPlan } from "./plans";
import type { Secrets } from "./secrets";

export interface TrainingUI {
    ask(label: string, secret?: boolean): Promise<string>;
    log(message: string): void;
}
export async function terminalQuestion(label: string, secret = false): Promise<string> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run training commands in an interactive terminal");
    // Give readline the real output stream and prompt so it can preserve the
    // label during redraws. Printing a label before question("") can erase it.
    const muted = secret ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : undefined;
    const input = createInterface({ input: process.stdin, output: muted ?? process.stdout, terminal: true });
    if (secret) process.stdout.write(label + ": ");
    try { return await input.question(secret ? "" : label + ": "); }
    finally { input.close(); muted?.end(); if (secret) process.stdout.write("\n"); }
}
async function choose(ui: TrainingUI, label: string, options: string[]): Promise<number> {
    ui.log(label);
    options.forEach((option, index) => ui.log(`  ${index + 1}. ${option}`));
    while (true) {
        const value = (await ui.ask("Choose a number")).trim();
        if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= options.length) return Number(value) - 1;
        ui.log(`Enter a number from 1 to ${options.length}`);
    }
}
export async function runTrainingCommand(args: string[], db: Database, ui: TrainingUI,
    store: Secrets = Bun.secrets, http: typeof fetch = fetch): Promise<void> {
    const [command, option] = args;
    const reauthenticate = command === "connect" && option === "--reauth";
    if (!["connect", "upcoming", "refresh"].includes(command) || (args.length !== 1 && !(args.length === 2 && reauthenticate))) {
        throw new Error("Usage: bun run training connect [--reauth] | upcoming | refresh");
    }
    const profiles = listUsers(db);
    const firstRun = profiles.length === 0;
    if (firstRun && command !== "connect") throw new Error("No training account connected yet. Run bun run training connect");
    if (firstRun) ui.log("No profiles yet. Let's set up your local profile and connect your training account.");
    // Names label existing profiles; linked identities distinguish missing/duplicate names.
    const labels = profiles.map(p => {
        const identities = p.identities.map(i => `${i.platform}: ${i.externalId}`).join(", ");
        const label = p.name ? `${p.name}${identities ? ` (${identities})` : ""}` : identities || "Unnamed profile";
        const connection = getAccount(db, p.userId);
        const status = connection ? `${connection.provider === "final-surge" ? "Final Surge" : connection.provider} connected` : "no training account connected";
        return `${label} — ${status}`;
    });
    // With one local profile, read commands can run immediately. Connect always confirms the person.
    const selected = firstRun || (command !== "connect" && profiles.length === 1) ? 0 : await choose(ui, "Select an existing user", labels);
    let user = profiles[selected];
    if (command === "connect") {
        const connected = user && getAccount(db, user.userId);
        if (connected && !reauthenticate) {
            ui.log(`Training is already connected for ${user.name ?? "this profile"}. Using the saved login to refresh workouts…`);
            const result = await trainingPlan(db, user.userId, "refresh", store, http);
            if (result.stale) throw new Error("Could not refresh the saved connection. Retry training refresh, or use training connect --reauth to update the login");
            ui.log(`Synced ${result.workouts.length} workouts for ${result.start} through ${result.end}.`);
            return;
        }
        ui.log(connected ? "Update this profile's training login." : "This profile needs a training account connected. Enter your Final Surge login once; it will be saved securely.");
        const name = user?.name ?? (await ui.ask(firstRun ? "Your name" : "Name for this existing profile")).trim();
        if (!name || name.length > 100) throw new Error("Name must contain 1 to 100 characters");
        await choose(ui, "Select a training provider", ["Final Surge"]);
        const email = (await ui.ask("Final Surge email")).trim();
        const password = await ui.ask("Final Surge password", true);
        if (!email || !password) throw new Error("Email and password are required");
        if (firstRun) {
            // Bootstrap through the same identity resolver used by nutrition.
            // Local ownership comes from the OS login, never a guessed messaging identity.
            const resolved = resolveIdentity(db, "local", userInfo().username, name);
            if (resolved.created) setUserTimezone(db, resolved.userId, Intl.DateTimeFormat().resolvedOptions().timeZone);
            user = listUsers(db).find(profile => profile.userId === resolved.userId)!;
        }
        ui.log("Connecting to Final Surge and synchronizing…");
        const result = await connectAccount(db, user.userId, "final-surge", { email, password }, store, http);
        if (!user.name) setUserName(db, user.userId, name);
        ui.log(`Connected Final Surge for ${name}.`);
        if (result.warning) ui.log(result.warning);
        if (result.sync.stale) throw new Error("Account connected, but initial synchronization failed. Run bun run training refresh to retry");
        ui.log(`Synced ${result.sync.workouts.length} workouts for ${result.sync.start} through ${result.sync.end}.`);
    } else {
        const result = await trainingPlan(db, user.userId, command === "refresh" ? "refresh" : { days: 14 }, store, http);
        ui.log(JSON.stringify(result, null, 2));
        if (result.stale) throw new Error("Training refresh failed; any displayed workouts are cached and may be outdated");
    }
}
if (import.meta.main) {
    const db = openDatabase(loadConfig().databasePath);
    try { await runTrainingCommand(process.argv.slice(2), db, { ask: terminalQuestion, log: console.log }); }
    catch (error) { console.error(error instanceof Error ? error.message : "Training command failed"); process.exitCode = 1; }
    finally { db.close(); }
}
