import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, describe, test } from "bun:test";
import { parseConfig } from "../src/config";
import { normalizePhone } from "../src/utils/phone";
import { databasePath, openDatabase } from "../src/database";

const input = {
  fdcApiKey: "placeholder",
  users: {
    garrett: { name: "Garrett", phone: "(555) 123-4567", timezone: "America/Chicago" },
    emily: { name: "Emily", phone: "+1 555 987 6543", timezone: "America/Los_Angeles", training: { provider: "final-surge", email: "emily@example.test", password: "private" } },
  },
};

describe("static JSON configuration", () => {
  test("normalizes phone numbers and uses JSON keys as stable user IDs", () => {
    expect(normalizePhone("00 44 20 7946 0958")).toBe("+442079460958");
    expect(() => normalizePhone("12345678")).toThrow("E.164");
    const config = parseConfig(input);
    expect(parseConfig({ users: input.users }).fdcApiKey).toBe("");
    expect(config.users.map(({ id, phone }) => [id, phone])).toEqual([["garrett", "+15551234567"], ["emily", "+15559876543"]]);
    expect(config.users[0].training).toBeUndefined();
    expect(config.users[1].training?.provider).toBe("final-surge");
  });

  test("rejects invalid config without including secrets in errors", () => {
    expect(() => parseConfig({ ...input, users: { ...input.users, emily: { ...input.users.emily, phone: input.users.garrett.phone } } })).toThrow("unique");
    expect(() => parseConfig({ ...input, users: { ...input.users, emily: { ...input.users.emily, timezone: "Mars/Olympus_Mons" } } })).toThrow("IANA");
    expect(() => parseConfig({ ...input, users: { garrett: input.users.garrett } })).toThrow("Configure exactly two users");
    try { parseConfig({ ...input, users: { ...input.users, emily: { ...input.users.emily, training: { provider: "final-surge", email: "", password: "secret-not-in-error" } } } }); }
    catch (error) { expect(String(error)).not.toContain("secret-not-in-error"); }
  });

  test("uses fixed herm.sqlite outside src and creates private database files", () => {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const expectedDataPath = join(packageRoot, "data", "herm.sqlite");
    expect(databasePath).toBe(expectedDataPath);
    expect(relative(join(packageRoot, "src"), databasePath).startsWith("..")).toBe(true);
    const directory = mkdtempSync(join(tmpdir(), "footon-mcp-test-"));
    const path = join(directory, "data", "herm.sqlite");
    const db = openDatabase(path);
    expect(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name))
      .toEqual(["food_logs", "training_accounts"]);
    db.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "data")).mode & 0o777).toBe(0o700);
    rmSync(directory, { recursive: true, force: true });
  });
});
