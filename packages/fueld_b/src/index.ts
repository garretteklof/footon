import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { loadConfig } from "./config";
import { openDatabase } from "./database";
import { resolveIdentity, linkIdentity, setUserTimezone } from "./users";
import { FoodDataCentralClient } from "./food-data-central";
import { logFood, updateEntry, deleteEntry, dailySummary } from "./nutrition";
import { trainingPlan } from "./training/plans";

const config = loadConfig(), trainingOnly = process.argv.includes("--training-only");
if (!trainingOnly && !config.fdcApiKey) throw new Error("FDC_API_KEY is required. See README.md.");
const db = openDatabase(config.databasePath), foods = new FoodDataCentralClient(config.fdcApiKey);
const server = new McpServer({ name: trainingOnly ? "training-plans" : "fueld_b", version: "0.1.0" });
const user = z.string().uuid().describe("Existing userId returned by resolve_identity for the trusted current sender; never ask the user to enter it");
const result = async (work: () => unknown) => {
  try { return { content: [{ type: "text" as const, text: JSON.stringify(await work(), null, 2) }] }; }
  catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Request failed" }] }; }
};

server.registerTool("resolve_identity", {
  description: "Resolve the stable current sender supplied by Hermes. New sender identities get independent profiles; names are labels, never authorization.",
  inputSchema: z.object({ platform: z.string().min(1).max(80), externalId: z.string().min(1).max(255), name: z.string().trim().min(1).max(100).optional() }),
}, ({ platform, externalId, name }) => result(() => resolveIdentity(db, platform, externalId, name)));
server.registerTool("getWeeklyTrainingPlan", {
  description: "Current Monday–Sunday training week for the resolved current sender. Check stale and unknown statuses.",
  inputSchema: z.object({ userId: user }).strict(),
}, ({ userId }) => result(() => trainingPlan(db, userId, "week")));
server.registerTool("getUpcomingWorkouts", {
  description: "Upcoming workouts for the resolved current sender, including today, completed and unknown statuses.",
  inputSchema: z.object({ userId: user, days: z.number().int().min(1).max(90).default(14) }).strict(),
}, ({ userId, days }) => result(() => trainingPlan(db, userId, { days })));
server.registerTool("getWorkoutForDate", {
  description: "All workouts on a local date for the resolved current sender.",
  inputSchema: z.object({ userId: user, date: z.string() }).strict(),
}, ({ userId, date }) => result(() => trainingPlan(db, userId, { date })));
server.registerTool("refreshTrainingPlan", {
  description: "Refresh current and following training weeks for the resolved current sender.",
  inputSchema: z.object({ userId: user }).strict(),
}, ({ userId }) => result(() => trainingPlan(db, userId, "refresh")));

if (!trainingOnly) {
  server.registerTool("link_identity", {
    description: "Link another stable sender identity to this user's history, only after verifying both identities belong to the same person.",
    inputSchema: z.object({ userId: user, platform: z.string().min(1).max(80), externalId: z.string().min(1).max(255) }),
  }, ({ userId, platform, externalId }) => result(() => { linkIdentity(db, userId, platform, externalId); return { linked: true, userId, platform, externalId }; }));
  server.registerTool("set_user_timezone", {
    description: "Set an IANA timezone for local nutrition summaries and training schedules.",
    inputSchema: z.object({ userId: user, timezone: z.string().min(1).max(100) }),
  }, ({ userId, timezone }) => result(() => setUserTimezone(db, userId, timezone)));
  server.registerTool("search_foods", {
    description: "Search USDA FoodData Central by food name or phrase.",
    inputSchema: z.object({ query: z.string().min(1).max(200), pageSize: z.number().int().min(1).max(50).default(10) }),
  }, ({ query, pageSize }) => result(() => foods.searchFoods(query, pageSize)));
  server.registerTool("get_food_nutrients", {
    description: "Retrieve selected USDA nutrient values per 100 g.",
    inputSchema: z.object({ fdcId: z.number().int().positive() }),
  }, ({ fdcId }) => result(() => foods.getFoodNutrients(fdcId)));
  server.registerTool("log_food", {
    description: "Log grams consumed and a historical USDA nutrient snapshot for this user.",
    inputSchema: z.object({ userId: user, fdcId: z.number().int().positive(), quantityG: z.number().positive(),
      consumedAt: z.string().datetime({ offset: true }).optional() }),
  }, input => result(() => logFood(db, foods, input)));
  server.registerTool("update_entry", {
    description: "Correct an owned food entry. Quantity/time changes preserve its snapshot; changing fdcId requires an explicit USDA food selection.",
    inputSchema: z.object({ userId: user, entryId: z.string().uuid(), quantityG: z.number().positive().optional(),
      fdcId: z.number().int().positive().optional(), consumedAt: z.string().datetime({ offset: true }).optional() })
      .refine(input => input.quantityG !== undefined || input.fdcId !== undefined || input.consumedAt !== undefined, { message: "Provide at least one field to update" }),
  }, input => result(() => updateEntry(db, foods, input)));
  server.registerTool("delete_entry", {
    description: "Delete an owned entry and return it, or a structured missing/unauthorized error.",
    inputSchema: z.object({ userId: user, entryId: z.string().uuid() }),
  }, ({ userId, entryId }) => result(() => deleteEntry(db, userId, entryId)));
  server.registerTool("daily_nutrition_summary", {
    description: "Summarize logged nutrition for a calendar day in this user's timezone.",
    inputSchema: z.object({ userId: user, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  }, ({ userId, date }) => result(() => dailySummary(db, userId, date)));
}
const handle = serveStdio(() => server);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => { void handle.close(); db.close(); });
console.error(`${trainingOnly ? "Training" : "fueld_b"} MCP server running over stdio; SQLite: ${config.databasePath}`);
