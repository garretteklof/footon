import type { TrainingAccount } from "./model";

export interface Credentials { email: string; password: string }
export interface CredentialStore {
    get(reference: string): Promise<Credentials>;
    set(reference: string, credentials: Credentials): Promise<void>;
    delete(reference: string): Promise<void>;
}
/** Native OS credential storage; no plaintext fallback or custom encryption. */
export class SystemCredentialStore implements CredentialStore {
    private readonly service = "hermarium.training";
    constructor(private readonly secrets: Pick<typeof Bun.secrets, "get" | "set" | "delete"> = Bun.secrets) {}
    async get(reference: string): Promise<Credentials> {
        try {
            const value = await this.secrets.get({ service: this.service, name: reference });
            const parsed: unknown = value ? JSON.parse(value) : null;
            if (!parsed || typeof parsed !== "object" || !("email" in parsed) || !("password" in parsed)
                || typeof parsed.email !== "string" || typeof parsed.password !== "string") throw new Error();
            return { email: parsed.email, password: parsed.password };
        } catch { throw new Error("Cannot read training credentials from the OS credential store; unlock it or run training connect --reauth"); }
    }
    async set(reference: string, credentials: Credentials): Promise<void> {
        try { await this.secrets.set({ service: this.service, name: reference, value: JSON.stringify(credentials) }); }
        catch { throw new Error("Cannot save credentials to the OS credential store; unlock it and retry training connect"); }
    }
    async delete(reference: string): Promise<void> {
        try { await this.secrets.delete({ service: this.service, name: reference }); }
        catch { throw new Error("Cannot remove previous credentials from the OS credential store"); }
    }
}
export function credentialReader(store: CredentialStore, env: NodeJS.ProcessEnv = process.env) {
    return async (a: TrainingAccount): Promise<Credentials> => {
        if (a.credentialRef) return store.get(a.credentialRef);
        // Compatibility for previously configured accounts. New connections never use env prefixes.
        const email = a.credentialsEnv && env[`${a.credentialsEnv}_EMAIL`];
        const password = a.credentialsEnv && env[`${a.credentialsEnv}_PASSWORD`];
        if (!email || !password) throw new Error("Training credentials missing; run training connect --reauth");
        return { email, password };
    };
}
