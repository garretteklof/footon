import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { loadConfig } from "./config";
import { resolveTrustedSender } from "./identity";
import { openStorage, upsertUsers } from "@footon/storage";
import { FoodDataCentralClient, dailySummary, deleteEntry, logFood, updateEntry } from "@footon/fuel";
import { trainingPlan } from "@footon/blocks";

const config = loadConfig();
if (!config.fdcApiKey) {
  throw new Error("fdcApiKey is required in config.local.json. See README.md.");
}

const storage = openStorage();
upsertUsers(storage.db, config.users);
const db = storage.db;
const foods = new FoodDataCentralClient(config.fdcApiKey);
const server = new McpServer({ name: "footon", version: "0.1.0" });

async function result(work: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await work(), null, 2) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: error instanceof Error ? error.message : "Request failed",
      }],
    };
  }
}

function forSender(
  ctx: { mcpReq: { _meta?: Record<string, unknown> } },
  work: (user: (typeof config.users)[number]) => unknown,
) {
  return result(() => {
    const identity = ctx.mcpReq._meta?.["com.hermarium/trusted-sender"];
    return work(resolveTrustedSender(config.users, identity));
  });
}

server.registerTool("getWeeklyTrainingPlan", {
  description: "Current Monday–Sunday training week for the trusted requesting iMessage sender. Check stale and unknown statuses.",
  inputSchema: z.object({}).strict(),
}, (_args, ctx) => forSender(ctx, user => trainingPlan(db, user, "week")));

server.registerTool("getUpcomingWorkouts", {
  description: "Upcoming workouts for the trusted requesting iMessage sender, including today, completed and unknown statuses.",
  inputSchema: z.object({ days: z.number().int().min(1).max(90).default(14) }).strict(),
}, ({ days }, ctx) => forSender(ctx, user => trainingPlan(db, user, { days })));

server.registerTool("getWorkoutForDate", {
  description: "All workouts on a local date for the trusted requesting iMessage sender.",
  inputSchema: z.object({ date: z.string() }).strict(),
}, ({ date }, ctx) => forSender(ctx, user => trainingPlan(db, user, { date })));

server.registerTool("refreshTrainingPlan", {
  description: "Refresh current and following training weeks for the trusted requesting iMessage sender.",
  inputSchema: z.object({}).strict(),
}, (_args, ctx) => forSender(ctx, user => trainingPlan(db, user, "refresh")));

server.registerTool("search_foods", {
  description: "Search USDA FoodData Central by food name or phrase.",
  inputSchema: z.object({
    query: z.string().min(1).max(200),
    pageSize: z.number().int().min(1).max(50).default(10),
  }),
}, ({ query, pageSize }) => result(() => foods.searchFoods(query, pageSize)));

server.registerTool("get_food_nutrients", {
  description: "Retrieve selected USDA nutrient values per 100 g.",
  inputSchema: z.object({ fdcId: z.number().int().positive() }),
}, ({ fdcId }) => result(() => foods.getFoodNutrients(fdcId)));

server.registerTool("log_food", {
  description: "Log grams consumed and a historical USDA nutrient snapshot for the trusted requesting iMessage sender.",
  inputSchema: z.object({
    fdcId: z.number().int().positive(),
    quantityG: z.number().positive(),
    consumedAt: z.string().datetime({ offset: true }).optional(),
  }).strict(),
}, (input, ctx) => forSender(ctx, user => logFood(db, foods, { ...input, userId: user.id })));

server.registerTool("update_entry", {
  description: "Correct the requesting iMessage sender's food entry. Quantity/time changes preserve its snapshot; changing fdcId requires an explicit USDA food selection.",
  inputSchema: z.object({
    entryId: z.string().uuid(),
    quantityG: z.number().positive().optional(),
    fdcId: z.number().int().positive().optional(),
    consumedAt: z.string().datetime({ offset: true }).optional(),
  }).strict().refine(
    input => input.quantityG !== undefined || input.fdcId !== undefined || input.consumedAt !== undefined,
    { message: "Provide at least one field to update" },
  ),
}, (input, ctx) => forSender(ctx, user => updateEntry(db, foods, { ...input, userId: user.id })));

server.registerTool("delete_entry", {
  description: "Delete one of the requesting iMessage sender's food entries.",
  inputSchema: z.object({ entryId: z.string().uuid() }).strict(),
}, ({ entryId }, ctx) => forSender(ctx, user => deleteEntry(db, user.id, entryId)));

server.registerTool("daily_nutrition_summary", {
  description: "Summarize food records for a calendar day in the requesting iMessage sender's timezone.",
  inputSchema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
}, ({ date }, ctx) => forSender(ctx, user => dailySummary(db, user.id, user.timezone, date)));

const handle = serveStdio(() => server);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void handle.close();
    storage.close();
  });
}
console.error(`Footon MCP server running over stdio; SQLite: ${storage.path}`);
