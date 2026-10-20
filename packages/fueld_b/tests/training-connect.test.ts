import { afterEach, expect, test } from "bun:test";
import { fixture, closeFixtures, scriptedUI } from "./training-fixture";
import { runTrainingCommand } from "../src/training/cli";
import { connectAccount, getAccount } from "../src/training/plans";
import { readCredentials, saveCredentials, deleteCredentials } from "../src/training/secrets";
import { listUsers } from "../src/users";
afterEach(closeFixtures);

test("connect selects an existing person, discovers the account, and stores credentials only in native secrets", async () => {
  const x = fixture(), ui = scriptedUI(["1", "1", "alice", "private-password"]);
  await runTrainingCommand(["connect"], x.db, ui.ui, x.secrets, x.http);
  const account = getAccount(x.db, x.alice)!;
  expect(account.accountId).toBe("external-alice");
  expect(JSON.parse(x.values.get(account.credentialRef)!)).toEqual({ email: "alice", password: "private-password" });
  expect(x.state.logins).toEqual(["alice"]); expect(x.state.tokens).toEqual(["Bearer token-alice"]);
  expect(ui.prompts.find(p => p.label === "Final Surge password")?.secret).toBe(true);
  const stored = JSON.stringify(x.db.query("SELECT * FROM training_accounts").all());
  for (const secret of ["private-password", "token-alice"]) {
    expect(stored).not.toContain(secret); expect(ui.output.join("\n")).not.toContain(secret);
  }
  expect(listUsers(x.db)).toHaveLength(2);
});
test("unnamed profiles are labeled on the existing user and invalid selections are retried", async () => {
  const x = fixture(); x.db.query("UPDATE users SET display_name=NULL WHERE id=?").run(x.alice);
  const ui = scriptedUI(["99", "bad", "1", "Alice", "1", "alice", "pw"]);
  await runTrainingCommand(["connect"], x.db, ui.ui, x.secrets, x.http);
  expect(ui.output.join("\n")).toContain("imessage: alice-sender");
  expect(listUsers(x.db).find(p => p.userId === x.alice)?.name).toBe("Alice");
  expect(listUsers(x.db)).toHaveLength(2);
});
test("rejected login and locked secret storage preserve the previous connection", async () => {
  const x = fixture(); await x.connect();
  const previous = getAccount(x.db, x.alice);
  x.state.reject = true;
  await expect(x.connect()).rejects.toThrow("authentication failed");
  x.state.reject = false;
  const locked = { ...x.secrets, async set() { throw new Error("private secret"); } };
  await expect(connectAccount(x.db, x.alice, "final-surge", { email: "alice", password: "new" }, locked, x.http)).rejects.toThrow("Cannot save");
  expect(getAccount(x.db, x.alice)).toEqual(previous); expect(x.values.size).toBe(1);
});
test("one external account cannot be connected to two profiles", async () => {
  const x = fixture(); await x.connect();
  await expect(x.connect(x.bob, "alice")).rejects.toThrow("another user");
  expect(getAccount(x.db, x.bob)).toBeNull(); expect(x.values.size).toBe(1);
});
test("a database association race removes the new secret and preserves the previous connection", async () => {
  const x = fixture(); await x.connect(); const previous = getAccount(x.db, x.alice);
  const racing = { ...x.secrets, async set(options: Parameters<typeof x.secrets.set>[0]) {
    await x.secrets.set(options);
    x.db.query("INSERT INTO training_accounts (user_id,provider,account_id,credential_ref) VALUES (?,?,?,?)")
      .run(x.bob, "final-surge", "external-new", "other-person");
  } };
  await expect(connectAccount(x.db, x.alice, "final-surge", { email: "new", password: "new-password" }, racing, x.http))
    .rejects.toThrow("previous connection was preserved");
  expect(getAccount(x.db, x.alice)).toEqual(previous);
  expect(x.values.size).toBe(1);
});
test("saved connections reuse credentials and explicit reauthentication rotates the secret", async () => {
  const x = fixture(); await x.connect();
  const previous = getAccount(x.db, x.alice)!.credentialRef;
  const reuse = scriptedUI(["1"]);
  await runTrainingCommand(["connect"], x.db, reuse.ui, x.secrets, x.http);
  expect(reuse.prompts.map(p => p.label)).toEqual(["Choose a number"]);
  expect(getAccount(x.db, x.alice)!.credentialRef).toBe(previous);
  const reauth = scriptedUI(["1", "1", "alice", "new"]);
  await runTrainingCommand(["connect", "--reauth"], x.db, reauth.ui, x.secrets, x.http);
  const reference = getAccount(x.db, x.alice)!.credentialRef;
  expect(reference).not.toBe(previous); expect(x.values.has(previous)).toBe(false);
  expect(JSON.parse(x.values.get(reference)!).password).toBe("new");
});
test("failed initial synchronization retains the account and reports how to retry", async () => {
  const x = fixture(); x.state.unavailable = true;
  await expect(runTrainingCommand(["connect"], x.db, scriptedUI(["1", "1", "alice", "pw"]).ui, x.secrets, x.http)).rejects.toThrow("Account connected, but initial synchronization failed");
  expect(getAccount(x.db, x.alice)!.accountId).toBe("external-alice");
  expect(x.values.size).toBe(1);
});
test("reauthentication preserves the successful snapshot if the provider is unavailable", async () => {
  const x = fixture(); await x.connect(); const snapshot = getAccount(x.db, x.alice)!.snapshot;
  x.state.unavailable = true;
  const result = await x.connect();
  expect(result.sync.stale).toBe(true); expect(getAccount(x.db, x.alice)!.snapshot).toBe(snapshot);
});
test("first-run onboarding and later reconnect reuse the same local profile", async () => {
  const x = fixture(); x.db.query("DELETE FROM users").run();
  const first = scriptedUI(["Garrett", "1", "alice", "pw"]);
  await runTrainingCommand(["connect"], x.db, first.ui, x.secrets, x.http);
  const profiles = listUsers(x.db);
  expect(profiles).toHaveLength(1); expect(profiles[0].name).toBe("Garrett");
  expect(profiles[0].identities[0].platform).toBe("local");
  expect(profiles[0].timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const again = scriptedUI(["1"]);
  await runTrainingCommand(["connect"], x.db, again.ui, x.secrets, x.http);
  expect(again.prompts.map(p => p.label)).toEqual(["Choose a number"]);
  expect(listUsers(x.db)[0].userId).toBe(profiles[0].userId);
});
test("blank names, cancellation, and empty-database read commands do not create profiles", async () => {
  const x = fixture(); x.db.query("DELETE FROM users").run();
  for (const answers of [[" "], ["Alex", "1"]])
    await expect(runTrainingCommand(["connect"], x.db, scriptedUI(answers).ui, x.secrets, x.http)).rejects.toThrow();
  for (const command of ["upcoming", "refresh"])
    await expect(runTrainingCommand([command], x.db, scriptedUI([]).ui, x.secrets, x.http)).rejects.toThrow("Run bun run training connect");
  expect(listUsers(x.db)).toEqual([]); expect(x.values.size).toBe(0);
});
test("one-profile reads do not prompt and command validation has no side effects", async () => {
  const x = fixture(); x.db.query("DELETE FROM users WHERE id=?").run(x.bob); await x.connect();
  const ui = scriptedUI([]);
  await runTrainingCommand(["upcoming"], x.db, ui.ui, x.secrets, x.http);
  expect(ui.prompts).toEqual([]); expect(ui.output.join("")).toContain('"stale": false');
  await expect(runTrainingCommand(["bad"], x.db, ui.ui, x.secrets, x.http)).rejects.toThrow("Usage");
});
test("credential errors and malformed secret values never expose native details or fall back to plaintext", async () => {
  const x = fixture(), locked = {
    ...x.secrets,
    async get(): Promise<string | null> { throw new Error("private native detail"); },
    async set() { throw new Error("private password"); },
    async delete(): Promise<boolean> { throw new Error("private token"); },
  };
  await expect(readCredentials("ref", locked)).rejects.toThrow("Cannot read");
  await expect(saveCredentials("ref", { email: "x", password: "s" }, locked)).rejects.toThrow("Cannot save");
  await expect(deleteCredentials("ref", locked)).rejects.toThrow("Cannot remove");
  x.values.set("ref", '{"email":"x","password":5}');
  await expect(readCredentials("ref", x.secrets)).rejects.toThrow("Cannot read");
});
test("old-secret cleanup failures warn without undoing a valid new connection", async () => {
  const x = fixture(); await x.connect();
  const locked = { ...x.secrets, async delete(): Promise<boolean> { throw new Error("private token"); } };
  const result = await connectAccount(x.db, x.alice, "final-surge", { email: "alice", password: "new" }, locked, x.http);
  expect(result.warning).toContain("previous credential entry");
  expect(result.sync.stale).toBe(false);
});
