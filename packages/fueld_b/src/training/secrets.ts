export type Credentials = { email: string; password: string };
export type Secrets = Pick<typeof Bun.secrets, "get" | "set" | "delete">;
const service = "hermarium.training";

export async function readCredentials(reference: string, secrets: Secrets): Promise<Credentials> {
  try {
    const value = JSON.parse(await secrets.get({ service, name: reference }) ?? "null") as Partial<Credentials> | null;
    if (typeof value?.email !== "string" || !value.email || typeof value.password !== "string" || !value.password) throw new Error();
    return { email: value.email, password: value.password };
  } catch { throw new Error("Cannot read training credentials; unlock the OS credential store or run training connect --reauth"); }
}
export async function saveCredentials(reference: string, credentials: Credentials, secrets: Secrets): Promise<void> {
  try { await secrets.set({ service, name: reference, value: JSON.stringify(credentials) }); }
  catch { throw new Error("Cannot save credentials to the OS credential store; unlock it and retry training connect"); }
}
export async function deleteCredentials(reference: string, secrets: Secrets): Promise<void> {
  try { await secrets.delete({ service, name: reference }); }
  catch { throw new Error("Cannot remove previous credentials from the OS credential store"); }
}
