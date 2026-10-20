import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { NutritionRepository } from "../db/repositories";
import { TrainingRepository } from "./repository";
import { TrainingPlanService } from "./service";
import type { CredentialStore, Credentials } from "./credentials";
import type { FinalSurgeProvider } from "./providers/final-surge";

/** Local operator flow, never exposed as a model tool. */
export async function connectTrainingAccount(db: Database, userId: string, credentials: Credentials,
    store: CredentialStore, provider: FinalSurgeProvider) {
    const users = new NutritionRepository(db), repository = new TrainingRepository(db);
    users.assertUserExists(userId);
    const reference = randomUUID();
    const account = await provider.connect(userId, users.getUserTimezone(userId), reference, credentials);
    repository.assertAccountAvailable(userId, account.provider, account.accountId);
    const previousReference = repository.credentialReference(userId);
    await store.set(reference, credentials);
    try { repository.saveAccount(account); }
    catch {
        await store.delete(reference);
        throw new Error("Could not associate the training account; the previous connection was preserved");
    }
    let warning: string | null = null;
    if (previousReference) {
        try { await store.delete(previousReference); }
        catch { warning = "Connected, but the previous credential entry could not be removed from the OS credential store"; }
    }
    const service = new TrainingPlanService(repository, () => provider);
    const sync = await service.refreshTrainingPlan(userId);
    return { sync, warning };
}
