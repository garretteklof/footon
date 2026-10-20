import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { loadConfig, normalizePhone } from "../src/config";
import { openDatabase } from "../src/db/database";
import { initializeUsers, userForSender } from "../src/users";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const env = {
  USER_1_NAME: "Alex", USER_1_IMESSAGE_PHONE: "(555) 123-4567", USER_1_TIMEZONE: "America/Chicago",
  USER_1_FINAL_SURGE_EMAIL: "alex@example.test", USER_1_FINAL_SURGE_PASSWORD: "secret-one",
  USER_2_NAME: "Sam", USER_2_IMESSAGE_PHONE: "+1 555 987 6543", USER_2_TIMEZONE: "America/Los_Angeles",
  USER_2_FINAL_SURGE_EMAIL: "sam@example.test", USER_2_FINAL_SURGE_PASSWORD: "secret-two",
};

describe("static user configuration", () => {
  test("normalizes US and international phone formats and rejects ambiguous local numbers", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("00 44 20 7946 0958")).toBe("+442079460958");
    expect(() => normalizePhone("12345678")).toThrow("E.164");
  });

  test("loads two stable users and rejects duplicate sender numbers or invalid timezones", () => {
    const config = loadConfig(env);
    expect(config.users.map(({ id, phone }) => [id, phone])).toEqual([
      ["user-1", "+15551234567"], ["user-2", "+15559876543"],
    ]);
    expect(() => loadConfig({ ...env, USER_2_IMESSAGE_PHONE: "5551234567" })).toThrow("unique");
    expect(() => loadConfig({ ...env, USER_2_TIMEZONE: "Mars/Olympus_Mons" })).toThrow("IANA");
  });

  test("database path uses the package root and creates a private fresh database", () => {
    expect(loadConfig(env).databasePath).toBe(join(projectRoot, "data", "nutrition.sqlite"));
    expect(loadConfig({ ...env, FUELD_B_PATH: "custom/nutrition.sqlite" }).databasePath)
      .toBe(join(projectRoot, "custom", "nutrition.sqlite"));
    expect(loadConfig({ ...env, FUELD_B_PATH: "/tmp/custom.sqlite" }).databasePath).toBe("/tmp/custom.sqlite");
    const directory = mkdtempSync(join(tmpdir(), "fueld_b-test-"));
    const databasePath = join(directory, "data", "nutrition.sqlite");
    const db = openDatabase(databasePath);
    initializeUsers(db, loadConfig(env).users);
    expect(db.query("SELECT id FROM users ORDER BY id").all()).toEqual([{ id: "user-1" }, { id: "user-2" }]);
    expect(() => userForSender(loadConfig(env).users, "+15550000000")).toThrow("Unrecognized");
    db.close();
    expect(existsSync(databasePath)).toBe(true);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    rmSync(directory, { recursive: true, force: true });
  });

  test("legacy identity schema is reset without retaining obsolete profile tables", () => {
    const directory = mkdtempSync(join(tmpdir(), "fueld_b-legacy-")), path = join(directory, "old.sqlite");
    const old = new Database(path);
    old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, created_at TEXT, display_name TEXT, timezone TEXT); CREATE TABLE identities (platform TEXT, external_id TEXT, user_id TEXT); CREATE TABLE food_logs (id TEXT); CREATE TABLE training_accounts (user_id TEXT, credential_ref TEXT);");
    old.exec("INSERT INTO users VALUES ('old-user', '', 'Old', 'UTC')"); old.close();
    const db = openDatabase(path);
    expect(db.query<{ name: string }, []>("PRAGMA table_info(users)").all().map(row => row.name)).toEqual(["id", "name", "timezone"]);
    expect(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name))
      .toEqual(["food_logs", "training_accounts", "users"]);
    expect(db.query("SELECT * FROM users").all()).toEqual([]);
    db.close(); rmSync(directory, { recursive: true, force: true });
  });
});
