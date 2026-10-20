import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { NutritionRepository } from "./db/repositories";
export function registerIdentityResolver(server: McpServer, users: NutritionRepository): void {
    server.registerTool("resolve_identity", {
        description: "Resolve the stable current sender supplied by Hermes to an existing user, or create an independent profile for a new sender. An optional name labels the profile; names never determine identity or authorization.",
        inputSchema: z.object({ platform: z.string().min(1).max(80), externalId: z.string().min(1).max(255), name: z.string().trim().min(1).max(100).optional() }),
    }, async ({ platform, externalId, name }) => ({ content: [{ type: "text" as const, text: JSON.stringify(users.resolveIdentity(platform, externalId, name)) }] }));
}
