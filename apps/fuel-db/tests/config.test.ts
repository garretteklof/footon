import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { openDatabase } from "../src/db/database";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

describe("database path configuration", () => {
  test("defaults to data/nutrition.sqlite under the project root", () => {
    expect(loadConfig({}).databasePath).toBe(join(projectRoot, "data", "nutrition.sqlite"));
  });

  test("resolves relative overrides from the project root and preserves absolute overrides", () => {
    expect(loadConfig({ FUEL_DB_PATH: "custom/nutrition.sqlite" }).databasePath)
      .toBe(join(projectRoot, "custom", "nutrition.sqlite"));
    expect(loadConfig({ FUEL_DB_PATH: "/tmp/custom.sqlite" }).databasePath).toBe("/tmp/custom.sqlite");
  });

  test("creates the parent directory for a new SQLite database", () => {
    const directory = mkdtempSync(join(tmpdir(), "fuel-db-test-"));
    const databasePath = join(directory, "data", "nutrition.sqlite");
    const db = openDatabase(databasePath);
    db.close();
    expect(existsSync(databasePath)).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });
});
