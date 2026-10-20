import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

async function host(trainingOnly: boolean) {
  const directory = mkdtempSync(join(tmpdir(), "fueld-mcp-"));
  const child = Bun.spawn([process.execPath, "src/index.ts", ...(trainingOnly ? ["--training-only"] : [])], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, FUELD_B_PATH: join(directory, "test.sqlite"), FDC_API_KEY: trainingOnly ? "" : "test" },
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
    return { rpc, close, call: (name: string, args: unknown) => rpc("tools/call", { name, arguments: args }) };
  } catch (error) { await close(); throw error; }
}
test("full MCP preserves tool contracts, resolved identities, nutrition results, and errors", async () => {
  const h = await host(false);
  const value = (result: any) => JSON.parse(result.content[0].text);
  try {
    const tools = (await h.rpc("tools/list", {})).tools.map((tool: any) => tool.name);
    expect(tools.sort()).toEqual(["resolve_identity", "link_identity", "set_user_timezone", "search_foods", "get_food_nutrients", "log_food", "update_entry", "delete_entry", "daily_nutrition_summary", "getWeeklyTrainingPlan", "getUpcomingWorkouts", "getWorkoutForDate", "refreshTrainingPlan"].sort());
    const { userId } = value(await h.call("resolve_identity", { platform: "imessage", externalId: "test", name: "Alex" }));
    expect(value(await h.call("resolve_identity", { platform: "imessage", externalId: "test" }))).toMatchObject({ userId, created: false });
    await h.call("set_user_timezone", { userId, timezone: "America/Chicago" });
    expect(value(await h.call("daily_nutrition_summary", { userId, date: "2026-10-20" })))
      .toMatchObject({ timezone: "America/Chicago", totals: { entry_count: 0, calories_kcal: null }, entries: [] });
    expect(value(await h.call("delete_entry", { userId, entryId: crypto.randomUUID() }))).toMatchObject({ success: false, error: { code: "not_found" } });
    expect((await h.call("getWeeklyTrainingPlan", { userId })).isError).toBe(true);
    expect((await h.call("set_user_timezone", { userId, timezone: "invalid" })).isError).toBe(true);
  } finally { await h.close(); }
}, 10000);
test("training-only MCP starts without a USDA key and exposes the same training tools", async () => {
  const h = await host(true);
  try {
    expect((await h.rpc("tools/list", {})).tools.map((tool: any) => tool.name).sort())
      .toEqual(["resolve_identity", "getWeeklyTrainingPlan", "getUpcomingWorkouts", "getWorkoutForDate", "refreshTrainingPlan"].sort());
  } finally { await h.close(); }
}, 10000);
