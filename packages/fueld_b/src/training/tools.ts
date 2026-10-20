import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { TrainingPlanService } from "./service";

export function registerTrainingTools(server: McpServer, service: TrainingPlanService): void {
    const user = z.string().uuid().describe("Existing userId returned by resolve_identity for the trusted current sender; never ask the user to enter it");
    const result = async (work: () => Promise<unknown>) => {
        try { return { content: [{ type: "text" as const, text: JSON.stringify(await work()) }] }; }
        catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Training request failed" }] }; }
    };
    // Same trusted-local-host contract as fueld_b nutrition tools. The host/agent
    // resolves the current sender; this stdio server does not authenticate users.
    server.registerTool("getWeeklyTrainingPlan", {
        description: "Current Monday–Sunday training week for the resolved current sender. Check stale and unknown statuses.",
        inputSchema: z.object({ userId: user }).strict(),
    }, ({ userId }) => result(() => service.getWeeklyTrainingPlan(userId)));
    server.registerTool("getUpcomingWorkouts", {
        description: "Upcoming workouts for the resolved current sender, including today, completed and unknown statuses.",
        inputSchema: z.object({ userId: user, days: z.number().int().min(1).max(90).default(14) }).strict(),
    }, ({ userId, days }) => result(() => service.getUpcomingWorkouts(userId, days)));
    server.registerTool("getWorkoutForDate", {
        description: "All workouts on a local date for the resolved current sender.",
        inputSchema: z.object({ userId: user, date: z.string() }).strict(),
    }, ({ userId, date }) => result(() => service.getWorkoutForDate(userId, date)));
    server.registerTool("refreshTrainingPlan", {
        description: "Refresh current and following training weeks for the resolved current sender.",
        inputSchema: z.object({ userId: user }).strict(),
    }, ({ userId }) => result(() => service.refreshTrainingPlan(userId)));
}
