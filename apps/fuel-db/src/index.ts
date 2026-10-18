import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { NutritionRepository } from "./db/repositories";
import { FoodDataCentralClient } from "./services/food-data-central";
import { NutritionService } from "./services/nutrition";

const config = loadConfig();
if (!config.fdcApiKey) throw new Error("FDC_API_KEY is required. See .env.example.");
const db = openDatabase(config.databasePath);
const service = new NutritionService(new NutritionRepository(db), new FoodDataCentralClient(config.fdcApiKey));

const server = new McpServer({ name: "fuel-db", version: "0.1.0" });
const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const errorResult = (error: unknown) => ({
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Unexpected error" }],
  isError: true,
});

server.registerTool("resolve_identity", {
  description: "Find or create a nutrition user for a messaging identity. Repeated calls for the same provider and external ID return the same user.",
  inputSchema: z.object({ provider: z.string().min(1).max(80), externalId: z.string().min(1).max(255) }),
}, async ({ provider, externalId }) => textResult(service.resolveIdentity(provider, externalId)));

server.registerTool("link_identity", {
  description: "Link another messaging identity to an existing user. Only use after verifying both identities belong to the same person.",
  inputSchema: z.object({ userId: z.string().uuid(), provider: z.string().min(1).max(80), externalId: z.string().min(1).max(255) }),
}, async ({ userId, provider, externalId }) => {
  try { service.linkIdentity(userId, provider, externalId); return textResult({ linked: true, userId, provider, externalId }); }
  catch (error) { return errorResult(error); }
});

server.registerTool("set_user_timezone", {
  description: "Set a user's IANA timezone. Daily summaries use this timezone while food timestamps remain stored in UTC.",
  inputSchema: z.object({ userId: z.string().uuid(), timezone: z.string().min(1).max(100) }),
}, async ({ userId, timezone }) => {
  try { return textResult(service.setUserTimezone(userId, timezone)); } catch (error) { return errorResult(error); }
});

server.registerTool("search_foods", {
  description: "Search USDA FoodData Central by food name or phrase.",
  inputSchema: z.object({ query: z.string().min(1).max(200), pageSize: z.number().int().min(1).max(50).default(10) }),
}, async ({ query, pageSize }) => {
  try { return textResult(await service.searchFoods(query, pageSize)); } catch (error) { return errorResult(error); }
});

server.registerTool("get_food_nutrients", {
  description: "Look up USDA nutrient values for one FoodData Central ID. Values are reported per 100 g where available.",
  inputSchema: z.object({ fdcId: z.number().int().positive() }),
}, async ({ fdcId }) => {
  try { return textResult(await service.getFoodNutrients(fdcId)); } catch (error) { return errorResult(error); }
});

server.registerTool("log_food", {
  description: "Log a quantity in grams for a user. Nutrients are fetched from USDA and stored as a per-entry snapshot so history remains stable.",
  inputSchema: z.object({
    userId: z.string().uuid(), fdcId: z.number().int().positive(), quantityG: z.number().positive(),
    consumedAt: z.string().datetime({ offset: true }).optional(),
  }),
}, async ({ userId, fdcId, quantityG, consumedAt }) => {
  try { return textResult(await service.logFood({ userId, fdcId, quantityG, consumedAt })); } catch (error) { return errorResult(error); }
});

server.registerTool("daily_nutrition_summary", {
  description: "Summarize a user's logged nutrition and entries for one calendar day in that user's IANA timezone.",
  inputSchema: z.object({ userId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
}, async ({ userId, date }) => {
  try { return textResult(service.dailySummary(userId, date)); } catch (error) { return errorResult(error); }
});

const handle = serveStdio(() => server);
process.on("SIGINT", () => { void handle.close(); db.close(); });
process.on("SIGTERM", () => { void handle.close(); db.close(); });
console.error(`fuel-db MCP server running over stdio; SQLite: ${config.databasePath}`);
