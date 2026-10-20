import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/database";
import { resolveIdentity } from "../src/users";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

describe("database path configuration", () => {
  test("defaults to data/nutrition.sqlite under the project root", () => {
    expect(loadConfig({}).databasePath).toBe(join(projectRoot, "data", "nutrition.sqlite"));
  });

  test("resolves relative overrides from the project root and preserves absolute overrides", () => {
    expect(loadConfig({ FUELD_B_PATH: "custom/nutrition.sqlite" }).databasePath)
      .toBe(join(projectRoot, "custom", "nutrition.sqlite"));
    expect(loadConfig({ FUELD_B_PATH: "/tmp/custom.sqlite" }).databasePath).toBe("/tmp/custom.sqlite");
  });

  test("creates the parent directory for a new SQLite database", () => {
    const directory = mkdtempSync(join(tmpdir(), "fueld_b-test-"));
    const databasePath = join(directory, "data", "nutrition.sqlite");
    let db = openDatabase(databasePath);
    const user = resolveIdentity(db, "imessage", "persistent");
    db.close();
    db = openDatabase(databasePath);
    expect(resolveIdentity(db, "imessage", "persistent")).toMatchObject({ userId: user.userId, created: false });
    db.close();
    expect(existsSync(databasePath)).toBe(true);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    rmSync(directory, { recursive: true, force: true });
  });
});
