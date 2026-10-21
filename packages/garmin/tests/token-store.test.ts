import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { FileTokenStore, type Tokens } from "../src/index";

const directories: string[] = [];

function sampleTokens(): Tokens {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: "mock-access", refresh_token: "mock-refresh", client_id: "mock-client",
    expires_at: expiresAt, refresh_token_expires_at: expiresAt + 7200, token_type: "Bearer",
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("file token store", () => {
  test("round-trips tokens with owner-only file permissions", async () => {
    const directory = await mkdtemp(join(process.env["TMPDIR"] ?? ".", "garmints-token-test-"));
    directories.push(directory);
    const store = new FileTokenStore(directory);
    const expected = sampleTokens();

    await store.save(expected);

    expect(await store.load()).toEqual(expected);
    const file = join(directory, "garmin_tokens.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});
