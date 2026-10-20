import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db/database";
import { localDateAt } from "../src/utils/time";

async function host() {
  const directory = mkdtempSync(join(tmpdir(), "fueld-mcp-"));
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const databasePath = join(directory, "data", "herm.sqlite");
  cpSync(join(packageRoot, "src"), join(directory, "src"), { recursive: true });
  symlinkSync(join(packageRoot, "node_modules"), join(directory, "node_modules"), "dir");
  mkdirSync(join(directory, "data"), { recursive: true });
  writeFileSync(join(directory, "config.local.json"), JSON.stringify({ fdcApiKey: "test", users: {
    alex: { name: "Alex", phone: "+15551234567", timezone: "America/Chicago", training: { provider: "final-surge", email: "alex@example.test", password: "test-secret-one" } },
    sam: { name: "Sam", phone: "+15559876543", timezone: "America/Los_Angeles", training: { provider: "final-surge", email: "sam@example.test", password: "test-secret-two" } },
  } }));
  const child = Bun.spawn([process.execPath, "src/index.ts"], {
    cwd: directory, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const pending = new Map<number, (value: any) => void>();
  let sequence = 0, buffer = "";
  const reader = (async () => {
    for await (const chunk of child.stdout) {
      buffer += new TextDecoder().decode(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line); pending.get(message.id)?.(message);
      }
    }
  })();
  const rpc = (method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP response timed out: " + method)); }, 3000);
    pending.set(id, response => { pending.delete(id); clearTimeout(timer); response.error ? reject(new Error(response.error.message)) : resolve(response.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const close = async () => { child.kill(); await child.exited; await reader; rmSync(directory, { recursive: true, force: true }); };
  try {
    await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return { rpc, databasePath, configPath: join(directory, "config.local.json"), close,
      call: (name: string, args: unknown, senderId?: string) => rpc("tools/call", {
        name, arguments: args,
        ...(senderId ? { _meta: { "com.hermarium/trusted-sender": { platform: "bluebubbles", chatType: "dm", senderId } } } : {}),
      }) };
  } catch (error) { await close(); throw error; }
}
test("full MCP resolves only trusted senders and enforces per-user nutrition ownership", async () => {
  const h = await host();
  const value = (result: any) => JSON.parse(result.content[0].text);
  try {
    const tools = (await h.rpc("tools/list", {})).tools.map((tool: any) => tool.name);
    expect((await import("node:fs")).statSync(h.configPath).mode & 0o777).toBe(0o600);
    expect(tools.sort()).toEqual(["search_foods", "get_food_nutrients", "log_food", "update_entry", "delete_entry", "daily_nutrition_summary", "getWeeklyTrainingPlan", "getUpcomingWorkouts", "getWorkoutForDate", "refreshTrainingPlan"].sort());
    const db = openDatabase(h.databasePath), entryId = crypto.randomUUID();
    db.query("INSERT INTO food_logs VALUES (?,?,?,?,?,?,?)").run(entryId, "alex", 9, "Apple", 100, "2026-10-20T15:00:00.000Z", JSON.stringify({ caloriesKcal: 100, proteinG: 5, carbohydratesG: 20, fatG: 1, fiberG: 3, sodiumMg: 0 }));
    db.close();
    expect((await h.call("daily_nutrition_summary", { date: "2026-10-20" }, "+15551234567")).content[0].text).toContain('"entry_count": 1');
    expect(value(await h.call("daily_nutrition_summary", { date: "2026-10-20" }, "+15559876543"))).toMatchObject({ timezone: "America/Los_Angeles", totals: { entry_count: 0 }, entries: [] });
    expect((await h.call("daily_nutrition_summary", { date: "2026-10-20" })).isError).toBe(true);
    expect((await h.call("daily_nutrition_summary", { date: "2026-10-20", userId: "alex" }, "+15559876543")).isError).toBe(true);
    expect(value(await h.call("delete_entry", { entryId }, "+15559876543"))).toMatchObject({ success: false, error: { code: "forbidden" } });
    expect(value(await h.call("delete_entry", { entryId }, "+15551234567"))).toMatchObject({ success: true });
    expect((await h.call("daily_nutrition_summary", { date: "2026-10-20" }, "+15550000000")).isError).toBe(true);
    const db2 = openDatabase(h.databasePath);
    expect(db2.query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()).toBeNull();
    expect(db2.query("SELECT count(*) AS count FROM food_logs WHERE user_id='unknown'").get()).toEqual({ count: 0 });
    db2.close();
  } finally { await h.close(); }
}, 10000);
test("training results are resolved and scoped to the trusted sender", async () => {
  const h = await host();
  try {
    const db = openDatabase(h.databasePath);
    const now = new Date().toISOString();
    const snapshot = (name: string, timezone: string) => JSON.stringify([{ date: localDateAt(Date.now(), timezone), name, description: null, status: "planned", isRace: null, activities: [] }]);
    for (const [id, name, timezone] of [["alex", "Alex private plan", "America/Chicago"], ["sam", "Sam private plan", "America/Los_Angeles"]])
      db.query("INSERT INTO training_accounts (user_id, snapshot_json, start_date, end_date, synced_at) VALUES (?, ?, '2000-01-01', '2099-12-31', ?)")
        .run(id, snapshot(name, timezone), now);
    db.close();
    const value = (result: any) => JSON.parse(result.content[0].text);
    expect(value(await h.call("getWeeklyTrainingPlan", {}, "+15551234567")).workouts[0].name).toBe("Alex private plan");
    expect(value(await h.call("getWeeklyTrainingPlan", {}, "+15559876543")).workouts[0].name).toBe("Sam private plan");
    expect((await h.call("getWeeklyTrainingPlan", { userId: "alex" }, "+15559876543")).isError).toBe(true);
  } finally { await h.close(); }
}, 10000);
