import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "../config";
import { openDatabase } from "../db/database";
import { NutritionRepository } from "../db/repositories";
import { registerIdentityResolver } from "../identity-tool";
import { createTrainingService } from "./runtime";
import { registerTrainingTools } from "./tools";
const db = openDatabase(loadConfig().databasePath);
const server = new McpServer({ name: "training-plans", version: "0.1.0" });
registerIdentityResolver(server, new NutritionRepository(db));
registerTrainingTools(server, createTrainingService(db));
const handle = serveStdio(() => server);
for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => { void handle.close(); db.close(); });
