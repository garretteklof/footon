import { NutritionRepository } from "../db/repositories";
import type { Database } from "bun:sqlite";
import type { TrainingAccount, ProviderWorkout, Workout } from "./model";
export class TrainingRepository {
    constructor(private readonly db: Database) { }
    accountForSender(sender: {
        platform: string;
        externalId: string;
    }): TrainingAccount {
        const userId = new NutritionRepository(this.db).findIdentity(sender.platform, sender.externalId);
        if (!userId) throw new Error("No training-plan provider configured for this sender");
        return this.accountForUser(userId);
    }
    accountForUser(userId: string): TrainingAccount {
        const account = this.findAccountForUser(userId);
        if (!account) throw new Error("No training-plan provider configured for this user; run bun run training connect");
        return account;
    }
    findAccountForUser(userId: string): TrainingAccount | null {
        const r = this.db.query<{
            user_id: string; provider: string; account_id: string;
            credentials_env: string; credential_ref: string | null; timezone: string;
        }, [string]>(`SELECT a.*, u.timezone FROM users u JOIN training_plan_accounts a ON a.user_id=u.id WHERE u.id=?`).get(userId);
        if (!r) return null;
        return { userId: r.user_id, provider: r.provider, accountId: r.account_id,
            credentialsEnv: r.credentials_env || undefined, credentialRef: r.credential_ref ?? undefined, timezone: r.timezone };
    }
    assertAccountAvailable(userId: string, provider: string, accountId: string): void {
        const owner = this.db.query<{ user_id: string }, [string, string]>(
            "SELECT user_id FROM training_plan_accounts WHERE provider=? AND account_id=?",
        ).get(provider, accountId);
        if (owner && owner.user_id !== userId) throw new Error("This training account is already connected to another user");
    }
    credentialReference(userId: string): string | undefined {
        return this.db.query<{ credential_ref: string | null }, [string]>(
            "SELECT credential_ref FROM training_plan_accounts WHERE user_id=?",
        ).get(userId)?.credential_ref ?? undefined;
    }
    saveAccount(a: TrainingAccount): void {
        this.db.query(`INSERT INTO training_plan_accounts (user_id,provider,account_id,credentials_env,credential_ref)
          VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,
          account_id=excluded.account_id,credentials_env=excluded.credentials_env,credential_ref=excluded.credential_ref`)
          .run(a.userId,a.provider,a.accountId,a.credentialsEnv ?? "",a.credentialRef ?? null);
    }
    configure(userId: string, provider: string, accountId: string, credentialsEnv: string) {
        if (!accountId || !/^[A-Z][A-Z0-9_]*$/.test(credentialsEnv))
            throw new Error("Invalid account configuration");
        this.db.query(`INSERT INTO training_plan_accounts (user_id,provider,account_id,credentials_env) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider, account_id=excluded.account_id, credentials_env=excluded.credentials_env,credential_ref=NULL`).run(userId, provider, accountId, credentialsEnv);
    }
    lastSync(a: TrainingAccount, start: string, end: string): string | null {
        return this.db.query<{
            synced_at: string;
        }, [
            string,
            string,
            string,
            string,
            string
        ]>(`SELECT synced_at FROM training_sync WHERE user_id=? AND provider=? AND account_id=? AND start_date<=? AND end_date>=? ORDER BY synced_at DESC LIMIT 1`).get(a.userId, a.provider, a.accountId, start, end)?.synced_at ?? null;
    }
    read(a: TrainingAccount, start: string, end: string): Workout[] {
        return this.db.query<{ normalized_json: string }, [string, string, string, string, string]>(
            `SELECT normalized_json FROM training_workouts WHERE user_id=? AND provider=? AND account_id=? AND workout_date BETWEEN ? AND ? ORDER BY workout_date,workout_id`,
        ).all(a.userId, a.provider, a.accountId, start, end).map(r => {
            const cached = JSON.parse(r.normalized_json) as Record<string, unknown>;
            const activities = Array.isArray(cached.activities) ? cached.activities.filter(
                (value): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value),
            ).map(activity => {
                const distance = typeof activity.plannedDistance === "object" && activity.plannedDistance !== null
                    ? activity.plannedDistance as Record<string, unknown> : null;
                return {
                    activityType: typeof activity.activityType === "string" ? activity.activityType
                        : typeof activity.name === "string" ? activity.name : null,
                    plannedAmount: typeof activity.plannedAmount === "number" ? activity.plannedAmount
                        : typeof distance?.value === "number" ? distance.value : null,
                    plannedAmountUnit: typeof activity.plannedAmountUnit === "string" ? activity.plannedAmountUnit
                        : typeof distance?.unit === "string" ? distance.unit : null,
                };
            }) : [];
            return {
                date: typeof cached.date === "string" ? cached.date : "",
                name: typeof cached.name === "string" && cached.name !== "Workout" ? cached.name : null,
                description: typeof cached.description === "string" ? cached.description : null,
                status: cached.status === "planned" || cached.status === "completed" ? cached.status : "unknown",
                isRace: typeof cached.isRace === "boolean" ? cached.isRace : null,
                activities,
            };
        });
    }
    replaceRange(a: TrainingAccount, start: string, end: string, rows: ProviderWorkout[], at: string) {
        const seen = new Set<string>();
        for (const { workout: w, provider, accountId, sourceId } of rows) {
            if (provider !== a.provider || accountId !== a.accountId || !sourceId || w.date < start || w.date > end || seen.has(sourceId))
                throw new Error("Invalid provider result");
            seen.add(sourceId);
        }
        this.db.transaction(() => {
            this.db.query(`DELETE FROM training_workouts WHERE user_id=? AND provider=? AND account_id=? AND workout_date BETWEEN ? AND ?`).run(a.userId, a.provider, a.accountId, start, end);
            for (const { workout: w, sourceId, raw } of rows)
                this.db.query(`INSERT INTO training_workouts VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,provider,account_id,workout_id) DO UPDATE SET workout_date=excluded.workout_date, normalized_json=excluded.normalized_json, raw_json=excluded.raw_json, synced_at=excluded.synced_at`).run(a.userId, a.provider, a.accountId, sourceId, w.date, JSON.stringify(w), JSON.stringify(raw), at);
            this.db.query(`DELETE FROM training_sync WHERE user_id=? AND provider=? AND account_id=? AND start_date<=? AND end_date>=?`).run(a.userId, a.provider, a.accountId, end, start);
            this.db.query(`INSERT INTO training_sync VALUES (?,?,?,?,?,?)`).run(a.userId, a.provider, a.accountId, start, end, at);
        })();
    }
}
