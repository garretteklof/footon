import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db/database";

async function host(trainingOnly: boolean) {
  const directory = mkdtempSync(join(tmpdir(), "fueld-mcp-"));
  const databasePath = join(directory, "test.sqlite");
  const users = {
    USER_1_NAME: "Alex", USER_1_IMESSAGE_PHONE: "+15551234567", USER_1_TIMEZONE: "America/Chicago",
    USER_1_FINAL_SURGE_EMAIL: "alex@example.test", USER_1_FINAL_SURGE_PASSWORD: "test-secret-one",
    USER_2_NAME: "Sam", USER_2_IMESSAGE_PHONE: "+15559876543", USER_2_TIMEZONE: "America/Los_Angeles",
    USER_2_FINAL_SURGE_EMAIL: "sam@example.test", USER_2_FINAL_SURGE_PASSWORD: "test-secret-two",
  };
  const child = Bun.spawn([process.execPath, "src/index.ts", ...(trainingOnly ? ["--training-only"] : [])], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, ...users, FUELD_B_PATH: databasePath, FDC_API_KEY: trainingOnly ? "" : "test" },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
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
    pending.set(id, response => {
      pending.delete(id); clearTimeout(timer);
      response.error ? reject(new Error(response.error.message)) : resolve(response.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const close = async () => { child.kill(); await child.exited; await reader; rmSync(directory, { recursive: true, force: true }); };
  try {
    await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return { rpc, databasePath, close,
      call: (name: string, args: unknown, senderId?: string) => rpc("tools/call", {
        name, arguments: args,
        ...(senderId ? { _meta: { "com.hermarium/trusted-sender": { platform: "bluebubbles", chatType: "dm", senderId } } } : {}),
      }) };
  } catch (error) { await close(); throw error; }
}
test("full MCP resolves only trusted senders and enforces per-user nutrition ownership", async () => {
  const h = await host(false);
  const value = (result: any) => JSON.parse(result.content[0].text);
  try {
    const tools = (await h.rpc("tools/list", {})).tools.map((tool: any) => tool.name);
    expect(tools.sort()).toEqual(["search_foods", "get_food_nutrients", "log_food", "update_entry", "delete_entry", "daily_nutrition_summary", "getWeeklyTrainingPlan", "getUpcomingWorkouts", "getWorkoutForDate", "refreshTrainingPlan"].sort());
    const db = openDatabase(h.databasePath), entryId = crypto.randomUUID();
    db.query("INSERT INTO food_logs VALUES (?,?,?,?,?,?,?)").run(entryId, "user-1", 9, "Apple", 100, "2026-10-20T15:00:00.000Z",
      JSON.stringify({ caloriesKcal: 100, proteinG: 5, carbohydratesG: 20, fatG: 1, fiberG: 3, sodiumMg: 0 }));
    db.close();
    expect((await h.call("daily_nutrition_summary", { date: "2026-10-20" }, "+15551234567")).content[0].text)
      .toContain('"entry_count": 1');
    expect(value(await h.call("daily_nutrition_summary", { date: "2026-10-20" }, "+15559876543")))
      .toMatchObject({ timezone: "America/Los_Angeles", totals: { entry_count: 0 }, entries: [] });
    expect((await h.call("daily_nutrition_summary", { date: "2026-10-20" })).isError).toBe(true);
    expect((await h.call("daily_nutrition_summary", { date: "2026-10-20", userId: "user-1" }, "+15559876543")).isError).toBe(true);
    expect(value(await h.call("delete_entry", { entryId }, "+15559876543"))).toMatchObject({ success: false, error: { code: "forbidden" } });
    expect(value(await h.call("delete_entry", { entryId }, "+15551234567"))).toMatchObject({ success: true });
    expect((await h.call("daily_nutrition_summary", { date: "2026-10-20" }, "+15550000000")).isError).toBe(true);
    const users = openDatabase(h.databasePath);
    expect(users.query("SELECT id FROM users ORDER BY id").all()).toEqual([{ id: "user-1" }, { id: "user-2" }]);
    users.close();
  } finally { await h.close(); }
}, 10000);
test("training-only MCP starts without a USDA key and exposes the same training tools", async () => {
  const h = await host(true);
  try {
    expect((await h.rpc("tools/list", {})).tools.map((tool: any) => tool.name).sort())
      .toEqual(["getWeeklyTrainingPlan", "getUpcomingWorkouts", "getWorkoutForDate", "refreshTrainingPlan"].sort());
  } finally { await h.close(); }
}, 10000);
