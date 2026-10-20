import type { Database } from "bun:sqlite";
import { TrainingRepository } from "./repository";
import { TrainingPlanService } from "./service";
import { FinalSurgeProvider } from "./providers/final-surge";
import { credentialReader, SystemCredentialStore, type CredentialStore } from "./credentials";
export function createTrainingService(db: Database, env: NodeJS.ProcessEnv = process.env, store: CredentialStore = new SystemCredentialStore(), http: typeof fetch = fetch) {
    const finalSurge = new FinalSurgeProvider(credentialReader(store, env), http);
    return new TrainingPlanService(new TrainingRepository(db), a => {
        switch (a.provider) {
            case "final-surge": return finalSurge;
            default: throw new Error("Unsupported configured training-plan provider");
        }
    });
}
